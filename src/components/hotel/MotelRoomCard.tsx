import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { MotelRoomRow } from '../../api';
import {
  getEmployeeRoomCleaningBadge,
  motelRoomFloor,
  motelRoomNumber,
  motelRoomType,
} from '../../lib/motelRoomDisplay';
import { localizedCleaningBadgeLabel, localizedFloorLabel } from '../../lib/housekeepingI18n';

type Props = {
  room: MotelRoomRow;
  onPress: () => void;
};

function MotelRoomCardInner({ room, onPress }: Props) {
  const { t } = useTranslation();
  const badge = getEmployeeRoomCleaningBadge(room);
  const badgeLabel = localizedCleaningBadgeLabel(t, room);
  return (
    <TouchableOpacity style={styles.card} onPress={onPress} activeOpacity={0.88}>
      <View style={styles.row}>
        <Text style={styles.roomNum}>{t('housekeeping.roomTitle', { number: motelRoomNumber(room) })}</Text>
        <View style={[styles.badge, { backgroundColor: badge.bg }]}>
          <Text style={[styles.badgeText, { color: badge.text }]}>{badgeLabel}</Text>
        </View>
      </View>
      <Text style={styles.meta}>
        {t('housekeeping.details.roomType')}: {motelRoomType(room)}
      </Text>
      <Text style={styles.meta}>
        {t('housekeeping.details.floor')}: {localizedFloorLabel(t, motelRoomFloor(room))}
      </Text>
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
