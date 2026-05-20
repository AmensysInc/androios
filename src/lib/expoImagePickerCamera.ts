import * as ImagePicker from 'expo-image-picker';

/** Camera-only launch options (avoids deprecated MediaTypeOptions). */
export function launchCleaningCameraAsync(quality = 0.52): Promise<ImagePicker.ImagePickerResult> {
  const options: ImagePicker.ImagePickerOptions = {
    quality,
    allowsEditing: false,
  };
  const mt = (ImagePicker as { MediaType?: { Images?: ImagePicker.MediaType } }).MediaType?.Images;
  if (mt != null) {
    options.mediaTypes = mt;
  } else {
    options.mediaTypes = ['images'] as ImagePicker.MediaType[];
  }
  return ImagePicker.launchCameraAsync(options);
}

export async function ensureCameraPermission(): Promise<boolean> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  return perm.granted;
}
