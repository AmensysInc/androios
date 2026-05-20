import type { ImagePickerAsset } from 'expo-image-picker';

/** Required cleaning photos — same order as web Rooms guided capture. */
export const MOTEL_CLEANING_PHOTO_STEPS = [
  { key: 'door', label: 'Door' },
  { key: 'bathroom', label: 'Bathroom' },
  { key: 'bed', label: 'Bed' },
  { key: 'tables', label: 'Tables' },
  { key: 'whole_room', label: 'Whole room' },
] as const;

export type MotelCleaningPhotoStepKey = (typeof MOTEL_CLEANING_PHOTO_STEPS)[number]['key'];

export type MotelCleaningPhotosByStep = Partial<
  Record<MotelCleaningPhotoStepKey, ImagePickerAsset & { id: string }>
>;

export function firstIncompletePhotoStep(
  photos: MotelCleaningPhotosByStep
): (typeof MOTEL_CLEANING_PHOTO_STEPS)[number] | null {
  return MOTEL_CLEANING_PHOTO_STEPS.find((s) => !photos[s.key]) ?? null;
}

export function allCleaningPhotosCaptured(photos: MotelCleaningPhotosByStep): boolean {
  return MOTEL_CLEANING_PHOTO_STEPS.every((s) => Boolean(photos[s.key]));
}

export function capturedPhotoCount(photos: MotelCleaningPhotosByStep): number {
  return MOTEL_CLEANING_PHOTO_STEPS.filter((s) => photos[s.key]).length;
}
