/**
 * Per-user, per-device registration for secure clock-in.
 * Uses the device Face ID / fingerprint already enrolled in system Settings — no face images are sent to your server.
 */
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from '../i18n';
import apiClient from './api-client';
import {
  authenticateWithBiometrics,
  canUseBiometrics,
  enableBiometricLogin,
  humanReadableBiometricTypes,
  setClockBiometricEnabled,
} from './biometricAuth';

const regKey = (userId: string) => `@zenotime/device_bio_reg:${userId}`;

export type DeviceBioRegStatus = 'unset' | 'registered' | 'skipped';

async function getStatus(userId: string): Promise<DeviceBioRegStatus> {
  const v = await AsyncStorage.getItem(regKey(userId));
  if (v === 'registered' || v === 'skipped') return v;
  return 'unset';
}

async function setStatus(userId: string, status: 'registered' | 'skipped'): Promise<void> {
  await AsyncStorage.setItem(regKey(userId), status);
}

/** For Account / settings: whether this user completed registration on this device. */
export async function getDeviceRegistrationStatus(userId: string): Promise<DeviceBioRegStatus> {
  return getStatus(userId);
}

/** Avoid stacking duplicate registration dialogs for the same user. */
let openPromptForUser: string | null = null;

/**
 * First-time on this device for this user: offer to register Face ID / fingerprint for clock-in verification.
 * Safe to call on every app open — shows at most once per user per device (until they choose).
 */
export async function promptFirstTimeDeviceRegistration(userId: string): Promise<void> {
  if (Platform.OS === 'web' || !userId) return;
  if (openPromptForUser === userId) return;

  const status = await getStatus(userId);
  if (status !== 'unset') return;

  const can = await canUseBiometrics();
  if (!can) {
    openPromptForUser = userId;
    Alert.alert(
      i18n.t('authLibs.biometricsNotSetupTitle'),
      i18n.t('authLibs.biometricsNotSetupMessage'),
      [
        {
          text: i18n.t('authLibs.ok'),
          onPress: () => {
            openPromptForUser = null;
            void setStatus(userId, 'skipped');
          },
        },
      ],
    );
    return;
  }

  openPromptForUser = userId;
  const label = await humanReadableBiometricTypes();
  Alert.alert(
    i18n.t('authLibs.registerDeviceTitle'),
    i18n.t('authLibs.registerDeviceMessage', { label }),
    [
      {
        text: i18n.t('authLibs.notNow'),
        style: 'cancel',
        onPress: () => {
          openPromptForUser = null;
          void setStatus(userId, 'skipped');
        },
      },
      {
        text: i18n.t('authLibs.register'),
        onPress: () =>
          void runRegister(userId, () => {
            openPromptForUser = null;
          }),
      },
    ],
  );
}

async function runRegister(userId: string, onDone: () => void): Promise<void> {
  try {
    const ok = await authenticateWithBiometrics(i18n.t('authLibs.registerDeviceVerifyPrompt'));
    if (!ok) {
      Alert.alert(
        i18n.t('authLibs.notRegisteredTitle'),
        i18n.t('authLibs.notRegisteredMessage'),
      );
      return;
    }
    const access = await apiClient.getToken();
    if (access) await enableBiometricLogin(access);
    await setClockBiometricEnabled(true);
    await setStatus(userId, 'registered');
    Alert.alert(
      i18n.t('authLibs.deviceRegisteredTitle'),
      i18n.t('authLibs.deviceRegisteredMessage'),
    );
  } catch {
    Alert.alert(i18n.t('common.error'), i18n.t('authLibs.registrationFailed'));
  } finally {
    onDone();
  }
}
