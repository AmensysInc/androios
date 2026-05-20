import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  RefreshControl,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { MotelRoomRow } from '../../api';
import { useAuth, type User } from '../../context/AuthContext';
import { getPrimaryRoleFromUser, mergeNestedAuthUserPayload } from '../../types/auth';
import { isHotelEmployeeRole } from '../../lib/motelEmployeeAccess';
import { useHotelCleaningAccess } from '../../hooks/useHotelCleaningAccess';
import { useEmployeeMotelRooms } from '../../hooks/useEmployeeMotelRooms';
import { useMotelCleaningSessionContext } from '../../context/MotelCleaningSessionContext';
import { motelRoomFloor, motelRoomUuid, sortFloorKeys } from '../../lib/motelRoomDisplay';
import MotelRoomGridTile from '../../components/hotel/MotelRoomGridTile';
import RoomListSkeleton from '../../components/hotel/RoomListSkeleton';
import RoomActionModal from '../../components/hotel/RoomActionModal';
import type { EmployeeRoomsStackParamList } from '../../navigation/EmployeeRoomsStack';

type Nav = NativeStackNavigationProp<EmployeeRoomsStackParamList, 'EmployeeRoomsList'>;
type ListRoute = RouteProp<EmployeeRoomsStackParamList, 'EmployeeRoomsList'>;

const LEGEND = [
  { color: '#86EFAC', label: 'Available' },
  { color: '#DDD6FE', label: 'Pending Approval' },
  { color: '#BFDBFE', label: 'Approved' },
  { color: '#5EEAD4', label: 'Completed' },
] as const;

function roomFloorKey(room: MotelRoomRow): string {
  const f = motelRoomFloor(room);
  return !f || f === '—' ? 'Other' : f;
}

