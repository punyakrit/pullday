import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

const { AndroidHaptics, ImpactFeedbackStyle, NotificationFeedbackType } = Haptics;

/** Android has its own feedback types, which follow the person's system setting. */
function play(android: Haptics.AndroidHaptics, ios: () => Promise<void>): void {
  const done = Platform.OS === 'android' ? Haptics.performAndroidHapticsAsync(android) : ios();
  done.catch(() => {});
}

export const haptics = {
  /** The card has gone far enough: letting go now will throw it. */
  armed: () => play(AndroidHaptics.Segment_Tick, () => Haptics.selectionAsync()),
  right: () => play(AndroidHaptics.Confirm, () => Haptics.notificationAsync(NotificationFeedbackType.Success)),
  wrong: () => play(AndroidHaptics.Reject, () => Haptics.notificationAsync(NotificationFeedbackType.Error)),
  pull: () => play(AndroidHaptics.Gesture_Start, () => Haptics.impactAsync(ImpactFeedbackStyle.Medium)),
  common: () => play(AndroidHaptics.Confirm, () => Haptics.impactAsync(ImpactFeedbackStyle.Light)),
  special: () => play(AndroidHaptics.Long_Press, () => Haptics.impactAsync(ImpactFeedbackStyle.Heavy)),
};
