/**
 * Account-wide face enrollment (server-stored) and verification for clock-in/out and optional post-login check.
 * Complements device Face ID / fingerprint in biometricAuth.ts.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import apiClient, { HttpError } from './api-client';
import i18n from '../i18n';

const LOGIN_FACE_GATE_KEY = '@zenotime/login_face_gate_done_user';

export type FaceEnrollmentStatus = { enrolled: boolean; enrolled_at: string | null };

export async function getFaceEnrollmentStatus(): Promise<FaceEnrollmentStatus> {
  try {
    const data = await apiClient.get<any>('/scheduler/face-enrollment/me/');
    return {
      enrolled: !!data?.enrolled,
      enrolled_at: typeof data?.enrolled_at === 'string' ? data.enrolled_at : null,
    };
  } catch {
    return { enrolled: false, enrolled_at: null };
  }
}

async function ensureCameraPermission(): Promise<boolean> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    Alert.alert(i18n.t('authLibs.cameraPermissionTitle'), i18n.t('authLibs.cameraPermissionMessage'));
    return false;
  }
  return true;
}

export async function pickFacePhotoFromCamera(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  if (!(await ensureCameraPermission())) return null;
  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.85,
  });
  if (result.canceled || !result.assets?.[0]?.uri) return null;
  return result.assets[0].uri;
}

function imagePartForForm(uri: string): { uri: string; name: string; type: string } {
  const name = uri.split('/').pop() || 'face.jpg';
  const ext = name.includes('.') ? name.split('.').pop()?.toLowerCase() : '';
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return { uri, name: name.includes('.') ? name : `${name}.jpg`, type };
}

function formDataWithImage(uri: string): FormData {
  const form = new FormData();
  const part = imagePartForForm(uri);
  form.append('image', { uri: part.uri, name: part.name, type: part.type } as any);
  return form;
}

export async function enrollFaceWithUri(uri: string): Promise<void> {
  await apiClient.postFormData('/scheduler/face-enrollment/me/', formDataWithImage(uri));
}

export async function verifyFaceWithUri(uri: string): Promise<{
  verified: boolean;
  unavailable: boolean;
  message?: string;
}> {
  try {
    const data = await apiClient.postFormData<{ verified?: boolean; detail?: string }>(
      '/scheduler/face-enrollment/verify-me/',
      formDataWithImage(uri),
    );
    return { verified: !!data?.verified, unavailable: false };
  } catch (e: unknown) {
    if (e instanceof HttpError && e.status === 503) {
      return { verified: false, unavailable: true, message: e.message };
    }
    const msg = e instanceof Error ? e.message : 'Verification failed';
    return { verified: false, unavailable: false, message: msg };
  }
}

export async function deleteFaceEnrollment(): Promise<void> {
  await apiClient.delete('/scheduler/face-enrollment/me/');
}

export async function clearFaceSessionFlags(): Promise<void> {
  await AsyncStorage.removeItem(LOGIN_FACE_GATE_KEY);
}

/**
 * When enrollment exists, require a matching live capture before clock actions.
 */
export async function confirmAccountFaceForClockOrAlert(): Promise<boolean> {
  if (Platform.OS === 'web') return true;
  const st = await getFaceEnrollmentStatus();
  if (!st.enrolled) return true;

  const uri = await pickFacePhotoFromCamera();
  if (!uri) {
    Alert.alert(i18n.t('authLibs.faceRequiredTitle'), i18n.t('authLibs.faceRequiredMessage'));
    return false;
  }

  const res = await verifyFaceWithUri(uri);
  if (res.unavailable) {
    Alert.alert(
      i18n.t('authLibs.faceVerificationUnavailableTitle'),
      i18n.t('authLibs.faceVerificationUnavailableMessage'),
    );
    return false;
  }
  if (!res.verified) {
    Alert.alert(i18n.t('authLibs.faceNotRecognizedTitle'), i18n.t('authLibs.faceNotRecognizedMessage'));
    return false;
  }
  return true;
}

/**
 * Once per signed-in user per app install session: optional post-login face check when enrolled.
 */
export async function runPostLoginFacePromptIfNeeded(userId: string): Promise<void> {
  if (Platform.OS === 'web' || !userId) return;
  const gated = await AsyncStorage.getItem(LOGIN_FACE_GATE_KEY);
  if (gated === userId) return;

  const st = await getFaceEnrollmentStatus();
  if (!st.enrolled) {
    await AsyncStorage.setItem(LOGIN_FACE_GATE_KEY, userId);
    return;
  }

  await new Promise<void>((resolve) => {
    Alert.alert(
      i18n.t('authLibs.verifyFaceTitle'),
      i18n.t('authLibs.verifyFaceMessage'),
      [
        {
          text: i18n.t('authLibs.later'),
          style: 'cancel',
          onPress: () => {
            void (async () => {
              await AsyncStorage.setItem(LOGIN_FACE_GATE_KEY, userId);
              resolve();
            })();
          },
        },
        {
          text: i18n.t('authLibs.verify'),
          onPress: () => {
            void (async () => {
              const uri = await pickFacePhotoFromCamera();
              if (uri) {
                const res = await verifyFaceWithUri(uri);
                if (res.unavailable) {
                  Alert.alert(i18n.t('authLibs.faceUnavailableTitle'), res.message || i18n.t('authLibs.faceNotVerifiedMessage'));
                } else if (!res.verified) {
                  Alert.alert(i18n.t('authLibs.faceNotVerifiedTitle'), i18n.t('authLibs.faceNotVerifiedMessage'));
                }
              }
              await AsyncStorage.setItem(LOGIN_FACE_GATE_KEY, userId);
              resolve();
            })();
          },
        },
      ],
      {
        cancelable: true,
        onDismiss: () => {
          void (async () => {
            await AsyncStorage.setItem(LOGIN_FACE_GATE_KEY, userId);
            resolve();
          })();
        },
      },
    );
  });
}
