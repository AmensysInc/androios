import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Image,
  TextInput,
  Pressable,
  Modal,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import type { MotelRoomRow, MotelCleaningImageAsset } from '../../api';
import * as api from '../../api';
import { HttpError } from '../../lib/api-client';
import {
  canEmployeeStartCleaning,
  getEmployeeRoomCleaningBadge,
  motelRoomFloor,
  motelRoomFloorLabel,
  motelRoomNumber,
  motelRoomType,
  motelRoomUuid,
  patchRoomAfterCleaningSubmit,
} from '../../lib/motelRoomDisplay';
import {
  localizedCleaningBadgeLabel,
  localizedEmployeeRoomStatus,
  localizedFloorLabel,
  localizedPhotoStepLabel,
} from '../../lib/housekeepingI18n';
import { useMotelCleaningSessionContext } from '../../context/MotelCleaningSessionContext';
import type { EmployeeRoomsStackParamList } from '../../navigation/EmployeeRoomsStack';
import {
  MOTEL_CLEANING_PHOTO_STEPS,
  allCleaningPhotosCaptured,
  capturedPhotoCount,
  firstIncompletePhotoStep,
  type MotelCleaningPhotosByStep,
  type MotelCleaningPhotoStepKey,
} from '../../lib/motelCleaningPhotoSteps';
import type { MotelCleaningProofFieldKey } from '../../api';
import { ensureCameraPermission, launchCleaningCameraAsync } from '../../lib/expoImagePickerCamera';

type Nav = NativeStackNavigationProp<EmployeeRoomsStackParamList, 'RoomCleaningDetails'>;
type DetailsRoute = RouteProp<EmployeeRoomsStackParamList, 'RoomCleaningDetails'>;

const CAMERA_QUALITY = 0.52;

