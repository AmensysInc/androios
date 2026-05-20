import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { MotelRoomRow } from '../../api';
import {
  getEmployeeRoomCleaningBadge,
  motelRoomFloor,
  motelRoomNumber,
  motelRoomType,
} from '../../lib/motelRoomDisplay';

type Props = {
  room: MotelRoomRow;
  onPress: () => void;
};

function MotelRoomCardInner({ room, onPress }: Props) {
  const badge = getEmployeeRoomCleaningBadge(room);
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.row}>
        <Text style={styles.roomNum}>Room {motelRoomNumber(room)}</Text>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeText, { color: badge.text }]}>{badge.label}</Text>
        </View>
      </View>
      <Text style={styles.meta}>Type: {motelRoomType(room)}</Text>
      <Text style={styles.meta}>Floor: {motelRoomFloor(room)}</Text>
    </TouchableOpacity>
  );
}

const MotelRoomCard = memo(MotelRoomCardInner);
export default MotelRoomCard;

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    minHeight: 88,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  roomNum: { fontSize: 17, fontWeight: '700', color: '#0f172a', flex: 1 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  meta: { fontSize: 13, color: '#64748b', marginTop: 2 },
});
