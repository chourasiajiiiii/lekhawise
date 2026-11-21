/**
 * Shared helpers for the screen tests (not a test file itself).
 */
import { router } from 'expo-router';
import { act, fireEvent, renderRouter, screen, waitFor } from 'expo-router/testing-library';
import type { SQLiteDatabase } from 'expo-sqlite';
import { Alert } from 'react-native';

export const files = () => (globalThis as unknown as { __files: Map<string, string | Uint8Array> }).__files;
export const db = () => (globalThis as unknown as { __testDb: SQLiteDatabase }).__testDb;
export const alerts = () => (Alert.alert as jest.Mock).mock.calls;
export const lastAlert = () => alerts()[alerts().length - 1];

/** Presses a button in the most recent Alert.alert call. */
export async function pressAlert(text: string) {
  const button = (lastAlert()[2] as { text: string; onPress?: () => unknown }[]).find((b) => b.text === text);
  if (!button) throw new Error(`No alert button "${text}" in ${JSON.stringify(lastAlert())}`);
  await act(async () => {
    await button.onPress?.();
  });
}

export async function start(url = '/') {
  await renderRouter('./src/app', { initialUrl: url });
  await screen.findAllByText(/.+/);
}

export async function go(path: string, params?: Record<string, string>) {
  await act(async () => router.navigate((params ? { pathname: path, params } : path) as never));
}

export async function press(text: string | RegExp, index = 0) {
  const matches = await screen.findAllByText(text);
  if (!matches[index]) throw new Error(`Only ${matches.length} match(es) for ${String(text)}`);
  await fireEvent.press(matches[index]);
}

/** Presses the last match, e.g. the button inside a modal that sits on top of a form with the same button. */
export async function pressLast(text: string | RegExp) {
  const matches = await screen.findAllByText(text);
  await fireEvent.press(matches[matches.length - 1]);
}

export async function tapLabel(label: string | RegExp, index = 0) {
  const matches = await screen.findAllByLabelText(label);
  await fireEvent.press(matches[index]);
}

export async function type(label: string, text: string) {
  await fireEvent.changeText(await screen.findByLabelText(label), text);
}

export async function typeIn(placeholder: string, text: string, index = 0) {
  const matches = await screen.findAllByPlaceholderText(placeholder);
  await fireEvent.changeText(matches[index], text);
}

export type TxOptions = {
  amount: string;
  type?: 'Expense' | 'Income' | 'Transfer';
  category?: string;
  account?: string;
  note?: string;
};

/** Fills and saves the add-transaction form. */
export async function addTransaction({ amount, type: kind, category, account, note }: TxOptions) {
  await go('/transaction/new');
  const input = await screen.findByLabelText('Amount');
  if (kind && kind !== 'Expense') await press(kind);
  await fireEvent.changeText(input, amount);
  if (category) await press(category);
  if (account) await press(account);
  if (note) await fireEvent.changeText(screen.getByPlaceholderText('Optional'), note);
  await press('Save');
  await waitFor(() => expect(screen.queryByLabelText('Amount')).toBeNull());
}

export const count = async (sql: string, ...params: (string | number)[]) =>
  (await db().getFirstAsync<{ n: number }>(sql, ...params))?.n;

export async function back() {
  await act(async () => router.back());
}
