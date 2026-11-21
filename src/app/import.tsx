import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert, StyleSheet, View } from 'react-native';

import { pickTextFile } from '@/core/files/files';
import { useQuery } from '@/core/db/useQuery';
import { tPlural, useT } from '@/core/i18n/locale';
import { useTheme } from '@/core/theme/theme';
import { AppText, Button, Card, Chip, Divider, Screen, SectionTitle, Segmented, SelectModal } from '@/core/ui';
import { parseCsv } from '@/core/utils/csv';
import { formatDate } from '@/core/utils/date';
import { decimalSeparator } from '@/core/utils/money';
import { useMoney } from '@/features/expenses/components/Money';
import { buildImportRows, type ColumnMapping, type DateOrder, detectDateOrder, guessMapping } from '@/features/expenses/csvImport';
import { commitImport, type PreparedRow, prepareImport } from '@/features/expenses/importer';
import { listAccounts } from '@/features/expenses/repo';
import { useCurrency } from '@/features/expenses/settings';

const FIELDS: { key: keyof ColumnMapping; label: string; required?: boolean }[] = [
  { key: 'date', label: 'Date', required: true },
  { key: 'description', label: 'Description' },
  { key: 'amount', label: 'Amount (+ in, − out)' },
  { key: 'debit', label: 'Money out' },
  { key: 'credit', label: 'Money in' },
  { key: 'type', label: 'Type (expense/income, Dr/Cr)' },
  { key: 'category', label: 'Category' },
  { key: 'account', label: 'Account' },
  { key: 'toAccount', label: 'To account' },
];

