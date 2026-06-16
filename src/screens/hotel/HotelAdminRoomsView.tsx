import React, { useMemo, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  useWindowDimensions,
  Alert,
  Modal,
  TextInput,
  Pressable,
  ActivityIndicator,
  Platform,
  Image,
} from 'react-native';
import type { MotelRoomRow } from '../../api';
import * as api from '../../api';
import { useTranslation } from 'react-i18next';
import {
  localizedAdminStatus,
  localizedCleaningSubStatus,
  localizedFloorLabel,
} from '../../lib/housekeepingI18n';

function roomNumber(room: MotelRoomRow): string {
  const n =
    (room as any).room_number ??
    room.number ??
    room.name ??
    (room.id != null ? String(room.id) : '');
  return String(n || '—');
}

function roomPk(room: MotelRoomRow): string {
  return api.pickMotelRoomUuidId(room as any);
}

function roomFloor(room: MotelRoomRow): string {
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
  return '';
}

// Company selection comes from `/scheduler/companies/` (rooms endpoint requires `companyId`).

const VACATED_TILE_BG = '#FEF9C3';

export function getRoomTileColor(room: MotelRoomRow): string {
  const rs = String((room as any).status ?? '').toLowerCase();
  // When room is marked available, always render as available (green),
  // even if the latest session is still "approved" (derived field).
  if (rs === 'available') return '#86EFAC';
  const cleaning = String((room as any).cleaning_status ?? '').toLowerCase();
  if (cleaning === 'pending') return '#FDE68A';
  if ((room as any).approved === true) return '#BFDBFE';
  if ((room as any).cleaning_completed === true) return '#DDD6FE';
  if (rs === 'vacated') return VACATED_TILE_BG;
  if (rs === 'booked') return '#FCA5A5';
  if ((room as any).is_occupied === true) return '#FCA5A5';
  return '#86EFAC';
}

function roomIsVacated(room: MotelRoomRow): boolean {
  return String((room as any).status ?? '').toLowerCase() === 'vacated';
}

/** Primary motel workflow status for the badge (`/motel/rooms/` `status` field). */
function roomMotelStatusLabel(room: MotelRoomRow): string {
  const rs = String((room as any).status ?? '').trim().toLowerCase();
  // Prefer the room's real workflow status field for display.
  if (rs) return rs;
  if ((room as any).approved === true) return 'approved';
  if ((room as any).cleaning_completed === true) return 'cleaning_completed';
  if ((room as any).is_occupied === true) return 'occupied';
  return 'available';
}

function roomShowVacate(room: MotelRoomRow): boolean {
  if ((room as any).is_occupied === true) return true;
  const rs = String((room as any).status ?? '').toLowerCase();
  return rs === 'booked';
}

function roomShowBook(room: MotelRoomRow): boolean {
  if (roomShowVacate(room)) return false;
  const rs = String((room as any).status ?? '').toLowerCase();
  return rs === 'available';
}

/** Wider approval dialog + thumb size so up to 5 cleaning photos fit on one row without horizontal scroll. */
function cleaningApprovalThumbLayout(
  windowWidth: number,
  imageCount: number
): { cardMaxWidth: number; thumbSize: number } {
  const cardMaxWidth = Math.min(1100, Math.max(320, windowWidth - 32));
  const inner = cardMaxWidth - 40;
  const gap = 10;
  const cols = imageCount > 5 ? 5 : Math.max(1, imageCount);
  const thumbSize = Math.max(72, Math.floor((inner - gap * (cols - 1)) / cols));
  return { cardMaxWidth, thumbSize };
}

type Props = {
  companies: Array<{ id: string; name: string }>;
  selectedCompanyId: string;
  onSelectCompany: (id: string) => void | Promise<void>;
  /** When false (e.g. company manager with one motel), company chips are hidden. */
  showCompanyFilter?: boolean;
  /** Company manager: rooms-only layout (no company strip or “showing rooms for…” line). */
  companyManagerSolo?: boolean;
  rooms: MotelRoomRow[];
  loading: boolean;
  error: string | null;
  refreshing: boolean;
  onRefresh: () => void;
  /** Super Admin only: cleaning approval workflow (derived state, no model changes). */
  enableCleaningApprovalWorkflow?: boolean;
};

