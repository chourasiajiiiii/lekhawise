import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { IconBadge, ListRow } from '@/core/ui';

import type { TransactionView } from '../types';
import { Amount } from './Money';

type Props = {
  tx: TransactionView;
  showDate?: string;
  /** Selection mode for bulk actions: tapping toggles instead of opening. */
  selected?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
};

export function TransactionRow({ tx, showDate, selected, onPress, onLongPress }: Props) {
  const { colors } = useTheme();
  const t = useT();
  const isTransfer = tx.type === 'transfer';
  const title = isTransfer
    ? t('Transfer')
    : tx.split_count > 0
      ? t('Split · {count} categories', { count: tx.split_count })
      : (tx.category_name ?? t('Uncategorised'));
  const account = isTransfer ? `${tx.account_name} → ${tx.to_account_name ?? '?'}` : tx.account_name;
  const subtitle = [
    showDate,
    tx.note || account,
    tx.tag_names ? `#${tx.tag_names.split(', ').join(' #')}` : null,
    tx.recurring_id ? t('Repeats') : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const selecting = selected !== undefined;
  return (
    <ListRow
      onPress={onPress ?? (() => router.push(`/transaction/${tx.id}`))}
      onLongPress={onLongPress}
      left={
        selecting ? (
          <View style={styles.check}>
            <Ionicons
              name={selected ? 'checkmark-circle' : 'ellipse-outline'}
              size={28}
              color={selected ? colors.primary : colors.textMuted}
              accessibilityLabel={selected ? t('Selected') : t('Not selected')}
            />
          </View>
        ) : (
          <IconBadge
            name={isTransfer ? 'swap-horizontal' : tx.split_count > 0 ? 'git-branch-outline' : (tx.category_icon ?? 'help-outline')}
            color={isTransfer || tx.split_count > 0 ? colors.primary : (tx.category_color ?? colors.textMuted)}
          />
        )
      }
      title={title}
      subtitle={subtitle}
      right={
        <View style={styles.right}>
          {tx.attachment_count > 0 ? (
            <Ionicons name="attach" size={16} color={colors.textMuted} accessibilityLabel={t('Has a photo')} />
          ) : null}
          <Amount amount={tx.amount} type={tx.type} />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  check: { width: 40, alignItems: 'center' },
  right: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
