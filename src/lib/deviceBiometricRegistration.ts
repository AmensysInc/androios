/**
 * Per-user, per-device registration for secure clock-in.
 * Uses the device Face ID / fingerprint already enrolled in system Settings — no face images are sent to your server.
 */
import { Alert, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
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
      'Biometrics not set up on this device',
      'Add Face ID, Touch ID, or fingerprint in your device Settings to use secure verification at clock-in. You can still use the app with your password.',
      [
        {
          text: 'OK',
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
    'Register this device',
    `Use ${label} on this device so we can verify it’s you when you clock in or out. Each phone or tablet is registered separately. Nothing is sent to the server — your device confirms your identity.`,
    [
      {
        text: 'Not now',
        style: 'cancel',
        onPress: () => {
          openPromptForUser = null;
          void setStatus(userId, 'skipped');
        },
      },
      {
        text: 'Register',
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
    const ok = await authenticateWithBiometrics('Verify your identity to register this device');
    if (!ok) {
      Alert.alert(
        'Not registered',
        'Biometric verification was cancelled. You can try again after the next sign-in.',
      );
      return;
    }
    const access = await apiClient.getToken();
    if (access) await enableBiometricLogin(access);
    await setClockBiometricEnabled(true);
    await setStatus(userId, 'registered');
    Alert.alert(
      'Device registered',
      'We’ll ask for your face or fingerprint when you clock in or out on this device. You can turn this off on the Clock In screen anytime.',
    );
  } catch (e) {
    console.warn(e);
    Alert.alert('Error', 'Could not complete registration. Try again after signing in.');
  } finally {
    onDone();
  }
}