export default function EmployeeRoomsScreen() {
  const { width } = useWindowDimensions();
  const navigation = useNavigation<Nav>();
  const route = useRoute<ListRoute>();
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

  const { rooms, loading, refreshing, error, refresh, patchRoom, initialLoad } = useEmployeeMotelRooms(
    mergedUser ?? user
  );
  const cleaningSession = useMotelCleaningSessionContext();

  const [selectedFloor, setSelectedFloor] = useState<string | null>(null);
  const [modalRoom, setModalRoom] = useState<MotelRoomRow | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  const tileGap = 12;
  const tileMargin = 6;
  const tilesPerRow = width >= 520 ? 3 : 2;
  const listPad = 16;
  const tileW = Math.floor((width - listPad * 2 - tileGap * (tilesPerRow - 1)) / tilesPerRow) - tileMargin * 2;

  const sortedFloors = useMemo(() => {
    const set = new Set<string>();
    for (const r of rooms) set.add(roomFloorKey(r));
    return sortFloorKeys(Array.from(set));
  }, [rooms]);

  const filteredRooms = useMemo(() => {
    if (selectedFloor == null) return rooms;
    return rooms.filter((r) => roomFloorKey(r) === selectedFloor);
  }, [rooms, selectedFloor]);

  useEffect(() => {
    if (selectedFloor != null && !sortedFloors.includes(selectedFloor)) {
      setSelectedFloor(null);
    }
  }, [sortedFloors, selectedFloor]);

  useEffect(() => {
    if (!isEmp) return;
    void initialLoad();
  }, [isEmp, initialLoad]);

  useFocusEffect(
    useCallback(() => {
      if (!isEmp) return;
      const patch = route.params?.submittedRoomId;
      if (patch) {
        patchRoom(patch, {
          cleaning_completed: true,
          cleaning_status: 'pending_approval',
          approved: false,
        } as Partial<MotelRoomRow>);
        navigation.setParams({ submittedRoomId: undefined });
      }
    }, [isEmp, route.params?.submittedRoomId, patchRoom, navigation])
  );

  const onRefresh = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const openRoomModal = useCallback((room: MotelRoomRow) => {
    setModalRoom(room);
    setModalVisible(true);
  }, []);

  const closeModal = useCallback(() => {
    setModalVisible(false);
    setModalRoom(null);
  }, []);

  const goToCleaning = useCallback(
    (room: MotelRoomRow) => {
      const id = motelRoomUuid(room);
      if (!id) return;
      closeModal();
      navigation.navigate('RoomCleaningDetails', { room });
    },
    [navigation, closeModal]
  );

  const onStartCleaningPress = useCallback(() => {
    if (modalRoom) goToCleaning(modalRoom);
  }, [modalRoom, goToCleaning]);

  const onContinueCleaningPress = useCallback(() => {
    if (modalRoom) goToCleaning(modalRoom);
    else if (cleaningSession.roomId) {
      const active = rooms.find((r) => motelRoomUuid(r) === cleaningSession.roomId);
      if (active) goToCleaning(active);
    }
  }, [modalRoom, goToCleaning, cleaningSession.roomId, rooms]);

  const modalRoomId = modalRoom ? motelRoomUuid(modalRoom) : '';
  const cleaningActiveForModal = Boolean(modalRoomId && cleaningSession.isActiveForRoom(modalRoomId));

  const renderItem = useCallback(
    ({ item }: { item: MotelRoomRow }) => (
      <View style={{ width: tileW + tileMargin * 2, marginHorizontal: tileMargin / 2 }}>
        <MotelRoomGridTile room={item} width={tileW} onPress={() => openRoomModal(item)} />
      </View>
    ),
    [tileW, tileMargin, openRoomModal]
  );

  const keyExtractor = useCallback(
    (item: MotelRoomRow) => motelRoomUuid(item) || String((item as any).room_number ?? item.id),
    []
  );

  const listHeader = (
    <>
      <View style={styles.heroCard}>
        <MaterialCommunityIcons name="door-open" size={28} color="#2563eb" style={styles.heroIcon} />
        <Text style={styles.subtitle}>
          Tap a room to view details, start cleaning, run the timer, then capture required photos (camera only) and
          save.
        </Text>
      </View>

      <View style={styles.filtersCard}>
        <Text style={styles.filtersTitle}>Filters</Text>
        <Text style={styles.filtersHint}>Optional floor filter.</Text>
        <Text style={styles.filterLabel}>Floor</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.floorScroll}>
          <TouchableOpacity
            style={[styles.floorChip, selectedFloor === null && styles.floorChipActive]}
            onPress={() => setSelectedFloor(null)}
          >
            <Text style={[styles.floorChipText, selectedFloor === null && styles.floorChipTextActive]}>All floors</Text>
          </TouchableOpacity>
          {sortedFloors.map((f) => (
            <TouchableOpacity
              key={f}
              style={[styles.floorChip, selectedFloor === f && styles.floorChipActive]}
              onPress={() => setSelectedFloor(f)}
            >
              <Text style={[styles.floorChipText, selectedFloor === f && styles.floorChipTextActive]}>
                {f === 'Other' ? 'Other' : `Floor ${f}`}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.refreshBtn} onPress={onRefresh} activeOpacity={0.85}>
          <MaterialCommunityIcons name="refresh" size={22} color="#0f172a" />
        </TouchableOpacity>
      </View>

      {cleaningSession.hasActiveSession ? (
        <TouchableOpacity
          style={styles.activeBanner}
          onPress={onContinueCleaningPress}
          activeOpacity={0.9}
        >
          <Text style={styles.activeBannerText}>
            Cleaning in progress • {cleaningSession.timerLabel} — tap to continue
          </Text>
        </TouchableOpacity>
      ) : null}

      <View style={styles.gridHeader}>
        <Text style={styles.gridTitle}>Room grid</Text>
        <View style={styles.legendRow}>
          {LEGEND.map((item) => (
            <View key={item.label} style={styles.legendItem}>
              <View style={[styles.legendDot, { backgroundColor: item.color }]} />
              <Text style={styles.legendText}>{item.label}</Text>
            </View>
          ))}
        </View>
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </>
  );

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

  return (
    <View style={styles.root}>
      {loading && rooms.length === 0 ? (
        <ScrollView contentContainerStyle={styles.scrollPad}>
          {listHeader}
          <RoomListSkeleton />
        </ScrollView>
      ) : (
        <FlatList
          data={filteredRooms}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          numColumns={tilesPerRow}
          key={`grid-${tilesPerRow}`}
          columnWrapperStyle={tilesPerRow > 1 ? styles.columnWrap : undefined}
          ListHeaderComponent={listHeader}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          ListEmptyComponent={
            <Text style={styles.muted}>
              {error ? error : 'No rooms found for your company. Pull down to refresh.'}
            </Text>
          }
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          removeClippedSubviews
        />
      )}

      <RoomActionModal
        visible={modalVisible}
        room={modalRoom}
        activeSessionRoomId={cleaningSession.roomId}
        cleaningActiveForRoom={cleaningActiveForModal}
        onClose={closeModal}
        onStartCleaning={onStartCleaningPress}
        onContinueCleaning={onContinueCleaningPress}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F0E8' },
  scrollPad: { padding: 16, paddingBottom: 32 },
  listContent: { paddingHorizontal: 16, paddingBottom: 32 },
  columnWrap: { justifyContent: 'flex-start' },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F0E8' },
  heroCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    alignItems: 'center',
  },
  heroIcon: { marginBottom: 10 },
  subtitle: { fontSize: 14, color: '#64748b', lineHeight: 21, textAlign: 'center', marginTop: 4 },
  filtersCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
  },
  filtersTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 4 },
  filtersHint: { fontSize: 13, color: '#64748b', marginBottom: 12 },
  filterLabel: { fontSize: 13, fontWeight: '600', color: '#334155', marginBottom: 8 },
  floorScroll: { marginBottom: 12, maxHeight: 44 },
  floorChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    marginRight: 8,
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  floorChipActive: { backgroundColor: '#0f172a', borderColor: '#0f172a' },
  floorChipText: { fontSize: 13, fontWeight: '600', color: '#334155' },
  floorChipTextActive: { color: '#fff' },
  refreshBtn: {
    alignSelf: 'flex-start',
    width: 44,
    height: 44,
    borderRadius: 10,
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  activeBanner: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  activeBannerText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  gridHeader: { marginBottom: 12 },
  gridTitle: { fontSize: 16, fontWeight: '700', color: '#0f172a', marginBottom: 10 },
  legendRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: 4 },
  legendDot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: '#64748b', fontWeight: '500' },
  error: { color: '#b91c1c', marginBottom: 12, fontSize: 14 },
  muted: { color: '#64748b', textAlign: 'center', marginTop: 24, paddingHorizontal: 16 },
  denied: { color: '#64748b', fontSize: 16 },
});
