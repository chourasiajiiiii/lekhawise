import type { RecurringView } from './repo';

/** A short name for a recurring rule: its note, else the transfer accounts or the category. */
export function ruleTitle(rule: RecurringView, t: (text: string) => string): string {
  if (rule.note) return rule.note;
  if (rule.type === 'transfer') return `${rule.account_name} → ${rule.to_account_name ?? '?'}`;
  return rule.category_name ?? t('Recurring');
}