/** Import a bank statement or spreadsheet saved as CSV: map columns, preview, then import. */
export default function ImportScreen() {
  const db = useSQLiteContext();
  const { colors } = useTheme();
  const t = useT();
  const money = useMoney();
  const [currency] = useCurrency();
  const { data: accounts = [] } = useQuery((db) => listAccounts(db), []);
  const [fileName, setFileName] = useState<string | null>(null);
  const [header, setHeader] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [dateOrder, setDateOrder] = useState<DateOrder>('dmy');
  const [separator, setSeparator] = useState<'.' | ','>(decimalSeparator());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [picking, setPicking] = useState<keyof ColumnMapping | null>(null);
  const [preview, setPreview] = useState<PreparedRow[] | null>(null);
  const [skip, setSkip] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const chosenAccount = accountId ?? accounts[0]?.id ?? '';

  const choose = async () => {
    try {
      const picked = await pickTextFile();
      if (!picked) return;
      const table = parseCsv(picked.text);
      if (table.length < 2) {
        Alert.alert(t('Nothing to import'), t('The file needs a header row and at least one row of data.'));
        return;
      }
      const guessed = guessMapping(table[0]);
      setFileName(picked.name);
      setHeader(table[0]);
      setRows(table.slice(1));
      setMapping(guessed);
      if (guessed.date !== null) setDateOrder(detectDateOrder(table.slice(1).map((r) => r[guessed.date!] ?? '')));
      setPreview(null);
    } catch (e) {
      console.error(e);
      Alert.alert(t('Could not read the file'), t('Save the statement as CSV and try again.'));
    }
  };

  const check = async () => {
    if (!mapping) return;
    if (mapping.date === null || (mapping.amount === null && mapping.debit === null && mapping.credit === null)) {
      Alert.alert(t('Columns needed'), t('Choose at least the date column and an amount column.'));
      return;
    }
    setBusy(true);
    try {
      const built = buildImportRows(rows, mapping, { dateOrder, decimalSeparator: separator, currency });
      const prepared = await prepareImport(db, built, chosenAccount);
      setPreview(prepared);
      setSkip(new Set(prepared.filter((r) => r.duplicate || r.error).map((r) => r.line)));
    } finally {
      setBusy(false);
    }
  };

  const run = async () => {
    if (!preview) return;
    const chosen = preview.filter((r) => !skip.has(r.line) && !r.error);
    setBusy(true);
    try {
      const count = await commitImport(db, chosen);
      Alert.alert(t('Imported'), tPlural(count, '{count} transaction was added.', '{count} transactions were added.'));
      router.back();
    } catch (e) {
      console.error(e);
      Alert.alert(t('Could not import'), t('Nothing was added. Please check the file and try again.'));
    } finally {
      setBusy(false);
    }
  };

  const columnName = (index: number | null) => (index === null ? t('Not used') : header[index] || t('Column {n}', { n: index + 1 }));
  const included = preview?.filter((r) => !skip.has(r.line) && !r.error) ?? [];

  return (
    <Screen>
      <Card style={styles.gap}>
        <AppText variant="caption" muted>
          {t('Most banks let you download a statement as CSV or Excel. Save an Excel file as CSV first. LekhaWise CSV exports can be imported too.')}
        </AppText>
        <Button title={fileName ? t('Choose another file') : t('Choose CSV file')} icon="folder-open-outline" variant="secondary" onPress={choose} />
        {fileName ? (
          <AppText variant="label">
            {fileName} · {tPlural(rows.length, '{count} row', '{count} rows')}
          </AppText>
        ) : null}
      </Card>

      {mapping && !preview ? (
        <>
          <SectionTitle>{t('Columns')}</SectionTitle>
          <Card style={styles.listCard}>
            {FIELDS.map((f, i) => (
              <View key={f.key}>
                {i > 0 ? <Divider /> : null}
                <View style={styles.mapRow}>
                  <AppText style={styles.flex}>
                    {t(f.label)}
                    {f.required ? ' *' : ''}
                  </AppText>
                  <Chip label={columnName(mapping[f.key])} selected={mapping[f.key] !== null} onPress={() => setPicking(f.key)} />
                </View>
              </View>
            ))}
          </Card>
          <SectionTitle>{t('How dates are written')}</SectionTitle>
          <Segmented
            options={[
              { value: 'dmy', label: t('Day first') },
              { value: 'mdy', label: t('Month first') },
              { value: 'ymd', label: t('Year first') },
            ]}
            value={dateOrder}
            onChange={setDateOrder}
          />
          {mapping.date !== null && rows[0] ? (
            <AppText variant="caption" muted>
              {t('First date in the file: "{value}"', { value: rows[0][mapping.date] ?? '' })}
            </AppText>
          ) : null}
          <SectionTitle>{t('Decimal separator in amounts')}</SectionTitle>
          <Segmented
            options={[
              { value: '.', label: '1,234.50' },
              { value: ',', label: '1.234,50' },
            ]}
            value={separator}
            onChange={setSeparator}
          />
          <SectionTitle>{t('Import into account')}</SectionTitle>
          <View style={styles.chips}>
            {accounts.map((a) => (
              <Chip key={a.id} label={a.name} icon={a.icon} color={a.color} selected={chosenAccount === a.id} onPress={() => setAccountId(a.id)} />
            ))}
          </View>
          <AppText variant="caption" muted>
            {t('Rows with an account column that matches one of your accounts go to that account. Categories are matched by name; others go to "Other".')}
          </AppText>
          <Button title={t('Check the rows')} icon="eye-outline" onPress={check} loading={busy} />
        </>
      ) : null}

      {preview ? (
        <>
          <SectionTitle>{t('Preview')}</SectionTitle>
          <AppText variant="caption" muted>
            {t('Tap a row to include or leave it out. Possible duplicates of entries already in the app and rows with problems are left out to start with.')}
          </AppText>
          <Card style={styles.listCard}>
            {preview.slice(0, 300).map((r, i) => {
              const on = !skip.has(r.line) && !r.error;
              return (
                <View key={r.line}>
                  {i > 0 ? <Divider /> : null}
                  <View style={[styles.previewRow, !on ? styles.off : null]}>
                    <Chip
                      label={on ? '✓' : '–'}
                      selected={on}
                      onPress={() => {
                        if (r.error) return;
                        setSkip((s) => {
                          const next = new Set(s);
                          if (next.has(r.line)) next.delete(r.line);
                          else next.add(r.line);
                          return next;
                        });
                      }}
                    />
                    <View style={styles.flex}>
                      <AppText numberOfLines={1}>{r.note || r.category_name || t('Transfer')}</AppText>
                      <AppText variant="caption" muted numberOfLines={1}>
                        {r.error
                          ? t('Line {line}: {error}', { line: r.line, error: t(r.error) })
                          : `${formatDate(r.date)} · ${r.category_name ?? t('Transfer')}${r.duplicate ? ` · ${t('possible duplicate')}` : ''}`}
                      </AppText>
                    </View>
                    <AppText variant="label" color={r.type === 'expense' ? colors.expense : r.type === 'income' ? colors.income : colors.text}>
                      {r.type === 'expense' ? '-' : r.type === 'income' ? '+' : ''}
                      {money(r.amount)}
                    </AppText>
                  </View>
                </View>
              );
            })}
          </Card>
          {preview.length > 300 ? (
            <AppText variant="caption" muted>
              {t('Showing the first 300 rows. All included rows will be imported.')}
            </AppText>
          ) : null}
          <Button
            title={tPlural(included.length, 'Import {count} transaction', 'Import {count} transactions')}
            icon="download-outline"
            onPress={run}
            loading={busy}
            disabled={!included.length}
          />
          <Button title={t('Back to columns')} variant="ghost" onPress={() => setPreview(null)} />
        </>
      ) : null}

      <SelectModal
        visible={picking !== null}
        title={picking ? t(FIELDS.find((f) => f.key === picking)?.label ?? '') : ''}
        options={[{ value: '-1', label: t('Not used') }, ...header.map((h, i) => ({ value: String(i), label: h || t('Column {n}', { n: i + 1 }), subtitle: rows[0]?.[i] }))]}
        selected={picking && mapping ? String(mapping[picking] ?? -1) : null}
        onSelect={(value) => {
          if (picking && mapping) {
            const index = Number(value);
            setMapping({ ...mapping, [picking]: index < 0 ? null : index });
          }
          setPicking(null);
        }}
        onCancel={() => setPicking(null)}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: 10 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  listCard: { paddingVertical: 4 },
  mapRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  previewRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  off: { opacity: 0.45 },
});
