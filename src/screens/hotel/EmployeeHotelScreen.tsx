import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Modal,
  useWindowDimensions,
  Alert,
  Image,
  Pressable,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import type { MotelRoomRow } from '../../api';
import * as api from '../../api';
import { HttpError } from '../../lib/api-client';
import { useAuth, type User } from '../../context/AuthContext';
import { getPrimaryRoleFromUser, mergeNestedAuthUserPayload } from '../../types/auth';
import { isHotelEmployeeRole } from '../../lib/motelEmployeeAccess';
import { getRoomTileColor } from './HotelAdminRoomsView';
import { useHotelCleaningAccess } from '../../hooks/useHotelCleaningAccess';

function roomLabel(room: MotelRoomRow): string {
  const n =
    (room as any).room_number ??
    room.number ??
    room.name ??
    (room.id != null ? String(room.id) : '');
  return String(n || '—');
}

/** Canonical id for session + API — motel room UUID only (never fall back to room_number / numeric pk). */
function roomSessionId(room: MotelRoomRow): string {
  return api.pickMotelRoomUuidId(room as any);
}

function roomFloorKey(room: MotelRoomRow): string {
  const anyRoom = room as any;
  const f =
    anyRoom.floor ??
    anyRoom.floor_number ??
    anyRoom.floor_id ??
    anyRoom.floor_no ??
    anyRoom.floorNo ??
    anyRoom.floorNumber ??
    anyRoom.floor_level ??
    anyRoom.level;
  if (f != null && typeof f === 'object' && !Array.isArray(f)) {
    const o = f as Record<string, unknown>;
    const nested = o.number ?? o.floor_number ?? o.name ?? o.label ?? o.id;
    if (nested != null && String(nested).trim() !== '') return String(nested).trim();
  }
  if (f != null && String(f).trim() !== '') return String(f).trim();
  return 'Other';
}

function roomCompanyId(r: MotelRoomRow): string {
  const anyR = r as any;
  const c = anyR.company_id ?? anyR.company;
  if (c != null && typeof c === 'object' && (c as any).id != null) return String((c as any).id).trim();
  return c != null && c !== '' ? String(c).trim() : '';
}

function sortFloorKeys(keys: string[]): string[] {
  const other = keys.filter((k) => k === 'Other');
  const rest = keys.filter((k) => k !== 'Other').sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return [...rest, ...other];
}

/** Room rows embedded in `GET /scheduler/companies/:id/` (any nesting the backend uses). */
function roomsFromCompanyDetail(co: Record<string, any> | null | undefined): MotelRoomRow[] {
  if (!co || typeof co !== 'object') return [];
  return api.extractMotelRoomListFromResponse(co);
}

function naturalRoomMergeKey(r: MotelRoomRow): string {
  return `${roomCompanyId(r) || '—'}\u0000${roomFloorKey(r)}\u0000${roomLabel(r)}`;
}

/** When the same room appears from nested org JSON (no UUID) and from `/motel/rooms/` (UUID), keep the row we can start-cleaning with. */
function preferRoomRowWithUuid(a: MotelRoomRow, b: MotelRoomRow): MotelRoomRow {
  const au = api.pickMotelRoomUuidId(a as any);
  const bu = api.pickMotelRoomUuidId(b as any);
  if (bu && !au) return b;
  return a;
}

/** Hide backend “managers only” copy; show empty state + pull-to-refresh instead. */
const IMAGE_STEPS = [
  { key: 'door', label: 'Capture Door Image' },
  { key: 'bathroom', label: 'Capture Bathroom Image' },
  { key: 'bed', label: 'Capture Bed Image' },
  { key: 'tables', label: 'Capture Tables Image' },
  { key: 'room', label: 'Capture Whole Room Image' },
] as const;

