import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import type { MotelRoomRow } from '../../api';
import {
  canEmployeeStartCleaning,
  getEmployeeRoomStatusLabel,
  motelRoomFloorLabel,
  motelRoomNumber,
} from '../../lib/motelRoomDisplay';

type Props = {
  visible: boolean;
  room: MotelRoomRow | null;
  activeSessionRoomId: string | null;
  cleaningActiveForRoom: boolean;
  startBusy?: boolean;
  onClose: () => void;
  onStartCleaning: () => void;
  onContinueCleaning: () => void;
};

export default function RoomActionModal({
  visible,
  room,
  activeSessionRoomId,
  cleaningActiveForRoom,
  startBusy = false,
  onClose,
  onStartCleaning,
  onContinueCleaning,
}: Props) {
  if (!room) return null;

  const statusLabel = getEmployeeRoomStatusLabel(room);
  const floorLine = `${motelRoomFloorLabel(room)} - ${statusLabel}`;
  const canStart = canEmployeeStartCleaning(room, activeSessionRoomId);
  const showStart = canStart && !cleaningActiveForRoom;
  const showContinue = cleaningActiveForRoom;
  const isReClean =
    statusLabel === 'Approved' ||
    statusLabel === 'Completed' ||
    (room as { approved?: boolean }).approved === true ||
    String((room as { cleaning_status?: string }).cleaning_status ?? '').toLowerCase() === 'approved';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
          <TouchableOpacity style={styles.closeIcon} onPress={onClose} hitSlop={12} accessibilityLabel="Close">
            <Text style={styles.closeIconText}>×</Text>
          </TouchableOpacity>

          <Text style={styles.title}>Room {motelRoomNumber(room)}</Text>
          <Text style={styles.subtitle}>{floorLine}</Text>

          <Text style={styles.statusLine}>
            Status: <Text style={styles.statusBold}>{statusLabel}</Text>
          </Text>

          {showContinue ? (
            <TouchableOpacity style={styles.btnPrimary} onPress={onContinueCleaning} activeOpacity={0.9}>
              <Text style={styles.btnPrimaryText}>Continue cleaning</Text>
            </TouchableOpacity>
          ) : showStart ? (
            <>
              {isReClean ? (
                <Text style={styles.reCleanHint}>
                  This room was previously cleaned. You can start a new session when ready.
                </Text>
              ) : null}
              <TouchableOpacity
                style={[styles.btnPrimary, startBusy && styles.btnDisabled]}
                onPress={onStartCleaning}
                disabled={startBusy}
                activeOpacity={0.9}
              >
                {startBusy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.btnPrimaryText}>Start cleaning</Text>
                )}
              </TouchableOpacity>
            </>
          ) : (
            <Text style={styles.blockedHint}>
              {statusLabel === 'Pending Approval'
                ? 'This room is waiting for admin approval.'
                : 'Cleaning cannot be started for this room right now.'}
            </Text>
          )}

          <TouchableOpacity style={styles.closeLink} onPress={onClose} activeOpacity={0.7}>
            <Text style={styles.closeLinkText}>Close</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 24,
    paddingTop: 20,
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 8,
  },
  closeIcon: {
    position: 'absolute',
    top: 12,
    right: 14,
    zIndex: 1,
  },
  closeIconText: { fontSize: 26, color: '#64748b', lineHeight: 28 },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a', marginBottom: 6, textAlign: 'center' },
  subtitle: { fontSize: 14, color: '#64748b', marginBottom: 16, textAlign: 'center' },
  statusLine: { fontSize: 15, color: '#334155', marginBottom: 20, textAlign: 'center' },
  statusBold: { fontWeight: '700', color: '#0f172a' },
  btnPrimary: {
    width: '100%',
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    minHeight: 48,
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  btnDisabled: { opacity: 0.6 },
  reCleanHint: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 12,
    paddingHorizontal: 8,
  },
  blockedHint: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 4,
    paddingHorizontal: 8,
  },
  closeLink: { marginTop: 16, paddingVertical: 8 },
  closeLinkText: { fontSize: 15, color: '#64748b', fontWeight: '500' },
});
