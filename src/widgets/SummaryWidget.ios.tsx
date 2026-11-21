import { Spacer, Text, VStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, padding } from '@expo/ui/swift-ui/modifiers';
import { createWidget } from 'expo-widgets';

import { EMPTY_SUMMARY, type SummaryWidgetProps } from './summaryTypes';

/**
 * Home-screen widget (iPhone, SwiftUI). The 'widget' directive compiles this function into its own small
 * bundle; it may only use its props, so every value arrives ready to display.
 */
function SummaryWidget(props: SummaryWidgetProps) {
  'widget';
  return (
    <VStack alignment="leading" modifiers={[containerBackground('#4F46E5', 'widget'), padding({ all: 4 })]}>
      <Text modifiers={[font({ size: 12, weight: 'bold' }), foregroundStyle('#C7D2FE')]}>{props.title}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 12 }), foregroundStyle('#E0E7FF')]}>{props.todayLabel}</Text>
      <Text modifiers={[font({ size: 24, weight: 'bold' }), foregroundStyle('#FFFFFF')]}>{props.today}</Text>
      <Spacer />
      <Text modifiers={[font({ size: 11 }), foregroundStyle('#E0E7FF')]}>{props.monthLine}</Text>
      <Text modifiers={[font({ size: 11 }), foregroundStyle('#E0E7FF')]}>{props.budgetLine}</Text>
    </VStack>
  );
}

export default createWidget('Summary', SummaryWidget, EMPTY_SUMMARY);