type CleaningImageStepKey = (typeof IMAGE_STEPS)[number]['key'];

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function sanitizeRoomLoadError(err: unknown): string | null {
  const msg = String(
    (err as any)?.message ?? (err as any)?.detail ?? (err instanceof Error ? err.message : '') ?? ''
  ).trim();
  if (!msg) return null;
  const low = msg.toLowerCase();
  if (low.includes('super admin') && low.includes('manager')) return null;
  if (low.includes('motel room management')) return null;
  if (low.includes('organization/company managers')) return null;
  return msg;
}

/**
 * Employee motel cleaning: floor-grouped room grid, no admin actions.
 * Uses existing motel API helpers only (no backend changes).
 */
export default function EmployeeHotelScreen() {
  const { width } = useWindowDimensions();
  const { user, role, isLoading: authLoading } = useAuth();
  const mergedUser = useMemo(() => (user ? (mergeNestedAuthUserPayload(user as any) as User) : null), [user]);
  const effectiveRole = useMemo(() => role ?? getPrimaryRoleFromUser(mergedUser as any), [role, mergedUser]);
  const isEmp = useMemo(
    () => Boolean(mergedUser && isHotelEmployeeRole(mergedUser, effectiveRole)),
    [mergedUser, effectiveRole]
  );
  const { allowed: hotelAllowed, resolved: hotelResolved, variant: hotelVariant } = useHotelCleaningAccess(
    user,
    effectiveRole
  );

  const [rooms, setRooms] = useState<MotelRoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [modalVisible, setModalVisible] = useState(false);
  const [modalStep, setModalStep] = useState<'actions' | 'upload'>('actions');
  const [selectedRoom, setSelectedRoom] = useState<MotelRoomRow | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [startBusy, setStartBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [startTime, setStartTime] = useState<Date | null>(null);
  const [endTime, setEndTime] = useState<Date | null>(null);
  const [totalTime, setTotalTime] = useState(0);
  const [captureStep, setCaptureStep] = useState(0);
  const [capturedImages, setCapturedImages] = useState<
    Partial<Record<CleaningImageStepKey, ImagePicker.ImagePickerAsset>>
  >({});
  const [imageViewerUri, setImageViewerUri] = useState<string | null>(null);
  /** `null` = all floors */
  const [selectedFloor, setSelectedFloor] = useState<string | null>(null);

  /** Measured scroll content width so tiles match the drawer (window width alone can be too wide on web). */
  const [roomGridInnerWidth, setRoomGridInnerWidth] = useState(0);
  const tileMargin = 5;
  const usableRowWidth = roomGridInnerWidth > 0 ? roomGridInnerWidth : Math.max(280, width - 32);
  const tilesPerRow = usableRowWidth >= 520 ? 3 : 2;
  /** n tiles each with margin m: row uses n*tileW + 2*m*n horizontally → tileW = W/n − 2m */
  const tileW = Math.max(72, Math.floor(usableRowWidth / tilesPerRow - 2 * tileMargin));

  const groupedRooms = useMemo(() => {
    const acc: Record<string, MotelRoomRow[]> = {};
    for (const room of rooms) {
      const floor = roomFloorKey(room);
      if (!acc[floor]) acc[floor] = [];
      acc[floor].push(room);
    }
    return acc;
  }, [rooms]);

  const sortedFloors = useMemo(() => sortFloorKeys(Object.keys(groupedRooms)), [groupedRooms]);

  const floorsToShow = useMemo(
    () => (selectedFloor == null ? sortedFloors : sortedFloors.filter((f) => f === selectedFloor)),
    [selectedFloor, sortedFloors]
  );

  useEffect(() => {
    if (selectedFloor != null && !sortedFloors.includes(selectedFloor)) {
      setSelectedFloor(null);
    }
  }, [sortedFloors, selectedFloor]);

  /**
   * Resolves every company id we can from `/auth/user/` + scheduler employee + RBAC company list,
   * then loads `/motel/rooms/` scoped per company (avoids employee403 on unscoped list).
   */
  const loadRooms = useCallback(async () => {
    setError(null);
    const u = (mergedUser ?? user) as any;

    const candidateIds: string[] = [];
    const candidateOrgIds: string[] = [];
    const pushId = (raw: unknown) => {
      const s = String(raw ?? '').trim();
      if (s && !candidateIds.includes(s)) candidateIds.push(s);
    };
    const pushOrg = (raw: unknown) => {
      const s = String(raw ?? '').trim();
      if (s && !candidateOrgIds.includes(s)) candidateOrgIds.push(s);
    };
    for (const h of api.companyIdHintsFromAuthUser(u)) pushId(h);
    pushId(u?.company_id);
    pushId(u?.assigned_company);
    for (const h of api.organizationIdHintsFromAuthUser(u)) pushOrg(h);
    pushOrg(u?.organization_id);
    pushOrg(u?.assigned_organization);
    try {
      const emp = await api.resolveEmployeeForUser(u);
      pushId(api.companyIdFromSchedulerEmployee(emp, u));
    } catch {
      /* ignore */
    }
    /** Scheduler list is RBAC-scoped — includes every company this user may access (not only the first). */
    try {
      const comps = await api.getCompanies({ page_size: 500 });
      if (Array.isArray(comps)) {
        for (const c of comps) {
          pushId((c as any)?.id);
          const orgRaw = (c as any)?.organization_id ?? (c as any)?.organization;
          if (orgRaw != null && typeof orgRaw === 'object' && (orgRaw as any).id != null) {
            pushOrg((orgRaw as any).id);
          } else if (orgRaw != null && orgRaw !== '') {
            pushOrg(orgRaw);
          }
        }
      }
    } catch {
      /* ignore */
    }

    let lastErr: any = null;

    const fetchRoomsForOrganization = async (oid: string): Promise<MotelRoomRow[]> => {
      const paramSets: Array<Record<string, any>> = [
        { organization_id: oid },
        { organization: oid },
        { org_id: oid },
        { scheduler_organization: oid },
        { scheduler_organization_id: oid },
      ];
      for (const params of paramSets) {
        try {
          const list = await api.getMotelRooms(params);
          const arr = Array.isArray(list) ? list : [];
          if (arr.length > 0) return arr;
        } catch (e: any) {
          lastErr = e;
        }
      }
      try {
        const org = await api.getOrganization(oid);
        const fromOrg = api.extractMotelRoomListFromResponse(org);
        if (fromOrg.length > 0) return fromOrg;
      } catch {
        /* ignore */
      }
      return [];
    };

    const fetchRoomsForCompany = async (cid: string): Promise<MotelRoomRow[]> => {
      const paramSets: Array<Record<string, any>> = [
        { company_id: cid },
        { company: cid },
        { companyId: cid },
        { company__id: cid },
        { scheduler_company: cid },
        { scheduler_company_id: cid },
      ];
      for (const params of paramSets) {
        try {
          const list = await api.getMotelRooms(params);
          const arr = Array.isArray(list) ? list : [];
          const withCo = arr.filter((r) => roomCompanyId(r));
          const filtered =
            withCo.length > 0 ? arr.filter((r) => !roomCompanyId(r) || roomCompanyId(r) === cid) : arr;
          if (filtered.length > 0) return filtered;
        } catch (e: any) {
          lastErr = e;
        }
      }
      try {
        const co = await api.getCompany(cid);
        const fromCo = roomsFromCompanyDetail(co as Record<string, any>);
        if (fromCo.length > 0) {
          const scoped = fromCo.filter((r) => !roomCompanyId(r) || roomCompanyId(r) === cid);
          return scoped.length > 0 ? scoped : fromCo;
        }
      } catch {
        /* ignore */
      }
      try {
        const list = await api.getMotelRooms(undefined);
        const arr = Array.isArray(list) ? list : [];
        const withCo = arr.filter((r) => roomCompanyId(r));
        const filtered =
          withCo.length > 0 ? arr.filter((r) => !roomCompanyId(r) || roomCompanyId(r) === cid) : arr;
        if (filtered.length > 0) return filtered;
      } catch (e: any) {
        lastErr = e;
      }
      return [];
    };

    const byNaturalKey = new Map<string, MotelRoomRow>();
    const addRooms = (rows: MotelRoomRow[]) => {
      for (const r of rows) {
        const nk = naturalRoomMergeKey(r);
        const prev = byNaturalKey.get(nk);
        if (!prev) byNaturalKey.set(nk, r);
        else byNaturalKey.set(nk, preferRoomRowWithUuid(prev, r));
      }
    };

    for (const oid of candidateOrgIds) {
      addRooms(await fetchRoomsForOrganization(oid));
    }
    for (const cid of candidateIds) {
      addRooms(await fetchRoomsForCompany(cid));
    }

    if (byNaturalKey.size === 0) {
      try {
        const list = await api.getMotelRooms(undefined);
        addRooms(Array.isArray(list) ? list : []);
      } catch (e: any) {
        lastErr = e;
      }
    }

    const mergedFlat = Array.from(byNaturalKey.values());
    const seenUuid = new Set<string>();
    const merged: MotelRoomRow[] = [];
    for (const r of mergedFlat) {
      const uid = api.pickMotelRoomUuidId(r as any);
      if (!uid) continue;
      if (seenUuid.has(uid)) continue;
      seenUuid.add(uid);
      merged.push(r);
    }

    if (merged.length > 0) {
      setRooms(merged);
      setError(null);
      return;
    }

    setRooms([]);
    setError(sanitizeRoomLoadError(lastErr));
  }, [mergedUser, user]);

  useEffect(() => {
    if (!isEmp) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      await loadRooms();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [isEmp, loadRooms]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isRunning) {
      interval = setInterval(() => setSeconds((s) => s + 1), 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadRooms();
    } finally {
      setRefreshing(false);
    }
  }, [loadRooms]);

  const openRoom = (room: MotelRoomRow) => {
    if (sessionId && activeRoomId && roomSessionId(room) !== activeRoomId) {
      Alert.alert('Cleaning in progress', 'Finish the current room first.');
      return;
    }
    setSelectedRoom(room);
    setModalStep('actions');
    setModalVisible(true);
  };

  const closeModal = () => {
    setModalVisible(false);
    setSelectedRoom(null);
    setModalStep('actions');
    setCapturedImages({});
    setCaptureStep(0);
  };

  const resetSession = () => {
    setSessionId(null);
    setActiveRoomId(null);
    setSeconds(0);
    setIsRunning(false);
    setStartTime(null);
    setEndTime(null);
    setTotalTime(0);
    setCapturedImages({});
    setCaptureStep(0);
    setModalStep('actions');
  };

  const startCleaning = async () => {
    if (!selectedRoom) return;
    const roomId = roomSessionId(selectedRoom);
    if (!roomId) {
      Alert.alert('Start cleaning', 'This room has no server id. Pull to refresh the list.');
      return;
    }
    if (sessionId && activeRoomId && roomId !== activeRoomId) {
      Alert.alert('Cleaning in progress', 'Finish the current room first.');
      return;
    }
    setStartBusy(true);
    try {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('[EmployeeHotel] start-cleaning room_id:', roomId);
      }
      const res = (await api.startMotelCleaning(roomId)) as Record<string, any>;
      const sid = api.resolveMotelCleaningSessionId(res);
      if (!sid) {
        Alert.alert('Start cleaning', 'Server did not return a session id.');
        return;
      }
      setSessionId(sid);
      setActiveRoomId(roomId);
      setSeconds(0);
      setStartTime(new Date());
      setIsRunning(true);
    } catch (e: any) {
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('[EmployeeHotel] start-cleaning ERROR:', e instanceof HttpError ? e.body : e?.message ?? e);
      }
      Alert.alert('Start cleaning', e?.message || 'Request failed');
    } finally {
      setStartBusy(false);
    }
  };

  const completeTap = () => {
    if (!selectedRoom || !sessionId || !activeRoomId || roomSessionId(selectedRoom) !== activeRoomId) {
      Alert.alert('Complete', 'Start cleaning first.');
      return;
    }
    const end = new Date();
    setEndTime(end);
    setIsRunning(false);
    if (startTime) {
      const duration = Math.floor((end.getTime() - startTime.getTime()) / 1000);
      setTotalTime(duration);
    } else {
      setTotalTime(seconds);
    }
    setModalStep('upload');
    setCapturedImages({});
    setCaptureStep(0);
  };

  const openCamera = async () => {
    if (captureStep >= IMAGE_STEPS.length) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Camera', 'Camera access is required to take cleaning photos.');
      return;
    }
    const stepKey = IMAGE_STEPS[captureStep].key;
    const result = await ImagePicker.launchCameraAsync({ quality: 0.7 });
    if (result.canceled || !result.assets?.length) return;
    setCapturedImages((prev) => ({
      ...prev,
      [stepKey]: result.assets[0],
    }));
    setCaptureStep((s) => Math.min(s + 1, IMAGE_STEPS.length));
  };

  const submitCleaning = async () => {
    if (!sessionId) {
      Alert.alert('Submit', 'Missing session.');
      return;
    }
    const missing = IMAGE_STEPS.find(({ key }) => !capturedImages[key]);
    if (missing) {
      Alert.alert('Submit', `Please capture: ${missing.label}`);
      return;
    }
    if (!startTime || !endTime) {
      Alert.alert('Submit', 'Missing cleaning time data. Try completing the session again.');
      return;
    }
    const assets: api.MotelCleaningImageAsset[] = IMAGE_STEPS.map(({ key }) => {
      const img = capturedImages[key]!;
      return {
        uri: img.uri,
        fileName: `${key}.jpg`,
        mimeType: img.mimeType ?? 'image/jpeg',
      };
    });
    setSubmitBusy(true);
    try {
      await api.uploadMotelCleaningImages(sessionId, assets, {
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        total_time_seconds: totalTime,
      });
      await api.completeMotelCleaning(sessionId);
      resetSession();
      closeModal();
      await loadRooms();
    } catch (e: any) {
      Alert.alert('Submit', e?.message || 'Upload or complete failed');
    } finally {
      setSubmitBusy(false);
    }
  };

  if (authLoading || !user) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Loading…</Text>
      </View>
    );
  }

  if (!hotelResolved) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.muted}>Loading…</Text>
      </View>
    );
  }

  if (!isEmp || !hotelAllowed || hotelVariant !== 'employee_cleaning') {
    return (
      <View style={styles.centered}>
        <Text style={styles.denied}>Access denied</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  const cleaningThisRoom = Boolean(
    selectedRoom && sessionId && activeRoomId && roomSessionId(selectedRoom) === activeRoomId
  );

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        <Text style={styles.title}>Rooms</Text>
        <Text style={styles.subtitle}>
          Available rooms for your company, grouped by floor. Tap a room to start or complete cleaning.
        </Text>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#86EFAC' }]} />
            <Text style={styles.legendText}>Available</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#FCA5A5' }]} />
            <Text style={styles.legendText}>Occupied</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#FDE68A' }]} />
            <Text style={styles.legendText}>Needs cleaning</Text>
          </View>
        </View>

        {sortedFloors.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            nestedScrollEnabled
            style={styles.floorFilterScroll}
            contentContainerStyle={styles.floorFilterRow}
          >
            <TouchableOpacity
              style={[styles.floorChip, selectedFloor === null && styles.floorChipActive]}
              onPress={() => setSelectedFloor(null)}
              activeOpacity={0.85}
            >
              <Text style={[styles.floorChipText, selectedFloor === null && styles.floorChipTextActive]}>All floors</Text>
            </TouchableOpacity>
            {sortedFloors.map((f) => (
              <TouchableOpacity
                key={f}
                style={[styles.floorChip, selectedFloor === f && styles.floorChipActive]}
                onPress={() => setSelectedFloor(f)}
                activeOpacity={0.85}
              >
                <Text style={[styles.floorChipText, selectedFloor === f && styles.floorChipTextActive]}>
                  {f === 'Other' ? 'Other' : `Floor ${f}`}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {sortedFloors.length === 0 && !error ? (
          <Text style={styles.muted}>No rooms found for your company. Pull down to refresh.</Text>
        ) : null}

        <View
          style={styles.roomGridMeasure}
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0) setRoomGridInnerWidth((prev) => (Math.abs(prev - w) < 1 ? prev : w));
          }}
        >
          {floorsToShow.map((floor) => (
            <View key={floor} style={styles.floorBlock}>
              <Text style={styles.floorHeading}>{floor === 'Other' ? 'Other' : `Floor ${floor}`}</Text>
              <View style={styles.gridRow}>
                {groupedRooms[floor].map((room) => (
                  <TouchableOpacity
                    key={roomSessionId(room) || `lbl-${roomLabel(room)}`}
                    onPress={() => openRoom(room)}
                    style={[
                      styles.tile,
                      {
                        width: tileW,
                        margin: tileMargin,
                        backgroundColor: getRoomTileColor(room),
                      },
                    ]}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.tileNum}>{roomLabel(room)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={closeModal}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            {selectedRoom ? (
              <>
                <Text style={styles.modalTitle}>Room {roomLabel(selectedRoom)}</Text>
                {modalStep === 'actions' ? (
                  <>
                    {cleaningThisRoom ? (
                      <Text style={styles.timerText}>Timer: {formatTime(seconds)}</Text>
                    ) : null}
                    {!cleaningThisRoom ? (
                      <TouchableOpacity
                        style={[styles.btnPrimary, startBusy && styles.btnDisabled]}
                        onPress={startCleaning}
                        disabled={startBusy}
                      >
                        {startBusy ? (
                          <ActivityIndicator color="#fff" />
                        ) : (
                          <Text style={styles.btnPrimaryText}>Start cleaning</Text>
                        )}
                      </TouchableOpacity>
                    ) : (
                      <TouchableOpacity style={styles.btnPrimary} onPress={completeTap}>
                        <Text style={styles.btnPrimaryText}>Completed</Text>
                      </TouchableOpacity>
                    )}
                  </>
                ) : (
                  <>
                    <Text style={styles.modalHint}>Time taken: {formatTime(totalTime)}</Text>
                    <Text style={styles.modalHint}>
                      {captureStep < IMAGE_STEPS.length
                        ? `Step ${captureStep + 1} of ${IMAGE_STEPS.length}: ${IMAGE_STEPS[captureStep].label}`
                        : 'All steps captured. Review photos and submit.'}
                    </Text>
                    {captureStep < IMAGE_STEPS.length ? (
                      <TouchableOpacity style={styles.btnSecondary} onPress={openCamera} disabled={submitBusy}>
                        <Text style={styles.btnSecondaryText}>Open camera</Text>
                      </TouchableOpacity>
                    ) : null}
                    {IMAGE_STEPS.some(({ key }) => capturedImages[key]) ? (
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        style={styles.previewScroll}
                        contentContainerStyle={styles.previewRow}
                      >
                        {IMAGE_STEPS.map(({ key }) => {
                          const img = capturedImages[key];
                          if (!img) return null;
                          return (
                            <TouchableOpacity
                              key={key}
                              style={styles.previewThumbWrap}
                              onPress={() => setImageViewerUri(img.uri)}
                              activeOpacity={0.9}
                            >
                              <Image source={{ uri: img.uri }} style={styles.previewImage} resizeMode="cover" />
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    ) : null}
                    <Text style={styles.modalHint}>
                      {IMAGE_STEPS.filter(({ key }) => capturedImages[key]).length} of {IMAGE_STEPS.length} photos
                    </Text>
                    <TouchableOpacity
                      style={[styles.btnPrimary, submitBusy && styles.btnDisabled]}
                      onPress={submitCleaning}
                      disabled={submitBusy}
                    >
                      {submitBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>Save</Text>}
                    </TouchableOpacity>
                  </>
                )}
                <TouchableOpacity style={styles.btnGhost} onPress={closeModal} disabled={submitBusy || startBusy}>
                  <Text style={styles.btnGhostText}>Close</Text>
                </TouchableOpacity>
              </>
            ) : null}
          </View>
        </View>
      </Modal>

      <Modal
        visible={Boolean(imageViewerUri)}
        transparent
        animationType="fade"
        onRequestClose={() => setImageViewerUri(null)}
      >
          <Pressable style={styles.viewerBackdrop} onPress={() => setImageViewerUri(null)}>
            <Pressable style={styles.viewerInner} onPress={(e: any) => e.stopPropagation()}>
            {imageViewerUri ? (
              <Image source={{ uri: imageViewerUri }} style={styles.viewerImage} resizeMode="contain" />
            ) : null}
            <TouchableOpacity style={styles.viewerCloseBtn} onPress={() => setImageViewerUri(null)} activeOpacity={0.85}>
              <Text style={styles.viewerCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f8fafc' },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a', marginBottom: 6 },
  subtitle: { fontSize: 12, color: '#64748b', marginBottom: 10, lineHeight: 18 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 14 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 11, color: '#64748b', fontWeight: '500' },
  floorFilterScroll: { marginBottom: 14, maxHeight: 40 },
  floorFilterRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingRight: 8 },
  floorChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#e2e8f0',
    marginRight: 8,
  },
  floorChipActive: { backgroundColor: '#0f172a' },
  floorChipText: { fontSize: 13, fontWeight: '600', color: '#334155' },
  floorChipTextActive: { color: '#fff' },
  roomGridMeasure: { width: '100%' },
  floorBlock: { marginBottom: 20 },
  floorHeading: { fontSize: 15, fontWeight: '600', color: '#0f172a', marginBottom: 10 },
  gridRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    alignContent: 'flex-start',
    justifyContent: 'flex-start',
    width: '100%',
  },
  tile: {
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minHeight: 72,
    justifyContent: 'center',
  },
  tileNum: { fontSize: 16, fontWeight: '700', color: '#0f172a', textAlign: 'center' },
  muted: { color: '#64748b', textAlign: 'center', marginTop: 12 },
  error: { color: '#b91c1c', marginBottom: 12 },
  denied: { color: '#64748b', fontSize: 16 },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.35)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    paddingBottom: 28,
    gap: 12,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a' },
  modalHint: { fontSize: 13, color: '#64748b' },
  previewScroll: { maxHeight: 88, marginVertical: 6 },
  previewRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 4, paddingRight: 8 },
  previewThumbWrap: {
    width: 76,
    height: 76,
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#e2e8f0',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    marginRight: 8,
  },
  previewImage: { width: '100%', height: '100%' },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  viewerInner: {
    width: '100%',
    maxWidth: 520,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(2,6,23,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  viewerImage: { width: '100%', height: 420, backgroundColor: 'transparent' },
  viewerCloseBtn: { paddingVertical: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  viewerCloseText: { color: '#fff', fontWeight: '600' },
  timerText: { fontSize: 16, color: '#334155', fontWeight: '600' },
  btnPrimary: {
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
  btnSecondary: {
    backgroundColor: '#e2e8f0',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  btnSecondaryText: { color: '#0f172a', fontWeight: '600' },
  btnGhost: { paddingVertical: 10, alignItems: 'center' },
  btnGhostText: { color: '#64748b', fontWeight: '500' },
  btnDisabled: { opacity: 0.5 },
});
