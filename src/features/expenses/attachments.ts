import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import type { SQLiteDatabase } from 'expo-sqlite';

import { newId } from '@/core/utils/id';

import { deleteAttachmentRow, insertAttachment, listAllAttachments } from './repoExtras';
import type { Attachment } from './types';

/**
 * Receipt photos. Files live in the app's private documents folder, named by attachment id;
 * the database keeps one row per photo. Photos are resized (longest side 1600 px) and saved as
 * JPEG, which keeps a receipt readable at around 200 KB and backups small.
 */

const MAX_SIDE = 1600;

function folder(): Directory {
  const dir = new Directory(Paths.document, 'attachments');
  if (!dir.exists) dir.create({ intermediates: true });
  return dir;
}

export function attachmentFile(attachment: Pick<Attachment, 'id'>): File {
  return new File(folder(), `${attachment.id}.jpg`);
}

export type PhotoSource = 'camera' | 'library';

export class PermissionDeniedError extends Error {}

/** Asks for a photo; returns the picked image's uri and size, or null if the user cancelled. */
export async function pickPhoto(source: PhotoSource): Promise<{ uri: string; width: number; height: number } | null> {
  if (source === 'camera') {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) throw new PermissionDeniedError('camera');
  }
  const options: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1, allowsEditing: false };
  const result = source === 'camera'
    ? await ImagePicker.launchCameraAsync(options)
    : await ImagePicker.launchImageLibraryAsync(options);
  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, width: asset.width, height: asset.height };
}

/** Shrinks a picked photo and stores it as an attachment of the transaction. */
export async function addPhoto(
  db: SQLiteDatabase,
  transactionId: string,
  photo: { uri: string; width: number; height: number },
): Promise<Attachment> {
  const context = ImageManipulator.manipulate(photo.uri);
  if (Math.max(photo.width, photo.height) > MAX_SIDE) {
    context.resize(photo.width >= photo.height ? { width: MAX_SIDE } : { height: MAX_SIDE });
  }
  const image = await context.renderAsync();
  const saved = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
  const attachment: Attachment = {
    id: newId(),
    transaction_id: transactionId,
    file_name: 'receipt.jpg',
    mime: 'image/jpeg',
    size: 0,
    created_at: new Date().toISOString(),
  };
  const target = attachmentFile(attachment);
  await new File(saved.uri).copy(target);
  attachment.size = target.size ?? 0;
  await insertAttachment(db, attachment);
  return attachment;
}

export async function deletePhoto(db: SQLiteDatabase, attachment: Attachment): Promise<void> {
  await deleteAttachmentRow(db, attachment.id);
  const file = attachmentFile(attachment);
  if (file.exists) file.delete();
}

/** Removes photo files whose transaction was deleted (the rows go with the transaction). */
export async function cleanUpOrphanPhotos(db: SQLiteDatabase): Promise<number> {
  const rows = await listAllAttachments(db);
  const keep = new Set(rows.map((r) => `${r.id}.jpg`));
  let removed = 0;
  for (const entry of folder().list()) {
    if (entry instanceof File && !keep.has(entry.name)) {
      entry.delete();
      removed += 1;
    }
  }
  return removed;
}

/** Every photo as base64, keyed by attachment id, for a backup. Missing files are skipped. */
export async function readAllPhotos(attachments: Attachment[]): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  for (const a of attachments) {
    const file = attachmentFile(a);
    if (file.exists) files[a.id] = await file.base64();
  }
  return files;
}

/** Replaces all photo files with the ones from a backup. */
export async function writeAllPhotos(files: Record<string, string>): Promise<void> {
  const dir = folder();
  for (const entry of dir.list()) entry.delete();
  for (const [id, base64] of Object.entries(files)) {
    const file = new File(dir, `${id}.jpg`);
    file.create();
    await file.write(base64, { encoding: 'base64' });
  }
}
