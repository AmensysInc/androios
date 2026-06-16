import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Image,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import * as ImagePicker from 'expo-image-picker';
import * as api from '../../api';
import type { MotelRoomRow } from '../../api';
import { HttpError } from '../../lib/api-client';
import { useAuth } from '../../context/AuthContext';
import { useHotelCleaningAccess } from '../../hooks/useHotelCleaningAccess';
import { getPrimaryRoleFromUser } from '../../types/auth';
import { companyQualifiesForMotelHotel } from '../../lib/motelEmployeeAccess';
import HotelAdminRoomsView from './HotelAdminRoomsView';

function companyRowOrganizationId(c: Record<string, any> | null | undefined): string {
  if (!c || typeof c !== 'object') return '';
  const v = c.organization_id ?? c.organization;
  if (v != null && typeof v === 'object' && (v as any).id != null) return String((v as any).id).trim();
  return v != null ? String(v).trim() : '';
}

function roomLabel(row: MotelRoomRow): string {
  const n =
    row.label ??
    row.name ??
    row.number ??
    row.room_number ??
    (row.id != null ? `Room ${row.id}` : 'Room');
  return String(n);
}

export default function HotelCleaningScreen() {
  const { t } = useTranslation();
  const { user, role, isLoading } = useAuth();
  const navigation = useNavigation();
  const effectiveRole = useMemo(() => role ?? getPrimaryRoleFromUser(user as any), [role, user]);
  const { allowed, resolved, variant } = useHotelCleaningAccess(user, effectiveRole);
  const authOrgId = useMemo(() => {
    const hints = api.organizationIdHintsFromAuthUser(user);
    return hints[0] || '';
  }, [user]);

  const [rooms, setRooms] = useState<MotelRoomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [companies, setCompanies] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [isRunning, setIsRunning] = useState(false);
  const [startBusy, setStartBusy] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [images, setImages] = useState<ImagePicker.ImagePickerAsset[]>([]);
  const [submitBusy, setSubmitBusy] = useState(false);

  const loadRooms = useCallback(
    async (companyId?: string) => {
      setError(null);
      const cid = String(companyId ?? '').trim();

      if (variant === 'admin_rooms') {
        if (!cid) {
          setRooms([]);
          return;
        }
        const list = await api.getMotelRoomsForCompany(cid);
        setRooms(Array.isArray(list) ? list : []);
        return;
      }

      let list: MotelRoomRow[] = [];
      try {
        const scoped = await api.getMotelRooms();
        list = Array.isArray(scoped) ? scoped : [];
      } catch (e: any) {
        if (!cid) throw e;
      }

      if (list.length === 0 && cid) {
        list = await api.getMotelRoomsForCompany(cid);
      }

      if (list.length === 0 && user) {
        for (const hint of api.companyIdHintsFromAuthUser(user)) {
          const h = String(hint ?? '').trim();
          if (!h) continue;
          try {
            const batch = await api.getMotelRoomsForCompany(h);
            if (batch.length > 0) {
              list = batch;
              break;
            }
          } catch {
            /* try next hint */
          }
        }
      }

      setRooms(list);
    },
    [variant, user]
  );

  useEffect(() => {
    if (!resolved) return;
    if (!allowed) {
      try {
        (navigation as any).goBack();
      } catch {
        /* ignore */
      }
    }
  }, [resolved, allowed, navigation]);

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (variant === 'admin_rooms') {
          const compsRaw = await api.getCompanies().catch(() => []);
          const mapped = (Array.isArray(compsRaw) ? compsRaw : []).map((c: any) => ({
            id: String(c?.id ?? c?.pk ?? c?.uuid ?? '').trim(),
            name: String(c?.name ?? '—'),
            raw: c,
          }));

          /** Match web Rooms page: filter by company type (motel/hotel), not parent org name alone. */
          let pool = mapped.filter((c) => companyQualifiesForMotelHotel(c.raw));

          if (effectiveRole === 'organization_manager' && authOrgId) {
            pool = pool.filter((c) => companyRowOrganizationId(c.raw) === authOrgId);
          }
          if (effectiveRole === 'company_manager' && user?.id) {
            const raws = pool.map((x) => x.raw);
            const filtered = api.filterCompaniesStrictlyForCompanyManager(raws, user.id);
            const assignee =
              filtered.length > 0
                ? filtered
                : api.filterCompaniesForCompanyManagerRole(raws, 'company_manager', user.id);
            const allowedIds = new Set(
              assignee.map((c: any) => String(c?.id ?? c?.pk ?? c?.uuid ?? '').trim()).filter(Boolean)
            );
            pool = pool.filter((c) => allowedIds.has(c.id));
          }

          if (pool.length === 0 && effectiveRole === 'company_manager' && user) {
            for (const hint of api.companyIdHintsFromAuthUser(user)) {
              const h = String(hint ?? '').trim();
              if (!h) continue;
              const hit = mapped.find((c) => c.id === h);
              if (hit && companyQualifiesForMotelHotel(hit.raw)) {
                pool = [hit];
                break;
              }
              if (h) {
                pool = [{ id: h, name: String(hit?.name ?? 'My property'), raw: hit?.raw ?? { id: h } }];
                break;
              }
            }
          }

          const list = pool.map(({ id, name }) => ({ id, name }));
          if (!cancelled) setCompanies(list);
          const defaultId =
            selectedCompanyId && list.some((x) => x.id === selectedCompanyId)
              ? selectedCompanyId
              : list[0]?.id || '';
          if (!cancelled) setSelectedCompanyId(defaultId);
          if (defaultId) {
            await loadRooms(defaultId);
          } else {
            setRooms([]);
          }
        } else {
          await loadRooms();
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || t('housekeeping.couldNotLoadRooms'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [allowed, loadRooms, variant, effectiveRole, authOrgId, user?.id]);

  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    if (isRunning) {
      interval = setInterval(() => {
        setSeconds((prev) => prev + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [isRunning]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      if (variant === 'admin_rooms') {
        const cid = String(selectedCompanyId || '').trim();
        if (cid) await loadRooms(cid);
        else setRooms([]);
      } else {
        await loadRooms();
      }
    } catch (e: any) {
      setError(e?.message || t('housekeeping.couldNotLoadRooms'));
    } finally {
      setRefreshing(false);
    }
  }, [loadRooms, variant, selectedCompanyId]);

  const onSelectCompany = useCallback(
    async (companyId: string) => {
      const cid = String(companyId || '').trim();
      setSelectedCompanyId(cid);
      if (!cid) {
        setRooms([]);
        return;
      }
      setLoading(true);
      try {
        await loadRooms(cid);
      } catch (e: any) {
        setError(e?.message || t('housekeeping.couldNotLoadRooms'));
      } finally {
        setLoading(false);
      }
    },
    [loadRooms]
  );

  const startCleaning = async (roomId: string) => {
    if (sessionId && activeRoomId && activeRoomId !== roomId) {
      Alert.alert(t('housekeeping.cleaningInProgress'), t('housekeeping.finishCurrentRoomFirst'));
      return;
    }
    setStartBusy(true);
    try {
      const res = (await api.startMotelCleaning(roomId)) as Record<string, any>;
      const sid = api.resolveMotelCleaningSessionId(res);
      if (!sid) {
        Alert.alert(t('housekeeping.workflow.startCleaning'), t('housekeeping.validation.sessionIdMissing'));
        return;
      }
      setActiveRoomId(roomId);
      setSessionId(sid);
      setSeconds(0);
      setIsRunning(true);
    } catch (e: any) {
      Alert.alert(t('housekeeping.workflow.startCleaning'), e?.message || t('housekeeping.toast.requestFailed'));
    } finally {
      setStartBusy(false);
    }
  };

  const openCompleteFlow = () => {
    if (!sessionId) {
      Alert.alert(t('housekeeping.workflow.completeCleaning'), t('housekeeping.validation.startCleaningFirst'));
      return;
    }
    setIsRunning(false);
    setUploadOpen(true);
    setImages([]);
  };

  const pickImages = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert(t('housekeeping.photos.cleaningPhotos'), t('housekeeping.photos.libraryRequired'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsMultipleSelection: true,
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.length) return;
    setImages(result.assets);
  };

  const submitCleaning = async () => {
    if (!sessionId) {
      Alert.alert(t('common.submit'), t('housekeeping.validation.sessionMissing'));
      return;
    }
    if (!images.length) {
      Alert.alert(t('common.submit'), t('housekeeping.validation.pickOneImage'));
      return;
    }
    setSubmitBusy(true);
    try {
      const assets: api.MotelCleaningImageAsset[] = images.slice(0, 5).map((img, i) => {
        const fieldKey = api.MOTEL_CLEANING_PROOF_FIELD_KEYS[i] ?? 'door';
        return {
          uri: img.uri,
          fieldKey,
          fileName: `${fieldKey}.jpg`,
          mimeType: img.mimeType ?? 'image/jpeg',
        };
      });
      await api.completeMotelCleaningWithPhotos(sessionId, assets);
      setUploadOpen(false);
      setImages([]);
      setSessionId(null);
      setActiveRoomId(null);
      setSeconds(0);
      setIsRunning(false);
      if (variant === 'admin_rooms') {
        const cid = String(selectedCompanyId || '').trim();
        if (cid) await loadRooms(cid);
        else setRooms([]);
      } else {
        await loadRooms();
      }
    } catch (e: any) {
      Alert.alert(t('common.submit'), e?.message || t('housekeeping.toast.uploadFailed'));
    } finally {
      setSubmitBusy(false);
    }
  };

  const cancelUpload = () => {
    setUploadOpen(false);
    setImages([]);
  };

  if (isLoading || !user) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingLabel}>{t('common.loading')}</Text>
      </View>
    );
  }

  if (!resolved) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" />
        <Text style={styles.loadingLabel}>{t('common.loading')}</Text>
      </View>
    );
  }

  if (!allowed) {
    return (
      <View style={styles.centered}>
        <Text style={styles.accessDenied}>{t('housekeeping.accessDenied')}</Text>
      </View>
    );
  }

  if (uploadOpen && variant === 'employee_cleaning') {
    return (
      <View style={styles.container}>
        <Text style={styles.uploadTitle}>{t('housekeeping.photos.cleaningPhotos')}</Text>
        <Text style={styles.hint}>{t('housekeeping.session')}: {sessionId}</Text>
        <TouchableOpacity style={styles.btnPrimary} onPress={pickImages} disabled={submitBusy}>
          <Text style={styles.btnPrimaryText}>
            {images.length
              ? t('housekeeping.photos.selectedPhotos', { count: images.length })
              : t('housekeeping.photos.pickImages')}
          </Text>
        </TouchableOpacity>
        {images.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.previewScroll}
            contentContainerStyle={styles.previewRow}
          >
            {images.map((img, index) => (
              <View key={`${img.uri}-${index}`} style={styles.previewThumbWrap}>
                <Image source={{ uri: img.uri }} style={styles.previewImage} resizeMode="cover" />
              </View>
            ))}
          </ScrollView>
        ) : null}
        <TouchableOpacity
          style={[styles.btnPrimary, submitBusy && styles.btnDisabled]}
          onPress={submitCleaning}
          disabled={submitBusy}
        >
          {submitBusy ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnPrimaryText}>{t('common.submit')}</Text>}
        </TouchableOpacity>
        <TouchableOpacity style={styles.btnGhost} onPress={cancelUpload} disabled={submitBusy}>
          <Text style={styles.btnGhostText}>{t('housekeeping.backToRooms')}</Text>
        </TouchableOpacity>
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

  if (variant === 'admin_rooms') {
    return (
      <HotelAdminRoomsView
        companies={companies}
        selectedCompanyId={selectedCompanyId}
        onSelectCompany={onSelectCompany}
        showCompanyFilter={effectiveRole !== 'company_manager' && companies.length > 1}
        companyManagerSolo={effectiveRole === 'company_manager'}
        enableCleaningApprovalWorkflow={
          effectiveRole === 'super_admin' || effectiveRole === 'organization_manager' || effectiveRole === 'company_manager'
        }
        rooms={rooms}
        loading={false}
        error={error}
        refreshing={refreshing}
        onRefresh={onRefresh}
      />
    );
  }

  if (variant !== 'employee_cleaning') {
    return (
      <View style={styles.centered}>
        <Text style={styles.accessDenied}>{t('housekeeping.accessDenied')}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      {error ? <Text style={styles.errorText}>{error}</Text> : null}
      {rooms.length === 0 && !error ? <Text style={styles.empty}>{t('housekeeping.noRoomsAssigned')}</Text> : null}
      {rooms.map((row) => {
        const id = api.pickMotelRoomUuidId(row as any);
        const isActive = Boolean(id) && activeRoomId === id;
        const showTimer = isActive && sessionId;
        return (
          <View key={id || roomLabel(row)} style={styles.card}>
            <Text style={styles.roomTitle}>{roomLabel(row)}</Text>
            {showTimer ? <Text style={styles.timer}>{seconds}s</Text> : null}
            <TouchableOpacity
              style={[
                styles.btnSecondary,
                (startBusy || (sessionId && !isActive) || !id) && styles.btnDisabled,
              ]}
              onPress={() => id && startCleaning(id)}
              disabled={startBusy || Boolean(sessionId && !isActive) || !id}
            >
              <Text style={styles.btnSecondaryText}>{t('housekeeping.workflow.startCleaning')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.btnSecondary, (!isActive || !sessionId) && styles.btnDisabled]}
              onPress={openCompleteFlow}
              disabled={!isActive || !sessionId}
            >
              <Text style={styles.btnSecondaryText}>{t('housekeeping.workflow.completeCleaning')}</Text>
            </TouchableOpacity>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { padding: 16, paddingBottom: 32 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f8fafc' },
  container: { flex: 1, padding: 16, backgroundColor: '#f8fafc', gap: 12 },
  card: {
    padding: 10,
    marginBottom: 12,
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 8,
  },
  roomTitle: { fontSize: 17, fontWeight: '600', color: '#0f172a' },
  timer: { fontSize: 15, color: '#475569' },
  btnPrimary: {
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '600' },
  btnSecondary: {
    backgroundColor: '#e2e8f0',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  btnSecondaryText: { color: '#0f172a', fontWeight: '600' },
  btnGhost: { paddingVertical: 10, alignItems: 'center' },
  btnGhostText: { color: '#64748b', fontWeight: '500' },
  btnDisabled: { opacity: 0.45 },
  errorText: { color: '#b91c1c', marginBottom: 12 },
  empty: { color: '#64748b', textAlign: 'center', marginTop: 24 },
  accessDenied: { color: '#64748b', fontSize: 16, textAlign: 'center', padding: 24 },
  loadingLabel: { marginTop: 12, color: '#64748b', fontSize: 14 },
  uploadTitle: { fontSize: 20, fontWeight: '700', color: '#0f172a' },
  hint: { fontSize: 14, color: '#64748b' },
  previewScroll: { maxHeight: 88, marginVertical: 4 },
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
});
