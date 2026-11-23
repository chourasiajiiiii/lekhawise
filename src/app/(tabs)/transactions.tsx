import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useDeferredValue, useMemo, useState } from 'react';
import { Alert, ScrollView, SectionList, StyleSheet, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { tPlural, useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Chip, EmptyState, Fab, MonthSwitcher, Screen, Segmented, SelectModal, TextField } from '@/core/ui';
import { currentMonthKey, formatDayLabel, monthBounds } from '@/core/utils/date';
import { categoryOptions } from '@/features/expenses/components/CategoryPicker';
import { useMoney } from '@/features/expenses/components/Money';
import { TransactionRow } from '@/features/expenses/components/TransactionRow';
import {
  bulkAddTag,
  bulkDelete,
  bulkSetAccount,
  bulkSetCategory,
  listAccounts,
  listCategories,
  listTransactions,
} from '@/features/expenses/repo';
import { listTags } from '@/features/expenses/repoExtras';
import type { TransactionView, TxType } from '@/features/expenses/types';

type TypeFilter = 'all' | TxType;
type BulkPicker = null | 'category' | 'account' | 'tag';

export default function TransactionsScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const [month, setMonth] = useState(currentMonthKey());
  const [type, setType] = useState<TypeFilter>('all');
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [accountId, setAccountId] = useState<string | undefined>();
  const [tagId, setTagId] = useState<string | undefined>();
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [bulkPicker, setBulkPicker] = useState<BulkPicker>(null);
  const query = useDeferredValue(search);
  // A search looks through every month; otherwise show the selected month.
  const bounds = query.trim() ? null : monthBounds(month);

  const { data: transactions = [], stale } = useQuery(
    (db) =>
      listTransactions(db, {
        from: bounds?.start,
        to: bounds?.end,
        type: type === 'all' ? undefined : type,
        search: query,
        categoryId,
        accountId,
        tagId,
      }),
    [month, type, query, categoryId, accountId, tagId],
  );
  const { data: filters } = useQuery(
    async (db) => ({
      categories: await listCategories(db),
      accounts: await listAccounts(db, { kind: 'all' }),
      tags: await listTags(db),
    }),
    [],
  );

  const sections = useMemo(() => groupByDay(transactions), [transactions]);
  const totals = useMemo(() => {
    let income = 0;
    let expense = 0;
    for (const tx of transactions) {
      if (tx.type === 'income') income += tx.amount;
      if (tx.type === 'expense') expense += tx.amount;
    }
    return { income, expense };
  }, [transactions]);

  const toggle = (id: string) =>
    setSelected((current) => {
      const next = new Set(current ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // The list is being refreshed for a new search or filter: what is on screen is about to change.
  const updating = stale || search !== query;
  // Only entries that are on screen can be acted on, even if others were selected before a filter changed.
  const ids = selected ? transactions.filter((tx) => selected.has(tx.id)).map((tx) => tx.id) : [];
  const finishBulk = (message?: string) => {
    setSelected(null);
    setBulkPicker(null);
    if (message) Alert.alert(t('Done'), message);
  };

  const confirmBulkDelete = () =>
    Alert.alert(tPlural(ids.length, 'Delete {count} transaction?', 'Delete {count} transactions?'), t('This cannot be undone.'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Delete'),
        style: 'destructive',
        onPress: async () => {
          await bulkDelete(db, ids);
          finishBulk();
        },
      },
    ]);

  const header = (
    <View style={styles.header}>
      <TextField
        placeholder={t('Search notes, categories, tags, amounts')}
        value={search}
        onChangeText={setSearch}
        clearButtonMode="while-editing"
        returnKeyType="search"
        // Search terms are partial words and amounts: autocorrect would turn "lunc" into another word.
        autoCorrect={false}
        autoCapitalize="none"
      />
      {query.trim() ? (
        <AppText variant="caption" muted>
          {t('Searching all months')}
        </AppText>
      ) : (
        <MonthSwitcher month={month} onChange={setMonth} />
      )}
      <Segmented
        options={[
          { value: 'all', label: t('All') },
          { value: 'expense', label: t('Expenses') },
          { value: 'income', label: t('Income') },
          { value: 'transfer', label: t('Transfers') },
        ]}
        value={type}
        onChange={(next) => {
          setType(next);
          setCategoryId(undefined); // a category from the other type would hide everything
        }}
      />
      {filters ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {filters.accounts.map((a) => (
              <Chip
                key={a.id}
                label={a.name}
                icon={a.icon}
                color={a.color}
                selected={accountId === a.id}
                onPress={() => setAccountId(accountId === a.id ? undefined : a.id)}
              />
            ))}
          </ScrollView>
          {type !== 'transfer' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {filters.categories
                .filter((c) => !c.parent_id && (type === 'all' || c.type === type))
                .map((c) => (
                  <Chip
                    key={c.id}
                    label={c.name}
                    icon={c.icon}
                    color={c.color}
                    selected={categoryId === c.id}
                    onPress={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
                  />
                ))}
            </ScrollView>
          ) : null}
          {filters.tags.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {filters.tags.map((tag) => (
                <Chip
                  key={tag.id}
                  label={`#${tag.name}`}
                  color={tag.color}
                  selected={tagId === tag.id}
                  onPress={() => setTagId(tagId === tag.id ? undefined : tag.id)}
                />
              ))}
            </ScrollView>
          ) : null}
        </>
      ) : null}
      <View style={styles.tools}>
        <Chip label={t('Calendar')} icon="calendar-outline" onPress={() => router.push('/calendar')} />
        <Chip
          label={selected ? t('Cancel selection') : t('Select')}
          icon={selected ? 'close' : 'checkmark-done-outline'}
          selected={selected !== null}
          onPress={() => setSelected(selected ? null : new Set())}
        />
      </View>
      <View style={styles.totals}>
        <AppText variant="caption" color={colors.income}>
          {t('In {amount}', { amount: money(totals.income) })}
        </AppText>
        <AppText variant="caption" color={colors.expense}>
          {t('Out {amount}', { amount: money(totals.expense) })}
        </AppText>
        <AppText variant="caption" muted>
          {tPlural(transactions.length, '{count} entry', '{count} entries')}
        </AppText>
      </View>
    </View>
  );

  const bulkBar = selected ? (
    <View style={[styles.bulkBar, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      <AppText variant="label">{tPlural(ids.length, '{count} selected', '{count} selected')}</AppText>
      <View style={styles.bulkActions}>
        <Button title={t('Category')} variant="secondary" disabled={!ids.length || updating} onPress={() => setBulkPicker('category')} />
        <Button title={t('Account')} variant="secondary" disabled={!ids.length || updating} onPress={() => setBulkPicker('account')} />
        <Button title={t('Tag')} variant="secondary" disabled={!ids.length || updating || !filters?.tags.length} onPress={() => setBulkPicker('tag')} />
        <Button title={t('Delete')} variant="danger" disabled={!ids.length || updating} onPress={confirmBulkDelete} />
      </View>
      <Button
        title={transactions.length > 0 && ids.length === transactions.length ? t('Select none') : t('Select all shown')}
        variant="ghost"
        disabled={updating}
        onPress={() => setSelected(ids.length === transactions.length ? new Set() : new Set(transactions.map((tx) => tx.id)))}
      />
    </View>
  ) : (
    <Fab label={t('Add transaction')} onPress={() => router.push('/transaction/new')} />
  );

  return (
    <Screen scroll={false} overlay={bulkBar}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentInsetAdjustmentBehavior="automatic"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={[styles.content, selected ? styles.contentSelecting : null]}
        style={updating ? styles.updating : null}
        stickySectionHeadersEnabled={false}
        renderSectionHeader={({ section }) => (
          <View style={styles.sectionHeader}>
            <AppText variant="label" muted>
              {section.title}
            </AppText>
            {section.net !== 0 ? (
              <AppText variant="caption" muted>
                {section.net > 0 ? '+' : ''}
                {money(section.net)}
              </AppText>
            ) : null}
          </View>
        )}
        renderItem={({ item }) => (
          <TransactionRow
            tx={item}
            selected={selected ? selected.has(item.id) : undefined}
            onPress={selected ? () => toggle(item.id) : undefined}
            onLongPress={() => (selected ? toggle(item.id) : setSelected(new Set([item.id])))}
          />
        )}
        ListEmptyComponent={
          <EmptyState
            icon="search-outline"
            title={t('Nothing here')}
            message={query.trim() || categoryId || accountId || tagId || type !== 'all' ? t('Try clearing a filter.') : t('Tap + to add a transaction.')}
          />
        }
      />
      {filters ? (
        <SelectModal
          visible={bulkPicker !== null}
          title={bulkPicker === 'category' ? t('Move to category') : bulkPicker === 'account' ? t('Move to account') : t('Add tag')}
          options={
            bulkPicker === 'category'
              ? categoryOptions(filters.categories)
              : bulkPicker === 'account'
                ? filters.accounts.filter((a) => a.type !== 'loan').map((a) => ({ value: a.id, label: a.name, icon: a.icon, color: a.color }))
                : filters.tags.map((tag) => ({ value: tag.id, label: `#${tag.name}`, icon: 'pricetag-outline', color: tag.color }))
          }
          onSelect={async (value) => {
            if (bulkPicker === 'category') {
              const changed = await bulkSetCategory(db, ids, value);
              finishBulk(tPlural(changed, '{count} entry moved. Transfers, splits and entries of the other type were left as they were.', '{count} entries moved. Transfers, splits and entries of the other type were left as they were.'));
            } else if (bulkPicker === 'account') {
              const changed = await bulkSetAccount(db, ids, value);
              finishBulk(tPlural(changed, '{count} entry moved.', '{count} entries moved.'));
            } else {
              await bulkAddTag(db, ids, value);
              finishBulk();
            }
          }}
          onCancel={() => setBulkPicker(null)}
        />
      ) : null}
    </Screen>
  );
}

function groupByDay(transactions: TransactionView[]) {
  const sections: { title: string; net: number; data: TransactionView[] }[] = [];
  let currentDate = '';
  for (const tx of transactions) {
    if (tx.date !== currentDate) {
      currentDate = tx.date;
      sections.push({ title: formatDayLabel(tx.date), net: 0, data: [] });
    }
    const section = sections[sections.length - 1];
    section.data.push(tx);
    if (tx.type === 'income') section.net += tx.amount;
    if (tx.type === 'expense') section.net -= tx.amount;
  }
  return sections;
}

const styles = StyleSheet.create({
  updating: { opacity: 0.5 },
  content: { padding: 16, paddingBottom: 110 },
  contentSelecting: { paddingBottom: 220 },
  header: { gap: 12, marginBottom: 4 },
  chips: { gap: 8, paddingRight: 16 },
  tools: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  // Wraps onto two lines with large text instead of running the three values together.
  totals: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12, rowGap: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 16, marginBottom: 2 },
  bulkBar: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 12,
    gap: 8,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  bulkActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
});