export default function RoomCleaningDetailsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation<Nav>();
  const route = useRoute<DetailsRoute>();
  const room = route.params.room;
  const roomId = motelRoomUuid(room);

  const cleaningSession = useMotelCleaningSessionContext();

  const [localRoom, setLocalRoom] = useState<MotelRoomRow>(room);
  const badge = useMemo(() => getEmployeeRoomCleaningBadge(localRoom), [localRoom]);
  const [startBusy, setStartBusy] = useState(false);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [uploadPhase, setUploadPhase] = useState<'idle' | 'uploading' | 'completing'>('idle');
  const [photosByStep, setPhotosByStep] = useState<MotelCleaningPhotosByStep>({});
  const [notes, setNotes] = useState('');
  const [imageViewerUri, setImageViewerUri] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const submitLockRef = useRef(false);

  const cleaningActive = cleaningSession.isActiveForRoom(roomId);
  const canStart = canEmployeeStartCleaning(localRoom, cleaningSession.roomId);
  const isPending = badge.status === 'pending_approval';

  const showToast = useCallback((title: string, message?: string) => {
    Alert.alert(title, message || undefined);
  }, []);

  useEffect(() => {
    if (!toastMsg) return;
    const timer = setTimeout(() => setToastMsg(null), 3200);
    return () => clearTimeout(timer);
  }, [toastMsg]);

  const currentStep = useMemo(() => firstIncompletePhotoStep(photosByStep), [photosByStep]);
  const allPhotosDone = useMemo(() => allCleaningPhotosCaptured(photosByStep), [photosByStep]);
  const photoCount = useMemo(() => capturedPhotoCount(photosByStep), [photosByStep]);

  const stepLabel = useCallback(
    (key: MotelCleaningPhotoStepKey) => localizedPhotoStepLabel(t, key),
    [t]
  );

  const captureStepPhoto = async (stepKey?: MotelCleaningPhotoStepKey) => {
    const step = stepKey
      ? MOTEL_CLEANING_PHOTO_STEPS.find((s) => s.key === stepKey)
      : currentStep;
    if (!step) return;
    const granted = await ensureCameraPermission();
    if (!granted) {
      showToast(t('housekeeping.photos.title'), t('housekeeping.photos.cameraRequired'));
      return;
    }
    const result = await launchCleaningCameraAsync(CAMERA_QUALITY);
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setPhotosByStep((prev) => ({
      ...prev,
      [step.key]: { ...asset, id: `${step.key}_${Date.now()}` },
    }));
  };

  const removeStepPhoto = (stepKey: MotelCleaningPhotoStepKey) => {
    setPhotosByStep((prev) => {
      const next = { ...prev };
      delete next[stepKey];
      return next;
    });
  };

  const startCleaning = async () => {
    if (!roomId) {
      showToast(t('housekeeping.workflow.startCleaning'), t('housekeeping.validation.roomIdMissing'));
      return;
    }
    if (!canStart) {
      if (cleaningSession.hasActiveSession && cleaningSession.roomId !== roomId) {
        showToast(t('housekeeping.cleaningInProgress'), t('housekeeping.finishOtherRoomFirst'));
      }
      return;
    }
    setStartBusy(true);
    try {
      const res = (await api.startMotelCleaning(roomId)) as Record<string, unknown>;
      const sid = api.resolveMotelCleaningSessionId(res);
      if (!sid) {
        showToast(t('housekeeping.workflow.startCleaning'), t('housekeeping.validation.sessionIdMissing'));
        return;
      }
      await cleaningSession.beginSession(roomId, sid);
      setPhotosByStep({});
    } catch (e: unknown) {
      const msg =
        e instanceof HttpError
          ? String((e.body as any)?.detail ?? e.message)
          : e instanceof Error
            ? e.message
            : t('housekeeping.toast.requestFailed');
      showToast(t('housekeeping.workflow.startCleaning'), msg);
    } finally {
      setStartBusy(false);
    }
  };

  const finishCleaning = async () => {
    if (submitLockRef.current || submitBusy) return;
    if (!cleaningSession.sessionId || !cleaningActive) {
      showToast(t('housekeeping.workflow.finishCleaning'), t('housekeeping.validation.startCleaningFirst'));
      return;
    }
    const missing = MOTEL_CLEANING_PHOTO_STEPS.find((s) => !photosByStep[s.key]);
    if (missing) {
      showToast(
        t('housekeeping.validation.photosRequired'),
        t('housekeeping.validation.capturePhoto', { label: stepLabel(missing.key) })
      );
      return;
    }

    submitLockRef.current = true;
    setSubmitBusy(true);
    setUploadPhase('uploading');

    const assets: MotelCleaningImageAsset[] = MOTEL_CLEANING_PHOTO_STEPS.map(({ key }) => {
      const img = photosByStep[key]!;
      return {
        uri: img.uri,
        fieldKey: key as MotelCleaningProofFieldKey,
        fileName: `${key}.jpg`,
        mimeType: img.mimeType ?? 'image/jpeg',
      };
    });

    try {
      await api.completeMotelCleaningWithPhotos(cleaningSession.sessionId, assets, {
        roomId,
        notes: notes.trim() || undefined,
      });
      await cleaningSession.clearSession();
      const patched = patchRoomAfterCleaningSubmit(localRoom);
      setLocalRoom(patched);
      setPhotosByStep({});
      setToastMsg({ type: 'success', text: t('housekeeping.toast.submittedPendingApproval') });
      navigation.navigate({
        name: 'EmployeeRoomsList',
        params: { submittedRoomId: roomId },
        merge: true,
      });
    } catch (e: unknown) {
      const msg =
        e instanceof HttpError
          ? String((e.body as any)?.detail ?? e.message)
          : e instanceof Error
            ? e.message
            : t('housekeeping.toast.uploadFailed');
      setToastMsg({ type: 'error', text: msg });
      Alert.alert(t('housekeeping.toast.submitFailed'), msg, [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('housekeeping.retry'), onPress: () => void finishCleaning() },
      ]);
    } finally {
      setSubmitBusy(false);
      setUploadPhase('idle');
      submitLockRef.current = false;
    }
  };

  const onFinishPress = () => {
    if (!cleaningActive) return;
    void finishCleaning();
  };

  const displayBadgeLabel = localizedCleaningBadgeLabel(t, localRoom);
  const roomStatusLabel = localizedEmployeeRoomStatus(t, localRoom);
  const floorDisplay = localizedFloorLabel(t, motelRoomFloorLabel(localRoom));

  return (
    <View style={styles.root}>
      {toastMsg ? (
        <View style={[styles.toast, toastMsg.type === 'success' ? styles.toastSuccess : styles.toastError]}>
          <Text style={styles.toastText}>{toastMsg.text}</Text>
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{t('housekeeping.roomTitle', { number: motelRoomNumber(localRoom) })}</Text>
        <Text style={styles.subtitleHeader}>
          {floorDisplay} - {roomStatusLabel}
        </Text>

        <View style={styles.detailCard}>
          <Row label={t('housekeeping.details.roomNumber')} value={motelRoomNumber(localRoom)} />
          <Row label={t('housekeeping.details.roomType')} value={motelRoomType(localRoom)} />
          <Row label={t('housekeeping.details.floor')} value={motelRoomFloor(localRoom)} />
          <Row label={t('housekeeping.details.roomStatus')} value={roomStatusLabel} />
          <View style={styles.badgeRow}>
            <Text style={styles.rowLabel}>{t('housekeeping.details.cleaningStatus')}</Text>
            <View style={[styles.badge, { backgroundColor: badge.bg }]}>
              <Text style={[styles.badgeText, { color: badge.text }]}>
                {displayBadgeLabel}
              </Text>
            </View>
          </View>
        </View>

        {cleaningActive ? (
          <View style={styles.timerCard}>
            <Text style={styles.timerLabel}>{t('housekeeping.timer.cleaningTimer')}</Text>
            <Text style={styles.timerValue}>{cleaningSession.timerLabel}</Text>
            <Text style={styles.timerHint}>{t('housekeeping.timer.timerHint')}</Text>
          </View>
        ) : null}

        {isPending ? (
          <View style={styles.infoBox}>
            <Text style={styles.infoText}>{t('housekeeping.inspection.pendingApprovalHint')}</Text>
          </View>
        ) : null}

        {canStart && !cleaningActive ? (
          <TouchableOpacity
            style={[styles.btnPrimaryBlue, startBusy && styles.btnDisabled]}
            onPress={() => void startCleaning()}
            disabled={startBusy}
          >
            {startBusy ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnPrimaryText}>{t('housekeeping.workflow.startCleaning')}</Text>
            )}
          </TouchableOpacity>
        ) : null}

        {cleaningActive ? (
          <>
            <View style={styles.photosCard}>
              <Text style={styles.sectionTitle}>{t('housekeeping.photos.title')}</Text>

              {currentStep && !allPhotosDone ? (
                <>
                  <Text style={styles.stepIndicator}>
                    {t('housekeeping.photos.stepIndicator', {
                      current: photoCount + 1,
                      label: stepLabel(currentStep.key),
                    })}
                  </Text>
                  <TouchableOpacity
                    style={[styles.btnTakePhoto, submitBusy && styles.btnDisabled]}
                    onPress={() => void captureStepPhoto(currentStep.key)}
                    disabled={submitBusy}
                    activeOpacity={0.9}
                  >
                    <Text style={styles.btnTakePhotoText}>
                      {t('housekeeping.photos.takePhoto', { label: stepLabel(currentStep.key) })}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : allPhotosDone ? (
                <Text style={styles.stepDoneHint}>{t('housekeeping.photos.allPhotosCaptured')}</Text>
              ) : null}

              <View style={styles.checklist}>
                {MOTEL_CLEANING_PHOTO_STEPS.map((step, index) => {
                  const img = photosByStep[step.key];
                  const done = Boolean(img);
                  const isCurrent = !allPhotosDone && currentStep?.key === step.key;
                  const label = stepLabel(step.key);
                  return (
                    <View
                      key={step.key}
                      style={[
                        styles.checklistRow,
                        done && styles.checklistRowDone,
                        isCurrent && styles.checklistRowCurrent,
                      ]}
                    >
                      <View style={styles.checklistLeft}>
                        <Text style={[styles.checklistLabel, done && styles.checklistLabelDone]}>
                          {done ? '✓ ' : ''}
                          {label}
                        </Text>
                        {isCurrent ? (
                          <Text style={styles.checklistSub}>{t('housekeeping.photos.currentStep')}</Text>
                        ) : null}
                      </View>
                      {done && img ? (
                        <View style={styles.checklistRight}>
                          <TouchableOpacity
                            onPress={() => setImageViewerUri(img.uri)}
                            activeOpacity={0.9}
                            accessibilityLabel={t('housekeeping.photos.viewImage')}
                          >
                            <Image source={{ uri: img.uri }} style={styles.checklistThumb} resizeMode="cover" />
                          </TouchableOpacity>
                          <TouchableOpacity
                            onPress={() => removeStepPhoto(step.key)}
                            disabled={submitBusy}
                            hitSlop={8}
                          >
                            <Text style={styles.retakeText}>{t('housekeeping.photos.retake')}</Text>
                          </TouchableOpacity>
                        </View>
                      ) : !done && !allPhotosDone ? (
                        <TouchableOpacity
                          onPress={() => void captureStepPhoto(step.key)}
                          disabled={submitBusy || (!isCurrent && index > photoCount)}
                          hitSlop={8}
                        >
                          <Text
                            style={[
                              styles.captureLink,
                              (!isCurrent && index > photoCount) && styles.captureLinkDisabled,
                            ]}
                          >
                            {t('housekeeping.photos.capture')}
                          </Text>
                        </TouchableOpacity>
                      ) : null}
                    </View>
                  );
                })}
              </View>

              {photoCount > 0 ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.previewScroll}>
                  {MOTEL_CLEANING_PHOTO_STEPS.map(({ key }) => {
                    const img = photosByStep[key];
                    if (!img) return null;
                    return (
                      <View key={key} style={styles.thumbWrap}>
                        <Text style={styles.thumbCaption}>{stepLabel(key)}</Text>
                        <TouchableOpacity
                          onPress={() => setImageViewerUri(img.uri)}
                          activeOpacity={0.9}
                          accessibilityLabel={t('housekeeping.photos.viewImage')}
                        >
                          <Image source={{ uri: img.uri }} style={styles.thumb} resizeMode="cover" />
                        </TouchableOpacity>
                      </View>
                    );
                  })}
                </ScrollView>
              ) : (
                <Text style={styles.hint}>{t('housekeeping.photos.captureHint')}</Text>
              )}
            </View>

            <Text style={styles.sectionTitle}>{t('housekeeping.workflow.cleaningNotes')}</Text>
            <TextInput
              style={styles.notesInput}
              value={notes}
              onChangeText={setNotes}
              placeholder={t('housekeeping.details.notesPlaceholder')}
              placeholderTextColor="#94a3b8"
              multiline
              editable={!submitBusy}
            />

            {submitBusy && uploadPhase !== 'idle' ? (
              <View style={styles.progressRow}>
                <ActivityIndicator size="small" color="#0f172a" />
                <Text style={styles.progressText}>{t('housekeeping.submittingPhotos')}</Text>
              </View>
            ) : null}

            <TouchableOpacity
              style={styles.cancelLink}
              onPress={() => navigation.goBack()}
              disabled={submitBusy}
            >
              <Text style={styles.cancelLinkText}>{t('common.cancel')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.btnSaveFinish, (submitBusy || !allPhotosDone) && styles.btnDisabled]}
              onPress={onFinishPress}
              disabled={submitBusy || !allPhotosDone}
            >
              {submitBusy ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.btnPrimaryText}>{t('housekeeping.workflow.saveAndFinish')}</Text>
              )}
            </TouchableOpacity>
          </>
        ) : null}
      </ScrollView>

      <Modal visible={Boolean(imageViewerUri)} transparent animationType="fade" onRequestClose={() => setImageViewerUri(null)}>
        <Pressable style={styles.viewerBackdrop} onPress={() => setImageViewerUri(null)}>
          <Pressable style={styles.viewerInner} onPress={(e) => e.stopPropagation()}>
            {imageViewerUri ? (
              <Image source={{ uri: imageViewerUri }} style={styles.viewerImage} resizeMode="contain" />
            ) : null}
            <TouchableOpacity style={styles.viewerClose} onPress={() => setImageViewerUri(null)}>
              <Text style={styles.viewerCloseText}>{t('housekeeping.close')}</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F5F0E8' },
  scroll: { padding: 16, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', color: '#0f172a', marginBottom: 16 },
  detailCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
    gap: 10,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  rowLabel: { fontSize: 13, color: '#64748b', fontWeight: '500' },
  rowValue: { fontSize: 14, color: '#0f172a', fontWeight: '600', flex: 1, textAlign: 'right' },
  badgeRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  badge: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  badgeText: { fontSize: 12, fontWeight: '700' },
  timerCard: {
    backgroundColor: '#0f172a',
    borderRadius: 14,
    padding: 20,
    marginBottom: 16,
    alignItems: 'center',
  },
  timerLabel: { color: '#94a3b8', fontSize: 13, marginBottom: 6 },
  timerValue: { color: '#fff', fontSize: 36, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timerHint: { color: '#94a3b8', fontSize: 11, marginTop: 8, textAlign: 'center' },
  infoBox: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  infoText: { fontSize: 14, color: '#475569', lineHeight: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 8, marginTop: 8 },
  photosCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginBottom: 16,
  },
  stepIndicator: { fontSize: 14, fontWeight: '600', color: '#334155', textAlign: 'center', marginBottom: 12 },
  stepDoneHint: { fontSize: 13, color: '#166534', textAlign: 'center', marginBottom: 12, fontWeight: '500' },
  btnTakePhoto: {
    backgroundColor: '#f1f5f9',
    borderWidth: 1,
    borderColor: '#cbd5e1',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 16,
    minHeight: 48,
    justifyContent: 'center',
  },
  btnTakePhotoText: { color: '#0f172a', fontWeight: '700', fontSize: 15 },
  checklist: { gap: 8, marginBottom: 12 },
  checklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#f8fafc',
    borderWidth: 1,
    borderColor: '#e2e8f0',
  },
  checklistRowDone: { backgroundColor: '#f0fdf4', borderColor: '#bbf7d0' },
  checklistRowCurrent: { backgroundColor: '#eff6ff', borderColor: '#93c5fd' },
  checklistLeft: { flex: 1 },
  checklistLabel: { fontSize: 15, fontWeight: '600', color: '#334155' },
  checklistLabelDone: { color: '#166534' },
  checklistSub: { fontSize: 11, color: '#2563eb', marginTop: 2, fontWeight: '500' },
  checklistRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  checklistThumb: { width: 44, height: 44, borderRadius: 8, backgroundColor: '#e2e8f0' },
  retakeText: { fontSize: 13, color: '#2563eb', fontWeight: '600' },
  captureLink: { fontSize: 13, color: '#2563eb', fontWeight: '600' },
  captureLinkDisabled: { color: '#94a3b8' },
  thumbCaption: { fontSize: 10, color: '#64748b', marginBottom: 4, textAlign: 'center', fontWeight: '600' },
  cancelLink: { alignItems: 'center', paddingVertical: 10, marginTop: 4 },
  cancelLinkText: { fontSize: 15, color: '#64748b', fontWeight: '500' },
  btnSaveFinish: {
    backgroundColor: '#0f172a',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 4,
    minHeight: 48,
    justifyContent: 'center',
  },
  hint: { fontSize: 12, color: '#64748b', marginBottom: 4, textAlign: 'center' },
  subtitleHeader: { fontSize: 14, color: '#64748b', marginBottom: 16, textAlign: 'center' },
  btnPrimaryBlue: {
    backgroundColor: '#2563eb',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 8,
    minHeight: 48,
    justifyContent: 'center',
  },
  btnPrimaryText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  btnDisabled: { opacity: 0.5 },
  notesInput: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    minHeight: 100,
    textAlignVertical: 'top',
    fontSize: 15,
    color: '#0f172a',
    marginBottom: 12,
  },
  previewScroll: { maxHeight: 110, marginBottom: 12 },
  thumbWrap: { marginRight: 10, position: 'relative' },
  thumb: { width: 88, height: 88, borderRadius: 10, backgroundColor: '#e2e8f0' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 8 },
  progressText: { fontSize: 13, color: '#475569' },
  toast: {
    position: 'absolute',
    top: 8,
    left: 16,
    right: 16,
    zIndex: 10,
    borderRadius: 10,
    padding: 12,
  },
  toastSuccess: { backgroundColor: '#166534' },
  toastError: { backgroundColor: '#b91c1c' },
  toastText: { color: '#fff', fontWeight: '600', textAlign: 'center' },
  viewerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15,23,42,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  viewerInner: { width: '100%', maxWidth: 520, borderRadius: 14, overflow: 'hidden' },
  viewerImage: { width: '100%', height: 400 },
  viewerClose: { padding: 14, alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  viewerCloseText: { color: '#fff', fontWeight: '600' },
});
