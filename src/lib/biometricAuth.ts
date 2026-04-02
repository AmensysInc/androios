/**
 * Device biometrics (Face ID / Touch ID / fingerprint) for the mobile app.
 * Uses the OS biometric gate + SecureStore for the access token when "biometric login" is enabled.
 * Account-wide face (camera + server) is handled in accountFaceAuth.ts — independent of OS biometrics.
 * Backend auth is unchanged: JWT from existing login; refresh via /api/auth/token/refresh/.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Alert, Platform } from 'react-native';

/** Must match `TOKEN_KEY` in api-client.ts */
const ACCESS_TOKEN_STORAGE_KEY = '@zenotime/access_token';

const BIOMETRIC_LOGIN_ENABLED = '@zenotime/biometric_login_enabled';
const CLOCK_BIOMETRIC_ENABLED = '@zenotime/clock_biometric_enabled';
const SECURE_ACCESS_KEY = 'zenotime_biometric_access_token';

export async function canUseBiometrics(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  try {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    if (!compatible) return false;
    return LocalAuthentication.isEnrolledAsync();
  } catch {
    return false;
  }
}

export async function isBiometricLoginEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(BIOMETRIC_LOGIN_ENABLED)) === 'true';
}

export async function isClockBiometricEnabled(): Promise<boolean> {
  return (await AsyncStorage.getItem(CLOCK_BIOMETRIC_ENABLED)) === 'true';
}

export async function setClockBiometricEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(CLOCK_BIOMETRIC_ENABLED, enabled ? 'true' : 'false');
}

/**
 * Prompt Face ID / fingerprint / device PIN (when allowed).
 */
export async function authenticateWithBiometrics(promptMessage: string): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  try {
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (!enrolled) return false;
    const result = await LocalAuthentication.authenticateAsync({
      promptMessage,
      fallbackLabel: 'Use passcode',
      cancelLabel: 'Cancel',
      disableDeviceFallback: false,
    });
    return result.success === true;
  } catch {
    return false;
  }
}

export async function humanReadableBiometricTypes(): Promise<string> {
  try {
    const types = await LocalAuthentication.supportedAuthenticationTypesAsync();
    if (types.includes(LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION)) return 'Face ID';
    if (types.includes(LocalAuthentication.AuthenticationType.FINGERPRINT)) return 'fingerprint';
    if (types.includes(LocalAuthentication.AuthenticationType.IRIS)) return 'iris';
    return 'device authentication';
  } catch {
    return 'biometrics';
  }
}

/**
 * After a successful password login: store access token in SecureStore and stop keeping it in AsyncStorage
 * so the next cold start requires biometrics to read it.
 */
export async function enableBiometricLogin(accessToken: string): Promise<void> {
  await SecureStore.setItemAsync(SECURE_ACCESS_KEY, accessToken, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  await AsyncStorage.setItem(BIOMETRIC_LOGIN_ENABLED, 'true');
  await AsyncStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
}

export async function clearBiometricLogin(): Promise<void> {
  await AsyncStorage.removeItem(BIOMETRIC_LOGIN_ENABLED);
  try {
    await SecureStore.deleteItemAsync(SECURE_ACCESS_KEY);
  } catch {
    /* noop */
  }
}

export async function loadAccessTokenAfterBiometric(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(SECURE_ACCESS_KEY);
  } catch {
    return null;
  }
}

/**
 * Clock in/out: optional extra biometric check before calling the API.
 */
export async function requireClockBiometricOrAllow(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const need = await isClockBiometricEnabled();
  if (!need) return true;
  const can = await canUseBiometrics();
  if (!can) {
    return true;
  }
  return authenticateWithBiometrics('Confirm clock in or clock out');
}

/** Same as requireClockBiometricOrAllow but shows an alert when the user cancels. */
export async function confirmClockBiometricOrAlert(): Promise<boolean> {
  const ok = await requireClockBiometricOrAllow();
  if (!ok) {
    Alert.alert('Authentication required', 'Clock action was cancelled.');
  }
  return ok;
}
