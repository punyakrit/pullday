import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, SlideInDown, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PRODUCT } from '../core/store';
import { store, useStoreSheet } from '../lib/store';
import { Button } from '../ui/Button';
import { Icon } from '../ui/Icons';
import { Words } from '../ui/Words';
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
          <Words kind="label" style={styles.dark}>
            Test store
          </Words>
          <View style={styles.row}>
            <View style={styles.icon}>
              <Icon name="freeze" size={30} color={colors.mat} />
            </View>
            <View style={styles.grow}>
              <Words kind="heading" style={styles.dark}>
                {PRODUCT.name}
              </Words>
              <Words style={styles.grey}>Pullday Test</Words>
            </View>
            <Words kind="heading" style={styles.dark}>
              {PRODUCT.price}
            </Words>
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
              {sheet?.busy ? <ActivityIndicator color={colors.label} /> : <Words kind="label">Buy</Words>}
            </Pressable>
          </View>
          {/* Keeps its place while it is paying, so nothing jumps. */}
          <View style={{ opacity: sheet?.busy ? 0 : 1 }} pointerEvents={sheet?.busy ? 'none' : 'auto'}>
            <Button kind="quiet" title="Cancel" disabled={sheet?.busy} onPress={close} />
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, justifyContent: 'flex-end' },
  shade: { ...StyleSheet.absoluteFill, backgroundColor: '#00000099' },
  sheet: { backgroundColor: colors.label, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: space.xl, gap: space.l },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.l },
  grow: { flex: 1 },
  icon: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#D3EEFF' },
  dark: { color: colors.onLabel },
  grey: { color: '#4A6663' },
  buy: { borderRadius: 10, overflow: 'hidden' },
  button: { minHeight: 52, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.mat },
});
