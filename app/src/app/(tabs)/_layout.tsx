import { NativeTabs } from 'expo-router/native-tabs';
import { useStage } from '../../lib/stage';
import { colors, stage } from '../../ui/theme';

export default function Tabs() {
  const dark = useStage();
  const { ink, soft } = dark ? stage : colors;
  return (
    <NativeTabs
      backgroundColor={dark ? stage.page : colors.panel}
      tintColor={ink}
      indicatorColor={dark ? stage.panel : '#EDEDED'}
      rippleColor={dark ? '#FFFFFF22' : '#00000012'}
      iconColor={{ default: soft, selected: ink }}
      labelStyle={{ default: { color: soft }, selected: { color: ink } }}
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
