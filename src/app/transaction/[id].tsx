import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useRef, useState } from 'react';
import { Alert, Image, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { useQuery } from '@/core/db/useQuery';
import { tPlural, useT } from '@/core/i18n/locale';
import { getSetting, setSetting } from '@/core/settings/settings';
import { PALETTE, useTheme } from '@/core/theme/theme';
import {
  AppText,
  Button,
  Card,
  Chip,
  DateField,
  Icon,
  PromptModal,
  Screen,
  SectionTitle,
  Segmented,
  SelectModal,
  SwitchRow,
  TextField,
} from '@/core/ui';
import { formatDate, type Frequency, type ISODate, isISODate, todayISO } from '@/core/utils/date';
import { decimalSeparator } from '@/core/utils/money';
import { addPhoto, attachmentFile, deletePhoto, PermissionDeniedError, pickPhoto, type PhotoSource } from '@/features/expenses/attachments';
import { CategoryPicker, categoryOptions } from '@/features/expenses/components/CategoryPicker';
import { useAmountFormat, useMoney } from '@/features/expenses/components/Money';
import {
  createRecurring,
  deleteTransaction,
  findPossibleDuplicates,
  getSplits,
  getTransaction,
  getTransactionTagIds,
  listAccounts,
  listCategories,
  saveTransaction,
  type TransactionInput,
  validateTransaction,
} from '@/features/expenses/repo';
import { checkBudgetAlerts } from '@/features/expenses/repoBudgets';
import { createTag, listAttachments, listTags, listTemplates, saveTemplate, type TemplateView } from '@/features/expenses/repoExtras';
import { ensureNotificationPermission } from '@/features/expenses/notifications';
import { isOcrAvailable, readTextLines } from '@/features/expenses/ocr';
import { parseReceipt } from '@/features/expenses/receiptParser';
import { saveSharedExpense, validateShares } from '@/features/expenses/repoLoans';
import { BUDGET_ALERTS_SETTING_KEY, getWeekStart } from '@/features/expenses/settings';
import { type Attachment, FREQUENCIES, type RecurringMode, type Transaction, type TxType } from '@/features/expenses/types';

const LAST_ACCOUNT_KEY = 'lastAccountId';

type Params = { id: string; type?: TxType; date?: string; amount?: string; note?: string };

/** Route: /transaction/new (optionally ?type=income&date=...&amount=...&note=...) or /transaction/<id> to edit. */
export default function TransactionScreen() {
  const { id, ...params } = useLocalSearchParams<Params>();
  const t = useT();
  const isNew = id === 'new';
  const { data, loading } = useQuery(
    async (db) => {
      const tx = isNew ? null : await getTransaction(db, id);
      return {
        tx,
        splits: tx ? await getSplits(db, tx.id) : [],
        tagIds: tx ? await getTransactionTagIds(db, tx.id) : [],
        categories: await listCategories(db, undefined, true),
        accounts: await listAccounts(db, { includeArchived: true, kind: 'all' }),
        tags: await listTags(db),
        templates: isNew ? await listTemplates(db) : [],
      };
    },
    [id],
  );

  if (loading || !data) return <Screen>{null}</Screen>;
  if (!isNew && !data.tx) {
    return (
      <Screen>
        <AppText>{t('This transaction no longer exists.')}</AppText>
      </Screen>
    );
  }
  // The form mounts once data is loaded, so its initial state is simple. New tags and photos refresh `data`
  // without remounting, because the key only depends on the route.
  return <TransactionForm key={id} existing={data.tx} params={params} {...data} />;
}

type Loaded = {
  existing: Transaction | null;
  params: Omit<Params, 'id'>;
  splits: Awaited<ReturnType<typeof getSplits>>;
  tagIds: string[];
  categories: Awaited<ReturnType<typeof listCategories>>;
  accounts: Awaited<ReturnType<typeof listAccounts>>;
  tags: Awaited<ReturnType<typeof listTags>>;
  templates: TemplateView[];
};

type SplitLine = { key: string; category_id: string | null; amountText: string; note: string };
type ShareLine = { key: string; person: string; amountText: string };
type PickedPhoto = { uri: string; width: number; height: number };

let lineKey = 0;
const nextKey = () => String(++lineKey);

function TransactionForm({ existing, params, splits: initialSplits, tagIds: initialTags, categories, accounts, tags, templates }: Loaded) {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const { currency, parse, toInput, keyboard } = useAmountFormat();

  const moneyAccounts = accounts.filter((a) => a.type !== 'loan');
  const usable = (list: typeof accounts) =>
    list.filter((a) => a.archived === 0 || a.id === existing?.account_id || a.id === existing?.to_account_id);
  const lastAccount = getSetting<string | null>(LAST_ACCOUNT_KEY, null);
  const defaultAccount = usable(moneyAccounts).find((a) => a.id === lastAccount)?.id ?? usable(moneyAccounts)[0]?.id ?? '';

  const [type, setType] = useState<TxType>(existing?.type ?? params.type ?? 'expense');
  const [amountText, setAmountText] = useState(
    existing ? toInput(existing.amount) : params.amount && Number(params.amount) > 0 ? toInput(Number(params.amount)) : '',
  );
  const [categoryId, setCategoryId] = useState<string | null>(existing?.category_id ?? null);
  const [accountId, setAccountId] = useState(existing?.account_id ?? defaultAccount);
  const [toAccountId, setToAccountId] = useState<string | null>(existing?.to_account_id ?? null);
  const [date, setDate] = useState<ISODate>(existing?.date ?? (params.date && isISODate(params.date) ? params.date : todayISO()));
  const [note, setNote] = useState(existing?.note ?? params.note ?? '');
  const [tagIds, setTagIds] = useState<string[]>(initialTags);
  const [splitMode, setSplitMode] = useState(initialSplits.length > 0);
  const [splits, setSplits] = useState<SplitLine[]>(
    initialSplits.length
      ? initialSplits.map((s) => ({ key: nextKey(), category_id: s.category_id, amountText: toInput(s.amount), note: s.note }))
      : [
          { key: nextKey(), category_id: null, amountText: '', note: '' },
          { key: nextKey(), category_id: null, amountText: '', note: '' },
        ],
  );
  const [shareMode, setShareMode] = useState(false);
  const [shares, setShares] = useState<ShareLine[]>([{ key: nextKey(), person: '', amountText: '' }]);
  const [repeat, setRepeat] = useState<Frequency | null>(null);
  const [repeatMode, setRepeatMode] = useState<RecurringMode>('auto');
  const [remindDays, setRemindDays] = useState<number | null>(1);
  const [pendingPhotos, setPendingPhotos] = useState<PickedPhoto[]>([]);
  const [pickingSplit, setPickingSplit] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<null | 'tag' | 'template'>(null);
  const [viewing, setViewing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const savingRef = useRef(false);

  const { data: attachments = [] } = useQuery(
    (db) => (existing ? listAttachments(db, existing.id) : Promise.resolve([] as Attachment[])),
    [existing?.id],
  );

  const typeCategories = categories.filter(
    (c) => c.type === type && (c.archived === 0 || c.id === existing?.category_id || initialSplits.some((s) => s.category_id === c.id)),
  );
  const total = parse(amountText) ?? 0;
  const splitTotal = splits.reduce((sum, s) => sum + (parse(s.amountText) ?? 0), 0);
  const sharesTotal = shares.reduce((sum, s) => sum + (parse(s.amountText) ?? 0), 0);

  const changeType = (next: TxType) => {
    setType(next);
    if (!categories.some((c) => c.id === categoryId && c.type === next)) setCategoryId(null);
    setSplits((lines) => lines.map((l) => (categories.some((c) => c.id === l.category_id && c.type === next) ? l : { ...l, category_id: null })));
    if (next !== 'expense') setShareMode(false);
    if (next === 'transfer') setSplitMode(false);
    if (next !== 'transfer' && accounts.find((a) => a.id === accountId)?.type === 'loan') setAccountId(defaultAccount);
  };

  const applyTemplate = (tpl: TemplateView) => {
    setType(tpl.type);
    if (tpl.amount) setAmountText(toInput(tpl.amount));
    setCategoryId(tpl.category_id);
    if (tpl.account_id && accounts.some((a) => a.id === tpl.account_id && !a.archived)) setAccountId(tpl.account_id);
    setToAccountId(tpl.to_account_id);
    setNote(tpl.note);
    setSplitMode(false);
  };

  const buildInput = (): TransactionInput => ({
    type,
    amount: total,
    category_id: type === 'transfer' || splitMode ? null : categoryId,
    account_id: accountId,
    to_account_id: type === 'transfer' ? toAccountId : null,
    date,
    note: note.trim(),
    splits: type !== 'transfer' && splitMode
      ? splits.map((s) => ({ category_id: s.category_id ?? '', amount: parse(s.amountText) ?? 0, note: s.note }))
      : [],
    tagIds,
    loan_id: existing?.loan_id ?? null,
  });

  const save = async () => {
    if (savingRef.current) return;
    const input = buildInput();
    if (!amountText.trim() || total <= 0) {
      Alert.alert(t('Check the details'), t('Enter an amount greater than zero.'));
      return;
    }
    const error = validateTransaction(input);
    if (error) {
      Alert.alert(t('Check the details'), t(error));
      return;
    }
    const shareList = shares.map((s) => ({ person: s.person.trim(), amount: parse(s.amountText) ?? 0 }));
    if (shareMode) {
      const shareError = validateShares(total, shareList);
      if (shareError) {
        Alert.alert(t('Check the details'), t(shareError));
        return;
      }
    }
    if (!existing && !repeat) {
      const duplicates = await findPossibleDuplicates(db, input);
      if (duplicates.length) {
        // The alert's button continues the save; dismissing the alert simply leaves the form open.
        Alert.alert(
          t('Possible duplicate'),
          t('There is already a {amount} entry from this account on {date}. Save anyway?', {
            amount: money(input.amount),
            date: formatDate(duplicates[0].date),
          }),
          [
            { text: t('Cancel'), style: 'cancel' },
            { text: t('Save anyway'), onPress: () => commit(input, shareList) },
          ],
        );
        return;
      }
    }
    await commit(input, shareList);
  };

  const commit = async (input: TransactionInput, shareList: { person: string; amount: number }[]) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      let savedId: string | null = existing?.id ?? null;
      if (!existing && repeat) {
        await createRecurring(db, input, repeat, { mode: repeatMode, remindDays: repeatMode === 'remind' ? remindDays : null });
        // A reminder needs notification permission; ask now, when the reason is obvious.
        if (repeatMode === 'remind' && remindDays !== null) await ensureNotificationPermission();
        savedId = null;
      } else if (!existing && shareMode) {
        savedId = await saveSharedExpense(db, input, shareList);
      } else {
        savedId = await saveTransaction(db, existing?.id ?? null, input);
      }
      if (savedId) {
        for (const photo of pendingPhotos) await addPhoto(db, savedId, photo);
      }
      if (type !== 'transfer') setSetting(LAST_ACCOUNT_KEY, accountId);
      router.back();
      if (type === 'expense' && getSetting<boolean>(BUDGET_ALERTS_SETTING_KEY, true)) {
        const alerts = await checkBudgetAlerts(db, getWeekStart());
        if (alerts.length) {
          const a = alerts[0];
          Alert.alert(
            a.level === 'over' ? t('Over budget: {name}', { name: a.name ?? t('Total spending') }) : t('Budget almost used: {name}', { name: a.name ?? t('Total spending') }),
            t('{spent} of {limit} spent this {period}.', {
              spent: money(a.spent),
              limit: money(a.limit),
              period: a.period === 'week' ? t('week') : t('month'),
            }),
          );
        }
      }
    } catch (e) {
      console.error(e);
      Alert.alert(t('Could not save'), e instanceof Error && e.message ? t(e.message) : t('Please try again.'));
      savingRef.current = false;
      setSaving(false);
    }
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert(t('Delete transaction?'), t('This cannot be undone.'), [
      { text: t('Cancel'), style: 'cancel' },
      {
        text: t('Delete'),
        style: 'destructive',
        onPress: async () => {
          for (const a of attachments) await deletePhoto(db, a);
          await deleteTransaction(db, existing.id);
          router.back();
        },
      },
    ]);
  };

  const duplicateAsNew = () => {
    if (!existing) return;
    router.replace({
      pathname: '/transaction/[id]',
      params: { id: 'new', type: existing.type, amount: String(existing.amount), note: existing.note },
    });
  };

  const addPhotoFrom = async (source: PhotoSource) => {
    try {
      const photo = await pickPhoto(source);
      if (!photo) return;
      if (existing) await addPhoto(db, existing.id, photo);
      else setPendingPhotos((list) => [...list, photo]);
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        Alert.alert(t('Camera not allowed'), t('Allow camera access for LekhaWise in the phone settings to take receipt photos.'));
      } else {
        console.error(e);
        Alert.alert(t('Could not add the photo'), t('Please try again.'));
      }
    }
  };

  /** Reads a receipt photo (taken now or from the gallery) on the phone and fills in what it finds. */
  const scanReceipt = (source: PhotoSource) => async () => {
    try {
      const photo = await pickPhoto(source);
      if (!photo) return;
      setScanning(true);
      const lines = await readTextLines(photo.uri);
      const guess = parseReceipt(lines, {
        today: todayISO(),
        decimalSeparator: decimalSeparator(),
        currency,
        dateOrder: currency === 'USD' ? 'mdy' : 'dmy',
      });
      changeType('expense');
      if (guess.amount) setAmountText(toInput(guess.amount));
      if (guess.date) setDate(guess.date);
      if (guess.merchant && !note.trim()) setNote(guess.merchant);
      setPendingPhotos((list) => [...list, photo]);
      Alert.alert(
        t('Receipt read'),
        guess.amount
          ? t('Check the amount, date and note, then choose a category.')
          : t('The total could not be found. Enter the amount yourself; the photo is attached.'),
      );
    } catch (e) {
      if (e instanceof PermissionDeniedError) {
        Alert.alert(t('Camera not allowed'), t('Allow camera access for LekhaWise in the phone settings to take receipt photos.'));
      } else {
        console.error(e);
        Alert.alert(t('Could not read the receipt'), t('Please try again, or enter the details yourself.'));
      }
    } finally {
      setScanning(false);
    }
  };

  const choosePhotoSource = () =>
    Alert.alert(t('Add a receipt photo'), undefined, [
      { text: t('Take photo'), onPress: () => addPhotoFrom('camera') },
      { text: t('Choose from gallery'), onPress: () => addPhotoFrom('library') },
      { text: t('Cancel'), style: 'cancel' },
    ]);

  const removePhoto = (attachment: Attachment) =>
    Alert.alert(t('Remove this photo?'), undefined, [
      { text: t('Cancel'), style: 'cancel' },
      { text: t('Remove'), style: 'destructive', onPress: () => deletePhoto(db, attachment) },
    ]);

  const saveAsTemplate = async (name: string) => {
    try {
      await saveTemplate(db, null, {
        name,
        type,
        amount: total || null,
        category_id: splitMode ? null : categoryId,
        account_id: accountId || null,
        to_account_id: toAccountId,
        note: note.trim(),
      });
      setPrompt(null);
      Alert.alert(t('Template saved'), t('Find it at the top of the form when adding a transaction.'));
    } catch (e) {
      Alert.alert(t('Could not save'), e instanceof Error ? t(e.message) : '');
    }
  };

  const addTag = async (name: string) => {
    if (!name.trim()) return;
    const id = await createTag(db, name, PALETTE[(tags.length * 5) % PALETTE.length]);
    setTagIds((ids) => (ids.includes(id) ? ids : [...ids, id]));
    setPrompt(null);
  };

  const splitEqually = () => {
    const people = shares.length + 1;
    if (total <= 0) return;
    const each = Math.floor(total / people);
    setShares((list) => list.map((s) => ({ ...s, amountText: toInput(each) })));
  };

  const amountColor = type === 'expense' ? colors.expense : type === 'income' ? colors.income : colors.text;
  const isLoanEntry = !!existing?.loan_id || accounts.some((a) => a.type === 'loan' && (a.id === existing?.account_id || a.id === existing?.to_account_id));

  return (
    <Screen>
      <Stack.Screen options={{ title: existing ? t('Edit transaction') : t('New transaction') }} />

      {!existing && isOcrAvailable() ? (
        <Button
          title={t('Scan a receipt')}
          icon="scan-outline"
          variant="secondary"
          loading={scanning}
          onPress={() =>
            Alert.alert(t('Scan a receipt'), undefined, [
              { text: t('Take photo'), onPress: scanReceipt('camera') },
              { text: t('Choose from gallery'), onPress: scanReceipt('library') },
              { text: t('Cancel'), style: 'cancel' },
            ])
          }
        />
      ) : null}

      {!existing && templates.length ? (
        <View style={styles.chips}>
          {templates.map((tpl) => (
            <Chip key={tpl.id} label={tpl.name} icon="flash-outline" onPress={() => applyTemplate(tpl)} />
          ))}
        </View>
      ) : null}

      <Segmented
        options={[
          { value: 'expense', label: t('Expense') },
          { value: 'income', label: t('Income') },
          { value: 'transfer', label: t('Transfer') },
        ]}
        value={type}
        onChange={changeType}
      />

      <View style={[styles.amountBox, { backgroundColor: colors.surface, borderColor: colors.border }]}>
        <AppText variant="heading" muted>
          {currency}
        </AppText>
        <TextInput
          value={amountText}
          onChangeText={setAmountText}
          placeholder="0"
          placeholderTextColor={colors.textMuted}
          keyboardType={keyboard}
          autoFocus={!existing && !params.amount}
          accessibilityLabel={t('Amount')}
          style={[styles.amountInput, { color: amountColor }]}
        />
      </View>

      {type === 'transfer' ? (
        <>
          <SectionTitle>{t('From')}</SectionTitle>
          <AccountChips
            accounts={usable(accounts)}
            value={accountId}
            onChange={(id) => {
              setAccountId(id);
              if (id === toAccountId) setToAccountId(null);
            }}
          />
          <SectionTitle>{t('To')}</SectionTitle>
          <AccountChips accounts={usable(accounts).filter((a) => a.id !== accountId)} value={toAccountId} onChange={setToAccountId} />
        </>
      ) : (
        <>
          <SectionTitle
            right={
              <Pressable onPress={() => router.push('/categories')} hitSlop={8}>
                <AppText variant="caption" color={colors.primary}>
                  {t('Manage')}
                </AppText>
              </Pressable>
            }
          >
            {t('Category')}
          </SectionTitle>
          <SwitchRow
            title={t('Split into several categories')}
            subtitle={t('One payment, different kinds of spending')}
            value={splitMode}
            onChange={(on) => {
              setSplitMode(on);
              if (on) setShareMode(false);
            }}
          />
          {splitMode ? (
            <Card style={styles.gap}>
              {splits.map((line, i) => {
                const category = categories.find((c) => c.id === line.category_id);
                return (
                  <View key={line.key} style={styles.splitRow}>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t('Category for part {n}', { n: i + 1 })}
                      onPress={() => setPickingSplit(line.key)}
                      style={[styles.splitCategory, { borderColor: colors.border, backgroundColor: colors.surfaceAlt }]}
                    >
                      {category ? <Icon name={category.icon} color={category.color} size={18} /> : null}
                      <AppText numberOfLines={1} style={styles.flex} muted={!category}>
                        {category?.name ?? t('Choose')}
                      </AppText>
                    </Pressable>
                    <TextInput
                      value={line.amountText}
                      onChangeText={(text) => setSplits((list) => list.map((l) => (l.key === line.key ? { ...l, amountText: text } : l)))}
                      placeholder="0"
                      placeholderTextColor={colors.textMuted}
                      keyboardType={keyboard}
                      accessibilityLabel={t('Amount for part {n}', { n: i + 1 })}
                      style={[styles.splitAmount, { color: colors.text, borderColor: colors.border }]}
                    />
                    {splits.length > 2 ? (
                      <Pressable
                        accessibilityLabel={t('Remove part {n}', { n: i + 1 })}
                        hitSlop={8}
                        onPress={() => setSplits((list) => list.filter((l) => l.key !== line.key))}
                      >
                        <Icon name="close-circle-outline" color={colors.textMuted} />
                      </Pressable>
                    ) : null}
                  </View>
                );
              })}
              <View style={styles.between}>
                <Button
                  title={t('Add part')}
                  variant="ghost"
                  icon="add"
                  onPress={() => setSplits((list) => [...list, { key: nextKey(), category_id: null, amountText: '', note: '' }])}
                />
                <AppText variant="caption" color={splitTotal === total ? colors.income : colors.warning}>
                  {splitTotal === total
                    ? t('Adds up')
                    : total - splitTotal > 0
                      ? t('{amount} left to assign', { amount: money(total - splitTotal) })
                      : t('{amount} too much', { amount: money(splitTotal - total) })}
                </AppText>
              </View>
              {total - splitTotal > 0 && splits.some((s) => !s.amountText.trim()) ? (
                <Button
                  title={t('Put the rest in the empty part')}
                  variant="ghost"
                  onPress={() => {
                    const empty = splits.find((s) => !s.amountText.trim());
                    if (empty) setSplits((list) => list.map((l) => (l.key === empty.key ? { ...l, amountText: toInput(total - splitTotal) } : l)));
                  }}
                />
              ) : null}
            </Card>
          ) : (
            <CategoryPicker categories={typeCategories} value={categoryId} onChange={setCategoryId} />
          )}
          <SectionTitle>{type === 'income' ? t('To account') : t('Paid from')}</SectionTitle>
          <AccountChips accounts={usable(moneyAccounts)} value={accountId} onChange={setAccountId} />
        </>
      )}

      <SectionTitle>{t('Details')}</SectionTitle>
      <DateField label={t('Date')} value={date} onChange={setDate} />
      <TextField label={t('Note')} value={note} onChangeText={setNote} placeholder={t('Optional')} maxLength={200} />

      <SectionTitle
        right={
          <Pressable onPress={() => setPrompt('tag')} hitSlop={8}>
            <AppText variant="caption" color={colors.primary}>
              {t('New tag')}
            </AppText>
          </Pressable>
        }
      >
        {t('Tags')}
      </SectionTitle>
      {tags.length ? (
        <View style={styles.chips}>
          {tags.map((tag) => (
            <Chip
              key={tag.id}
              label={`#${tag.name}`}
              color={tag.color}
              selected={tagIds.includes(tag.id)}
              onPress={() => setTagIds((ids) => (ids.includes(tag.id) ? ids.filter((x) => x !== tag.id) : [...ids, tag.id]))}
            />
          ))}
        </View>
      ) : (
        <AppText variant="caption" muted>
          {t('Tags group entries across categories, for example a trip or a wedding.')}
        </AppText>
      )}

      <SectionTitle>{t('Receipt photos')}</SectionTitle>
      <View style={styles.photos}>
        {attachments.map((a) => (
          <Pressable key={a.id} onPress={() => setViewing(attachmentFile(a).uri)} onLongPress={() => removePhoto(a)} accessibilityLabel={t('Receipt photo')}>
            <Image source={{ uri: attachmentFile(a).uri }} style={styles.thumb} />
          </Pressable>
        ))}
        {pendingPhotos.map((p, i) => (
          <Pressable
            key={p.uri}
            onPress={() => setViewing(p.uri)}
            onLongPress={() => setPendingPhotos((list) => list.filter((_, j) => j !== i))}
            accessibilityLabel={t('Receipt photo')}
          >
            <Image source={{ uri: p.uri }} style={styles.thumb} />
          </Pressable>
        ))}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('Add a receipt photo')}
          onPress={choosePhotoSource}
          style={[styles.thumb, styles.addPhoto, { borderColor: colors.border }]}
        >
          <Icon name="camera-outline" color={colors.textMuted} />
        </Pressable>
      </View>
      {attachments.length + pendingPhotos.length > 0 ? (
        <AppText variant="caption" muted>
          {t('Tap a photo to view it, press and hold to remove it.')}
        </AppText>
      ) : null}

      {!existing && type === 'expense' && !splitMode && !repeat ? (
        <>
          <SectionTitle>{t('Shared bill')}</SectionTitle>
          <SwitchRow
            title={t('Others owe me part of this')}
            subtitle={t('Your share counts as spending; the rest is tracked under Loans & debts')}
            value={shareMode}
            onChange={setShareMode}
          />
          {shareMode ? (
            <Card style={styles.gap}>
              {shares.map((share, i) => (
                <View key={share.key} style={styles.splitRow}>
                  <TextInput
                    value={share.person}
                    onChangeText={(text) => setShares((list) => list.map((s) => (s.key === share.key ? { ...s, person: text } : s)))}
                    placeholder={t('Name')}
                    placeholderTextColor={colors.textMuted}
                    accessibilityLabel={t('Person {n}', { n: i + 1 })}
                    style={[styles.personInput, { color: colors.text, borderColor: colors.border }]}
                  />
                  <TextInput
                    value={share.amountText}
                    onChangeText={(text) => setShares((list) => list.map((s) => (s.key === share.key ? { ...s, amountText: text } : s)))}
                    placeholder="0"
                    placeholderTextColor={colors.textMuted}
                    keyboardType={keyboard}
                    accessibilityLabel={t('Share of person {n}', { n: i + 1 })}
                    style={[styles.splitAmount, { color: colors.text, borderColor: colors.border }]}
                  />
                  {shares.length > 1 ? (
                    <Pressable hitSlop={8} onPress={() => setShares((list) => list.filter((s) => s.key !== share.key))}>
                      <Icon name="close-circle-outline" color={colors.textMuted} />
                    </Pressable>
                  ) : null}
                </View>
              ))}
              <View style={styles.between}>
                <Button title={t('Add person')} variant="ghost" icon="person-add-outline" onPress={() => setShares((list) => [...list, { key: nextKey(), person: '', amountText: '' }])} />
                <Button title={t('Split equally')} variant="ghost" onPress={splitEqually} />
              </View>
              <AppText variant="caption" muted>
                {t('Your share: {amount}', { amount: money(Math.max(0, total - sharesTotal)) })}
              </AppText>
            </Card>
          ) : null}
        </>
      ) : null}

      {!existing && !shareMode ? (
        <>
          <SectionTitle>{t('Repeat')}</SectionTitle>
          <View style={styles.chips}>
            <Chip label={t('Never')} selected={repeat === null} onPress={() => setRepeat(null)} />
            {FREQUENCIES.map((f) => (
              <Chip key={f.value} label={t(f.label)} selected={repeat === f.value} onPress={() => setRepeat(f.value)} />
            ))}
          </View>
          {repeat ? (
            <Card style={styles.gap}>
              <Segmented
                options={[
                  { value: 'auto', label: t('Add automatically') },
                  { value: 'remind', label: t('Remind me (bill)') },
                ]}
                value={repeatMode}
                onChange={setRepeatMode}
              />
              {repeatMode === 'auto' ? (
                <AppText variant="caption" muted>
                  {t('Added automatically on each due date, starting from the date above. Manage it under More, Recurring & bills.')}
                </AppText>
              ) : (
                <>
                  <AppText variant="caption" muted>
                    {t('Nothing is added until you mark the bill as paid, so you can enter the exact amount each time.')}
                  </AppText>
                  <View style={styles.chips}>
                    {[0, 1, 3, 7].map((d) => (
                      <Chip
                        key={d}
                        label={d === 0 ? t('Remind on the day') : tPlural(d, '{count} day before', '{count} days before')}
                        selected={remindDays === d}
                        onPress={() => setRemindDays(d)}
                      />
                    ))}
                    <Chip label={t('No reminder')} selected={remindDays === null} onPress={() => setRemindDays(null)} />
                  </View>
                </>
              )}
            </Card>
          ) : null}
        </>
      ) : existing?.recurring_id ? (
        <AppText variant="caption" muted>
          {t('Created by a recurring rule. Changes here affect only this entry.')}
        </AppText>
      ) : null}

      {isLoanEntry ? (
        <AppText variant="caption" muted>
          {t('This entry belongs to a loan. Changes here change what is outstanding.')}
        </AppText>
      ) : null}

      <View style={styles.actions}>
        <Button title={existing ? t('Save changes') : t('Save')} icon="checkmark" onPress={save} loading={saving} />
        <Button title={t('Save as template')} variant="secondary" icon="flash-outline" onPress={() => setPrompt('template')} />
        {existing ? (
          <>
            <Button title={t('Copy as new entry')} variant="secondary" icon="copy-outline" onPress={duplicateAsNew} />
            <Button title={t('Delete')} variant="danger" icon="trash-outline" onPress={remove} />
          </>
        ) : null}
      </View>

      <SelectModal
        visible={pickingSplit !== null}
        title={t('Category')}
        options={categoryOptions(typeCategories.filter((c) => c.archived === 0))}
        selected={splits.find((s) => s.key === pickingSplit)?.category_id}
        onSelect={(value) => {
          setSplits((list) => list.map((l) => (l.key === pickingSplit ? { ...l, category_id: value } : l)));
          setPickingSplit(null);
        }}
        onCancel={() => setPickingSplit(null)}
      />
      <PromptModal
        visible={prompt !== null}
        title={prompt === 'tag' ? t('New tag') : t('Template name')}
        placeholder={prompt === 'tag' ? t('e.g. Goa trip') : t('e.g. Morning coffee')}
        onSubmit={(value) => (prompt === 'tag' ? addTag(value) : saveAsTemplate(value))}
        onCancel={() => setPrompt(null)}
      />
      <Modal visible={viewing !== null} transparent animationType="fade" onRequestClose={() => setViewing(null)}>
        <Pressable style={styles.viewer} onPress={() => setViewing(null)} accessibilityLabel={t('Close')}>
          {viewing ? <Image source={{ uri: viewing }} style={styles.full} resizeMode="contain" /> : null}
        </Pressable>
      </Modal>
    </Screen>
  );
}

function AccountChips({
  accounts,
  value,
  onChange,
}: {
  accounts: Loaded['accounts'];
  value: string | null;
  onChange: (id: string) => void;
}) {
  const t = useT();
  if (accounts.length === 0) {
    return <Button title={t('Add an account')} variant="secondary" icon="add" onPress={() => router.push('/account/new')} />;
  }
  return (
    <View style={styles.chips}>
      {accounts.map((a) => (
        <Chip key={a.id} label={a.name} icon={a.icon} color={a.color} selected={value === a.id} onPress={() => onChange(a.id)} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 10 },
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' },
  amountBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  amountInput: { flex: 1, fontSize: 36, fontWeight: '700', paddingVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  splitRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  splitCategory: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 10,
  },
  splitAmount: { width: 110, minHeight: 44, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, fontSize: 16 },
  personInput: { flex: 1, minHeight: 44, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: 10, fontSize: 16 },
  photos: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  thumb: { width: 76, height: 76, borderRadius: 10 },
  addPhoto: { borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  actions: { gap: 10, marginTop: 16 },
  viewer: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', justifyContent: 'center' },
  full: { width: '100%', height: '100%' },
});
