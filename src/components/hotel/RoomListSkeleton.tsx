import React from 'react';
import { View, StyleSheet } from 'react-native';

export default function RoomListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View style={styles.wrap}>
      {Array.from({ length: count }).map((_, i) => (
        <View key={i} style={styles.card}>
          <View style={[styles.line, styles.lineShort]} />
          <View style={styles.line} />
          <View style={[styles.line, styles.badge]} />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, paddingTop: 8 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    gap: 10,
  },
  line: { height: 14, borderRadius: 6, backgroundColor: '#e2e8f0' },
  lineShort: { width: '40%' },
  badge: { width: 120, height: 22, marginTop: 4 },
});
