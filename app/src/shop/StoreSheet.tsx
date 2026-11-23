import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRODUCT } from '../core/store';
import { store, useStoreSheet } from '../lib/store';
import { Icon } from '../ui/Icons';
import { Words } from '../ui/Words';
import { hairline } from '../ui/hairline';
import { colors, space } from '../ui/theme';

/** The fake store's own sheet. A real store would draw this, over everything. */
export function StoreSheet() {
  const sheet = useStoreSheet();
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const close = () => store.cancel();
  return (
    <Modal visible={sheet !== null} transparent statusBarTranslucent navigationBarTranslucent animationType="fade" onRequestClose={close}>
      <View style={styles.fill}>
        <Pressable style={styles.shade} accessibilityLabel="Close the store" accessibilityRole="button" onPress={close} />
        <Animated.View
          entering={reduced ? FadeIn.duration(160) : SlideInDown.duration(260)}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, space.l) + space.s }]}
          accessibilityViewIsModal
        >
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
          <View style={styles.buy}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={sheet?.busy ? 'Buying' : 'Buy'}
              accessibilityState={{ disabled: sheet?.busy ?? false, busy: sheet?.busy ?? false }}
              disabled={sheet?.busy}
              android_ripple={{ color: '#FFFFFF22' }}
              style={({ pressed }) => [styles.button, pressed && { opacity: 0.8 }]}
              onPress={() => store.pay()}
            >
              {sheet?.busy ? (
                <ActivityIndicator color={colors.onInk} />
              ) : (
                <Words kind="label" style={{ color: colors.onInk }}>
                  Buy
                </Words>
              )}
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            disabled={sheet?.busy}
            android_ripple={{ color: '#00000014' }}
            style={({ pressed }) => [styles.cancel, (pressed || sheet?.busy) && { opacity: sheet?.busy ? 0 : 0.6 }]} // keeps its place, so nothing jumps
            onPress={close}
          >
            <Words kind="label">Cancel</Words>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
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
    padding: space.xl,
    gap: space.l,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  grow: { flex: 1 },
  icon: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.frozenFill },
  grey: { color: colors.soft },
  cancel: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  buy: { borderRadius: 14, overflow: 'hidden' },
  button: { minHeight: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
});
