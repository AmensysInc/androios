import React, { memo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import type { MotelRoomRow } from '../../api';
import {
  getEmployeeRoomTileColor,
  motelRoomFloorLabel,
  motelRoomNumber,
} from '../../lib/motelRoomDisplay';

type Props = {
  room: MotelRoomRow;
  width: number;
  onPress: () => void;
};

function MotelRoomGridTileInner({ room, width, onPress }: Props) {
  const bg = getEmployeeRoomTileColor(room);
  const floor = motelRoomFloorLabel(room);
  return (
    <TouchableOpacity
      style={[styles.tile, { width, backgroundColor: bg }]}
      onPress={onPress}
      activeOpacity={0.88}
    >
      <Text style={styles.roomNum}>{motelRoomNumber(room)}</Text>
      <Text style={styles.floor}>{floor}</Text>
    </TouchableOpacity>
  );
}

const MotelRoomGridTile = memo(MotelRoomGridTileInner);
export default MotelRoomGridTile;

const styles = StyleSheet.create({
  tile: {
    borderRadius: 14,
    paddingVertical: 22,
    paddingHorizontal: 12,
    marginBottom: 12,
    minHeight: 96,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
  },
  roomNum: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0f172a',
    textAlign: 'center',
  },
  floor: {
    fontSize: 13,
    fontWeight: '500',
    color: '#334155',
    marginTop: 6,
    textAlign: 'center',
  },
});