export default function HotelAdminRoomsView({
  companies,
  selectedCompanyId,
  onSelectCompany,
  showCompanyFilter = true,
  companyManagerSolo = false,
  rooms,
  loading,
  error,
  refreshing,
  onRefresh,
  enableCleaningApprovalWorkflow = false,
}: Props) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const [roomGridInnerWidth, setRoomGridInnerWidth] = useState(0);
  const tileMargin = 5;
  const usableRowWidth = roomGridInnerWidth > 0 ? roomGridInnerWidth : Math.max(280, width - 32);
  const tilesPerRow = usableRowWidth >= 520 ? 3 : 2;
  const tileW = Math.max(96, Math.floor(usableRowWidth / tilesPerRow - 2 * tileMargin));

  const [editRoom, setEditRoom] = useState<MotelRoomRow | null>(null);
  const [editNumberDraft, setEditNumberDraft] = useState('');
  const [bookRoom, setBookRoom] = useState<MotelRoomRow | null>(null);
  const [guestNameDraft, setGuestNameDraft] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingBook, setSavingBook] = useState(false);
  const [vacatingPk, setVacatingPk] = useState<string | null>(null);
  const [approvalRoom, setApprovalRoom] = useState<MotelRoomRow | null>(null);
  const [approvalLoading, setApprovalLoading] = useState(false);
  const [approvalSaving, setApprovalSaving] = useState(false);
  const [imageViewerUri, setImageViewerUri] = useState<string | null>(null);
  const [approvalDetails, setApprovalDetails] = useState<{
    room_id: string;
    status: string;
    session_id: string | null;
    approved?: boolean;
    images: string[];
  } | null>(null);

  useEffect(() => {
    if (!selectedCompanyId && companies.length > 0) {
      onSelectCompany(companies[0].id);
    }
  }, [companies, selectedCompanyId, onSelectCompany]);

  const floors = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) {
      const f = roomFloor(r);
      if (f) set.add(f);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [rooms]);

  const [selectedFloor, setSelectedFloor] = useState<string>('__all__');

  const filtered = useMemo(() => {
    let list = rooms;
    if (selectedFloor !== '__all__') {
      list = list.filter((r) => roomFloor(r) === selectedFloor);
    }
    return list;
  }, [rooms, selectedFloor]);

  const openEdit = (room: MotelRoomRow) => {
    const pk = roomPk(room);
    if (!pk) {
      Alert.alert(t('housekeeping.admin.editRoom'), t('housekeeping.admin.roomIdMissingRefresh'));
      return;
    }
    setEditNumberDraft(roomNumber(room));
    setEditRoom(room);
  };

  const openBook = (room: MotelRoomRow) => {
    const pk = roomPk(room);
    if (!pk) {
      Alert.alert(t('housekeeping.admin.bookRoom'), t('housekeeping.admin.roomIdMissingRefresh'));
      return;
    }
    setGuestNameDraft('');
    setBookRoom(room);
  };

  const submitEdit = async () => {
    if (!editRoom) return;
    const pk = roomPk(editRoom);
    if (!pk) return;
    const next = editNumberDraft.trim();
    if (!next) {
      Alert.alert(t('housekeeping.admin.editRoom'), t('housekeeping.validation.roomNumberRequired'));
      return;
    }
    setSavingEdit(true);
    try {
      await api.updateMotelRoomNumber(pk, next);
      setEditRoom(null);
      await onRefresh();
    } catch (e: any) {
      Alert.alert(t('housekeeping.admin.editRoom'), e?.message || t('housekeeping.admin.couldNotUpdateRoom'));
    } finally {
      setSavingEdit(false);
    }
  };

  const submitBook = async () => {
    if (!bookRoom) return;
    const pk = roomPk(bookRoom);
    if (!pk) return;
    const guest = guestNameDraft.trim();
    if (!guest) {
      Alert.alert(t('housekeeping.admin.bookRoom'), t('housekeeping.validation.guestNameRequired'));
      return;
    }
    setSavingBook(true);
    try {
      await api.bookMotelRoom(pk, guest);
      setBookRoom(null);
      await onRefresh();
    } catch (e: any) {
      Alert.alert(t('housekeeping.admin.bookRoom'), e?.message || t('housekeeping.admin.couldNotBook'));
    } finally {
      setSavingBook(false);
    }
  };

  const runVacate = async (room: MotelRoomRow) => {
    const pk = roomPk(room);
    if (!pk) {
      Alert.alert(t('housekeeping.admin.vacate'), t('housekeeping.admin.roomIdMissingRefresh'));
      return;
    }
    const label = roomNumber(room);
    const go = async () => {
      setVacatingPk(pk);
      try {
        await api.vacateMotelRoom(pk);
        await onRefresh();
      } catch (e: any) {
        Alert.alert(t('housekeeping.admin.vacate'), e?.message || t('housekeeping.admin.couldNotVacate'));
      } finally {
        setVacatingPk(null);
      }
    };
    if (Platform.OS === 'web' && typeof (globalThis as any).confirm === 'function') {
      if ((globalThis as any).confirm(t('housekeeping.admin.vacateConfirmWeb', { label }))) void go();
      return;
    }
    Alert.alert(t('housekeeping.admin.vacateRoom'), t('housekeeping.admin.vacateConfirm', { label }), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('housekeeping.admin.vacate'), style: 'destructive', onPress: () => void go() },
    ]);
  };

  const openApproval = async (room: MotelRoomRow) => {
    if (!enableCleaningApprovalWorkflow) return;
    const pk = roomPk(room);
    if (!pk) return;
    setApprovalRoom(room);
    setApprovalDetails(null);
    setApprovalLoading(true);
    try {
      const d = await api.getMotelRoomCleaningDetails(pk);
      setApprovalDetails(d as any);
    } catch (e: any) {
      Alert.alert(t('housekeeping.admin.cleaningDetails'), e?.message || t('housekeeping.admin.couldNotLoadCleaningDetails'));
      setApprovalRoom(null);
    } finally {
      setApprovalLoading(false);
    }
  };

  const approveCleaning = async () => {
    const sid = approvalDetails?.session_id;
    if (!sid) return;
    setApprovalSaving(true);
    try {
      await api.approveMotelCleaning(sid);
      setApprovalRoom(null);
      setApprovalDetails(null);
      await onRefresh();
    } catch (e: any) {
      Alert.alert(t('housekeeping.inspection.approve'), e?.message || t('housekeeping.admin.couldNotApprove'));
    } finally {
      setApprovalSaving(false);
    }
  };

  const markAvailable = async (room: MotelRoomRow) => {
    if (!enableCleaningApprovalWorkflow) return;
    const pk = roomPk(room);
    if (!pk) return;
    setVacatingPk(pk);
    try {
      await api.markMotelRoomAvailable(pk);
      await onRefresh();
    } catch (e: any) {
      Alert.alert(t('housekeeping.admin.markAvailable'), e?.message || t('housekeeping.admin.couldNotMarkAvailable'));
    } finally {
      setVacatingPk(null);
    }
  };

  if (loading) {
    return (
      <View style={styles.centered}>
        <Text style={styles.muted}>{t('housekeeping.loadingRooms')}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={styles.scrollContent}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
    >
      <Text style={styles.title}>{t('housekeeping.titleHotel')}</Text>
      <Text style={styles.subtitle}>{t('housekeeping.subtitleAdminGrid')}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.filtersCard}>
        <Text style={styles.filtersTitle}>{t('housekeeping.filters')}</Text>
        <Text style={styles.filtersHint}>
          {companyManagerSolo
            ? t('housekeeping.subtitleAdminSolo')
            : showCompanyFilter
              ? t('housekeeping.filtersHintAdmin')
              : t('housekeeping.filtersHint')}
        </Text>

        {showCompanyFilter ? (
          <>
            <Text style={styles.filterLabel}>{t('common.company')}</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
              {companies.map((c) => (
                <TouchableOpacity
                  key={c.id}
                  style={[styles.chip, selectedCompanyId === c.id && styles.chipActive]}
                  onPress={() => onSelectCompany(c.id)}
                >
                  <Text style={[styles.chipText, selectedCompanyId === c.id && styles.chipTextActive]} numberOfLines={1}>
                    {c.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </>
        ) : !companyManagerSolo && companies[0] ? (
          <Text style={styles.companyOnlyHint}>
            {t('housekeeping.showingRoomsFor', { name: companies[0].name })}
          </Text>
        ) : null}

        <Text style={styles.filterLabel}>{t('housekeeping.floorLabel')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
          <TouchableOpacity
            style={[styles.chip, selectedFloor === '__all__' && styles.chipActive]}
            onPress={() => setSelectedFloor('__all__')}
          >
            <Text style={[styles.chipText, selectedFloor === '__all__' && styles.chipTextActive]}>
              {t('housekeeping.allFloors')}
            </Text>
          </TouchableOpacity>
          {floors.map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.chip, selectedFloor === f && styles.chipActive]}
              onPress={() => setSelectedFloor(f)}
            >
              <Text style={[styles.chipText, selectedFloor === f && styles.chipTextActive]}>
                {localizedFloorLabel(t, f)}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh} activeOpacity={0.85}>
          <Text style={styles.refreshBtnText}>{t('housekeeping.refreshRooms')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.gridHeader}>
        <Text style={styles.gridTitle}>{t('housekeeping.roomGrid')}</Text>
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#86EFAC' }]} />
            <Text style={styles.legendText}>{t('housekeeping.legend.available')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#FCA5A5' }]} />
            <Text style={styles.legendText}>{t('housekeeping.legend.occupied')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: '#FDE68A' }]} />
            <Text style={styles.legendText}>{t('housekeeping.legend.needsCleaning')}</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: VACATED_TILE_BG, borderColor: '#d4c4a8' }]} />
            <Text style={styles.legendText}>{t('housekeeping.legend.vacated')}</Text>
          </View>
        </View>
      </View>

      {filtered.length === 0 && !error ? <Text style={styles.muted}>{t('housekeeping.noRoomsFilter')}</Text> : null}

      <View
        style={styles.grid}
        onLayout={(e) => {
          const w = e.nativeEvent.layout.width;
          if (w > 0) setRoomGridInnerWidth((prev) => (Math.abs(prev - w) < 1 ? prev : w));
        }}
      >
        {filtered.map((room) => (
          <View
            key={roomPk(room) || String(room.id)}
            style={[
              styles.tile,
              {
                width: tileW,
                margin: tileMargin,
                backgroundColor: getRoomTileColor(room),
              },
            ]}
          >
            <Text style={styles.tileNumber}>{roomNumber(room)}</Text>
            <Text style={styles.tileStatus}>
              {t('housekeeping.admin.tileStatus', { status: localizedAdminStatus(t, roomMotelStatusLabel(room)) })}
            </Text>
            {localizedCleaningSubStatus(t, room) ? (
              <Text style={styles.tileSubStatus}>{localizedCleaningSubStatus(t, room)}</Text>
            ) : null}
            <TouchableOpacity style={styles.tileBtn} onPress={() => openEdit(room)} activeOpacity={0.85}>
              <Text style={styles.tileBtnText}>{t('common.edit')}</Text>
            </TouchableOpacity>
            {enableCleaningApprovalWorkflow && (room as any).cleaning_completed === true && (room as any).approved !== true ? (
              <TouchableOpacity style={styles.tileBtn} onPress={() => void openApproval(room)} activeOpacity={0.85}>
                <Text style={styles.tileBtnText}>{t('housekeeping.admin.cleaningCompletedBtn')}</Text>
              </TouchableOpacity>
            ) : null}
            {enableCleaningApprovalWorkflow &&
            (room as any).approved === true &&
            String((room as any).status ?? '').toLowerCase() !== 'available' ? (
              <TouchableOpacity
                style={[styles.tileBtn, vacatingPk === roomPk(room) && styles.tileBtnDisabled]}
                onPress={() => void markAvailable(room)}
                activeOpacity={0.85}
                disabled={vacatingPk === roomPk(room)}
              >
                {vacatingPk === roomPk(room) ? (
                  <ActivityIndicator color="#0f172a" />
                ) : (
                  <Text style={styles.tileBtnText}>{t('housekeeping.admin.markAvailable')}</Text>
                )}
              </TouchableOpacity>
            ) : null}
            {roomShowVacate(room) ? (
              <TouchableOpacity
                style={[styles.tileBtn, vacatingPk === roomPk(room) && styles.tileBtnDisabled]}
                onPress={() => void runVacate(room)}
                activeOpacity={0.85}
                disabled={vacatingPk === roomPk(room)}
              >
                {vacatingPk === roomPk(room) ? (
                  <ActivityIndicator color="#0f172a" />
                ) : (
                  <Text style={styles.tileBtnText}>{t('housekeeping.admin.vacate')}</Text>
                )}
              </TouchableOpacity>
            ) : roomShowBook(room) ? (
              <TouchableOpacity style={styles.tileBtn} onPress={() => openBook(room)} activeOpacity={0.85}>
                <Text style={styles.tileBtnText}>{t('housekeeping.admin.book')}</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ))}
      </View>

      <Modal
        visible={approvalRoom != null}
        transparent
        animationType="fade"
        onRequestClose={() => !approvalSaving && setApprovalRoom(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => !approvalSaving && setApprovalRoom(null)} />
          <View style={styles.modalCenter} pointerEvents="box-none">
            <View style={[styles.modalCard, { maxWidth: Math.min(1100, Math.max(320, width - 32)) }]}>
              <View style={styles.modalTitleRow}>
                <Text style={styles.modalTitle}>{t('housekeeping.inspection.cleaningApproval')}</Text>
                <TouchableOpacity onPress={() => !approvalSaving && setApprovalRoom(null)} hitSlop={12} accessibilityLabel={t('housekeeping.close')}>
                  <Text style={styles.modalClose}>×</Text>
                </TouchableOpacity>
              </View>

              {approvalLoading ? (
                <View style={{ paddingVertical: 18 }}>
                  <ActivityIndicator />
                </View>
              ) : approvalDetails ? (
                <>
                  <Text style={styles.modalHint}>
                    {t('housekeeping.admin.approvalRoomHint', {
                      number: approvalRoom ? roomNumber(approvalRoom) : '—',
                      count: approvalDetails.images?.length || 0,
                    })}
                  </Text>
                  {approvalDetails.images?.length ? (
                    (() => {
                      const { thumbSize } = cleaningApprovalThumbLayout(width, approvalDetails.images.length);
                      return (
                        <View style={styles.approvalGalleryGrid}>
                          {approvalDetails.images.map((uri, i) => (
                            <TouchableOpacity
                              key={`${uri}-${i}`}
                              style={[styles.approvalThumbWrap, { width: thumbSize, height: thumbSize }]}
                              onPress={() => setImageViewerUri(uri)}
                              activeOpacity={0.9}
                            >
                              <Image source={{ uri }} style={styles.approvalThumb} resizeMode="cover" />
                            </TouchableOpacity>
                          ))}
                        </View>
                      );
                    })()
                  ) : (
                    <Text style={styles.muted}>{t('housekeeping.photos.noImagesYet')}</Text>
                  )}
                  <View style={styles.modalActions}>
                    <TouchableOpacity
                      style={styles.modalBtnGhost}
                      onPress={() => !approvalSaving && setApprovalRoom(null)}
                      disabled={approvalSaving}
                    >
                      <Text style={styles.modalBtnGhostText}>{t('housekeeping.close')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={styles.modalBtnPrimary}
                      onPress={() => void approveCleaning()}
                      disabled={approvalSaving || !approvalDetails.session_id || !(approvalDetails.images?.length > 0)}
                    >
                      {approvalSaving ? (
                        <ActivityIndicator color="#fff" />
                      ) : (
                        <Text style={styles.modalBtnPrimaryText}>{t('housekeeping.inspection.approve')}</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <Text style={styles.muted}>{t('housekeeping.noDetails')}</Text>
              )}
            </View>
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
          <Pressable style={styles.viewerInner} onPress={(e) => e.stopPropagation()}>
            {imageViewerUri ? (
              <Image source={{ uri: imageViewerUri }} style={styles.viewerImage} resizeMode="contain" />
            ) : null}
            <TouchableOpacity style={styles.viewerCloseBtn} onPress={() => setImageViewerUri(null)} activeOpacity={0.85}>
              <Text style={styles.viewerCloseText}>{t('housekeeping.close')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal visible={editRoom != null} transparent animationType="fade" onRequestClose={() => !savingEdit && setEditRoom(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => !savingEdit && setEditRoom(null)} />
          <View style={styles.modalCenter} pointerEvents="box-none">
            <View style={styles.modalCard}>
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>{t('housekeeping.admin.editRoomNumber')}</Text>
              <TouchableOpacity onPress={() => !savingEdit && setEditRoom(null)} hitSlop={12} accessibilityLabel={t('housekeeping.close')}>
                <Text style={styles.modalClose}>×</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.modalHint}>
              {t('housekeeping.admin.updateRoomHint', { id: editRoom ? roomPk(editRoom) || '—' : '—' })}
            </Text>
            <Text style={styles.modalLabel}>{t('housekeeping.admin.newRoomNumber')}</Text>
            <TextInput
              style={styles.modalInput}
              value={editNumberDraft}
              onChangeText={setEditNumberDraft}
              placeholder={t('housekeeping.admin.roomNumberExample')}
              placeholderTextColor="#94a3b8"
              editable={!savingEdit}
              autoCapitalize="none"
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalBtnGhost}
                onPress={() => !savingEdit && setEditRoom(null)}
                disabled={savingEdit}
              >
                <Text style={styles.modalBtnGhostText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtnPrimary}
                onPress={() => void submitEdit()}
                disabled={savingEdit}
              >
                {savingEdit ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>{t('common.save')}</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
          </View>
        </View>
      </Modal>

      <Modal visible={bookRoom != null} transparent animationType="fade" onRequestClose={() => !savingBook && setBookRoom(null)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => !savingBook && setBookRoom(null)} />
          <View style={styles.modalCenter} pointerEvents="box-none">
            <View style={styles.modalCard}>
            <View style={styles.modalTitleRow}>
              <Text style={styles.modalTitle}>{t('housekeeping.admin.bookRoom')}</Text>
              <TouchableOpacity onPress={() => !savingBook && setBookRoom(null)} hitSlop={12} accessibilityLabel={t('housekeeping.close')}>
                <Text style={styles.modalClose}>×</Text>
              </TouchableOpacity>
            </View>
            {bookRoom ? (
              <Text style={styles.modalHint}>{t('housekeeping.roomTitle', { number: roomNumber(bookRoom) })}</Text>
            ) : null}
            <Text style={styles.modalLabel}>{t('housekeeping.admin.guestName')}</Text>
            <TextInput
              style={styles.modalInput}
              value={guestNameDraft}
              onChangeText={setGuestNameDraft}
              placeholder={t('housekeeping.admin.guestNamePlaceholder')}
              placeholderTextColor="#94a3b8"
              editable={!savingBook}
            />
            <View style={styles.modalActions}>
              <TouchableOpacity
                style={styles.modalBtnGhost}
                onPress={() => !savingBook && setBookRoom(null)}
                disabled={savingBook}
              >
                <Text style={styles.modalBtnGhostText}>{t('common.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.modalBtnPrimary}
                onPress={() => void submitBook()}
                disabled={savingBook}
              >
                {savingBook ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.modalBtnPrimaryText}>{t('housekeeping.admin.book')}</Text>
                )}
              </TouchableOpacity>
            </View>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: '#f8fafc' },
  scrollContent: { padding: 16, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 24, backgroundColor: '#f8fafc' },
  title: { fontSize: 20, fontWeight: '700', color: '#0f172a', marginBottom: 6 },
  subtitle: { fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 18 },
  filtersCard: {
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    padding: 12,
    marginBottom: 14,
  },
  filtersTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  filtersHint: { fontSize: 12, color: '#64748b', marginBottom: 10 },
  companyOnlyHint: { fontSize: 12, color: '#475569', marginBottom: 10 },
  filterLabel: { fontSize: 12, fontWeight: '600', color: '#64748b', marginBottom: 8 },
  chipRow: { flexGrow: 0, marginBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#e2e8f0',
    marginRight: 8,
  },
  chipActive: { backgroundColor: '#0f172a' },
  chipText: { fontSize: 14, color: '#0f172a', fontWeight: '500' },
  chipTextActive: { color: '#fff' },
  refreshBtn: {
    alignSelf: 'flex-start',
    marginTop: 4,
    backgroundColor: '#0f172a',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
  },
  refreshBtnText: { color: '#fff', fontWeight: '600' },
  gridHeader: { marginTop: 6, marginBottom: 8 },
  gridTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 6 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendDot: { width: 10, height: 10, borderRadius: 10, borderWidth: 1, borderColor: '#94a3b8' },
  legendText: { fontSize: 12, color: '#475569' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignContent: 'flex-start',
    justifyContent: 'flex-start',
    width: '100%',
    marginHorizontal: -5,
  },
  tile: {
    borderRadius: 10,
    padding: 10,
    minHeight: 132,
    justifyContent: 'flex-start',
    gap: 6,
  },
  tileNumber: { fontSize: 16, fontWeight: '700', color: '#0f172a' },
  tileStatus: { fontSize: 11, color: '#1e293b' },
  vacatedBadge: {
    alignSelf: 'flex-start',
    marginTop: 2,
    marginBottom: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  vacatedBadgeText: { fontSize: 12, fontWeight: '600', color: '#0f172a' },
  tileSubStatus: { fontSize: 11, color: '#334155' },
  tileBtn: {
    backgroundColor: 'rgba(255,255,255,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.35)',
    paddingVertical: 6,
    borderRadius: 8,
    alignItems: 'center',
  },
  tileBtnText: { fontSize: 12, fontWeight: '600', color: '#0f172a' },
  tileBtnDisabled: { opacity: 0.55 },
  approvalGalleryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  approvalThumbWrap: {
    borderRadius: 10,
    overflow: 'hidden',
    backgroundColor: '#e2e8f0',
    borderWidth: 1,
    borderColor: '#cbd5e1',
  },
  approvalThumb: { width: '100%', height: '100%' },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  viewerInner: {
    width: '100%',
    maxWidth: 640,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(2,6,23,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  viewerImage: { width: '100%', height: 520, backgroundColor: 'transparent' },
  viewerCloseBtn: { paddingVertical: 12, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  viewerCloseText: { color: '#fff', fontWeight: '600' },
  error: { color: '#b91c1c', marginBottom: 12 },
  muted: { color: '#64748b', textAlign: 'center' },
  modalRoot: { flex: 1 },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
  },
  modalCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  modalTitle: { fontSize: 18, fontWeight: '700', color: '#0f172a', flex: 1 },
  modalClose: { fontSize: 26, color: '#64748b', lineHeight: 28, fontWeight: '300' },
  modalHint: { fontSize: 13, color: '#64748b', marginBottom: 16, lineHeight: 20 },
  modalLabel: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 8 },
  modalInput: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    color: '#0f172a',
    backgroundColor: '#fff',
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 12,
    marginTop: 20,
  },
  modalBtnGhost: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#cbd5e1',
    backgroundColor: '#fff',
  },
  modalBtnGhostText: { fontSize: 15, fontWeight: '600', color: '#334155' },
  modalBtnPrimary: {
    minWidth: 100,
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: '#2563eb',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalBtnPrimaryText: { fontSize: 15, fontWeight: '600', color: '#fff' },
});
