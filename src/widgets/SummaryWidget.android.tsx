import { Column, Text } from '@expo/ui/jetpack-compose';
import { background, fillMaxSize, paddingAll } from '@expo/ui/jetpack-compose/modifiers';
import { createWidget } from 'expo-widgets';

import { EMPTY_SUMMARY, type SummaryWidgetProps } from './summaryTypes';

/**
 * Home-screen widget (Android, Jetpack Compose via Glance). The 'widget' directive compiles this function
 * into its own small bundle; it may only use its props, so every value arrives ready to display.
 */
function SummaryWidget(props: SummaryWidgetProps) {
  'widget';
  return (
    <Column modifiers={[fillMaxSize(), background('#4F46E5'), paddingAll(14)]} verticalArrangement="spaceBetween">
      <Text color="#C7D2FE" style={{ fontSize: 12, fontWeight: 'bold' }} maxLines={1}>
        {props.title}
      </Text>
      <Column>
        <Text color="#E0E7FF" style={{ fontSize: 12 }} maxLines={1}>
          {props.todayLabel}
        </Text>
        <Text color="#FFFFFF" style={{ fontSize: 24, fontWeight: 'bold' }} maxLines={1}>
          {props.today}
        </Text>
      </Column>
      <Column>
        <Text color="#E0E7FF" style={{ fontSize: 12 }} maxLines={2}>
          {props.monthLine}
        </Text>
        <Text color="#E0E7FF" style={{ fontSize: 12 }} maxLines={2}>
          {props.budgetLine}
        </Text>
      </Column>
    </Column>
  );
}

export default createWidget('Summary', SummaryWidget, EMPTY_SUMMARY);
