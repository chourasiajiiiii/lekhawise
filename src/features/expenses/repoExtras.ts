import type { SQLiteDatabase } from 'expo-sqlite';

import { notifyDataChanged } from '@/core/db/events';
import { newId } from '@/core/utils/id';

import type { Attachment, Tag, Template, TxType } from './types';

// ---------------------------------------------------------------- tags

export type TagWithCount = Tag & { count: number };

export function listTags(db: SQLiteDatabase): Promise<TagWithCount[]> {
  return db.getAllAsync<TagWithCount>(
    `select g.*, (select count(*) from transaction_tags tt where tt.tag_id = g.id) as count
     from tags g order by g.name collate nocase`,
  );
}

/** Creates a tag, or returns the existing one with the same name (names ignore case). */
export async function createTag(db: SQLiteDatabase, name: string, color: string): Promise<string> {
  const trimmed = name.trim().replace(/^#/, '');
  if (!trimmed) throw new Error('Enter a tag name.');
  const existing = await db.getFirstAsync<{ id: string }>('select id from tags where name = ? collate nocase', trimmed);
  if (existing) return existing.id;
  const id = newId();
  await db.runAsync('insert into tags (id, name, color) values (?, ?, ?)', id, trimmed, color);
  notifyDataChanged();
  return id;
}

export async function renameTag(db: SQLiteDatabase, id: string, name: string, color: string): Promise<void> {
  const trimmed = name.trim().replace(/^#/, '');
  if (!trimmed) throw new Error('Enter a tag name.');
  const clash = await db.getFirstAsync<{ id: string }>(
    'select id from tags where name = ? collate nocase and id <> ?',
    trimmed, id,
  );
  if (clash) throw new Error('Another tag already has this name.');
  await db.runAsync('update tags set name = ?, color = ? where id = ?', trimmed, color, id);
  notifyDataChanged();
}

/** Removes the tag from every transaction and deletes it. Transactions themselves are kept. */
export async function deleteTag(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('delete from tags where id = ?', id);
  notifyDataChanged();
}

// ---------------------------------------------------------------- templates

export type TemplateView = Template & {
  category_name: string | null;
  category_icon: string | null;
  category_color: string | null;
  account_name: string | null;
};

export function listTemplates(db: SQLiteDatabase): Promise<TemplateView[]> {
  return db.getAllAsync<TemplateView>(
    `select tp.*, c.name as category_name, c.icon as category_icon, c.color as category_color, a.name as account_name
     from templates tp
     left join categories c on c.id = tp.category_id
     left join accounts a on a.id = tp.account_id
     order by tp.sort_order, tp.name collate nocase`,
  );
}

export type TemplateInput = {
  name: string;
  type: TxType;
  amount: number | null;
  category_id: string | null;
  account_id: string | null;
  to_account_id: string | null;
  note: string;
};

export async function saveTemplate(db: SQLiteDatabase, id: string | null, input: TemplateInput): Promise<string> {
  const name = input.name.trim();
  if (!name) throw new Error('Give the template a name.');
  const values = [
    name, input.type, input.amount && input.amount > 0 ? input.amount : null,
    input.type === 'transfer' ? null : input.category_id, input.account_id,
    input.type === 'transfer' ? input.to_account_id : null, input.note.trim(),
  ];
  if (id) {
    await db.runAsync(
      `update templates set name = ?, type = ?, amount = ?, category_id = ?, account_id = ?, to_account_id = ?, note = ?
       where id = ?`,
      ...values, id,
    );
  } else {
    id = newId();
    const max = await db.getFirstAsync<{ m: number | null }>('select max(sort_order) as m from templates');
    await db.runAsync(
      `insert into templates (id, name, type, amount, category_id, account_id, to_account_id, note, sort_order, created_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id, ...values, (max?.m ?? 0) + 1, new Date().toISOString(),
    );
  }
  notifyDataChanged();
  return id;
}

export async function deleteTemplate(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('delete from templates where id = ?', id);
  notifyDataChanged();
}

// ---------------------------------------------------------------- attachments (rows; files live in attachments.ts)

export function listAttachments(db: SQLiteDatabase, transactionId: string): Promise<Attachment[]> {
  return db.getAllAsync<Attachment>(
    'select * from attachments where transaction_id = ? order by created_at',
    transactionId,
  );
}

export function listAllAttachments(db: SQLiteDatabase): Promise<Attachment[]> {
  return db.getAllAsync<Attachment>('select * from attachments');
}

export async function insertAttachment(db: SQLiteDatabase, row: Attachment): Promise<void> {
  await db.runAsync(
    'insert into attachments (id, transaction_id, file_name, mime, size, created_at) values (?, ?, ?, ?, ?, ?)',
    row.id, row.transaction_id, row.file_name, row.mime, row.size, row.created_at,
  );
  notifyDataChanged();
}

export async function deleteAttachmentRow(db: SQLiteDatabase, id: string): Promise<void> {
  await db.runAsync('delete from attachments where id = ?', id);
  notifyDataChanged();
}
