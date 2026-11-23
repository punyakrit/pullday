import { useEffect } from 'react';
import { Modal, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { GestureDetector, GestureHandlerRootView, usePanGesture } from 'react-native-gesture-handler';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';
import { PRODUCT } from '../core/store';
import { store, useStoreSheet } from '../lib/store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icons';
import { Words } from '../ui/Words';
import { hairline } from '../ui/hairline';
import { colors, space } from '../ui/theme';

const close = () => store.cancel();

/** The fake store's own sheet. A real store would draw this, over everything. */
export function StoreSheet() {
  const sheet = useStoreSheet();
  return (
    <Modal visible={sheet !== null} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={close}>
      <GestureHandlerRootView style={styles.fill}>
        <Pressable style={styles.shade} accessibilityLabel="Close the store" accessibilityRole="button" onPress={close} />
        {sheet && <Sheet busy={sheet.busy} />}
      </GestureHandlerRootView>
    </Modal>
  );
}

function Sheet({ busy }: { busy: boolean }) {
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const reduced = useReducedMotion();
  const y = useSharedValue(reduced ? 0 : height * 0.5); // how far down it is
  useEffect(() => {
    y.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) });
  }, [y]);

  // Down closes it, as a sheet should. Not while it is paying: then it only gives a little.
  const pan = usePanGesture({
    activeOffsetY: [-8, 8],
    onUpdate: (event) => {
      'worklet';
      y.value = event.translationY <= 0 ? 0 : busy ? Math.min(event.translationY * 0.1, 14) : event.translationY;
    },
    onDeactivate: (event) => {
      'worklet';
      if (!busy && !event.canceled && (event.translationY > 110 || event.velocityY > 700)) {
        y.value = withTiming(height * 0.6, { duration: 180 });
        scheduleOnRN(close);
      } else {
        y.value = withSpring(0, { duration: 320, dampingRatio: 0.9 });
      }
    },
  });
  const moved = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.l) + space.s }, moved]} accessibilityViewIsModal>
        <View style={styles.grab} />
        <Words kind="label">Test store</Words>
        <View style={styles.row}>
          <View style={styles.icon}>
            <Icon name="freeze" size={30} color={colors.frozen} />
          </View>
          <View style={styles.grow}>
            <Words kind="heading">{PRODUCT.name}</Words>
            <Words style={styles.grey}>Pullday Test</Words>
          </View>
          <Words kind="heading">{PRODUCT.price}</Words>
        </View>
        <Words style={styles.grey}>This is not a real store. No money is taken.</Words>
        <Button title="Buy" busy={busy} onPress={() => store.pay()} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Cancel"
          disabled={busy}
          android_ripple={{ color: '#00000014' }}
          style={({ pressed }) => [styles.cancel, (pressed || busy) && { opacity: busy ? 0 : 0.6 }]} // keeps its place, so nothing jumps
          onPress={close}
        >
          <Words kind="label">Cancel</Words>
        </Pressable>
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: '#00000066' },
  sheet: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderWidth: hairline,
    borderColor: colors.line,
    paddingHorizontal: space.xl,
    paddingTop: space.m,
    gap: space.l,
  },
  grab: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: '#C9C9C9' },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  grow: { flex: 1 },
  icon: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.frozenFill },
  grey: { color: colors.soft },
  cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
});
