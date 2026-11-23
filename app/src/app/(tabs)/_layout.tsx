import { NativeTabs } from 'expo-router/native-tabs';
import { colors } from '../../ui/theme';

export default function Tabs() {
  return (
    <NativeTabs
      backgroundColor={colors.deep}
      tintColor={colors.ink}
      indicatorColor={colors.raised}
      rippleColor="#FFFFFF22"
      iconColor={{ default: colors.soft, selected: colors.ink }}
      labelStyle={{ default: { color: colors.soft }, selected: { color: colors.ink } }}
    >
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Label>Today</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="rectangle.stack.fill" md="style" />
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="collection">
        <NativeTabs.Trigger.Label>Collection</NativeTabs.Trigger.Label>
        <NativeTabs.Trigger.Icon sf="square.grid.3x3.fill" md="grid_view" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
