import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

export type FileContent = string | Uint8Array;

/**
 * Writes content to a temporary file and opens the system share sheet, so the
 * user can send it to Files / Google Drive / iCloud / email / WhatsApp.
 * No server involved: the user decides where their data goes.
 * Returns when the share sheet closes (the platform does not say whether the user completed it).
 */
export async function shareFile(
  fileName: string,
  content: FileContent,
  options: { mimeType: string; uti?: string; encoding?: 'base64' },
): Promise<void> {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.create();
  await file.write(content, options.encoding ? { encoding: options.encoding } : undefined);
  await shareExistingFile(file.uri, fileName, options);
}

/** Opens the share sheet for a file that already exists (for example a PDF the print module made). */
export async function shareExistingFile(
  uri: string,
  title: string,
  options: { mimeType: string; uti?: string },
): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, { mimeType: options.mimeType, UTI: options.uti, dialogTitle: title });
}

/** Kept for existing callers: text is just one kind of content. */
export function shareTextFile(fileName: string, content: string, options: { mimeType: string; uti?: string }) {
  return shareFile(fileName, content, options);
}

/**
 * Android only. The folder picker opens in Documents: Android 11+ does not let apps use the root of
 * Downloads or of the phone storage, but Documents (or any sub-folder) is allowed.
 */
const ANDROID_DOCUMENTS_URI = 'content://com.android.externalstorage.documents/document/primary%3ADocuments';

/**
 * Android only: the user picks a folder on the phone and the file is written there.
 * The Android share sheet has no "save to device" target, so this fills that gap.
 * Returns false if the user cancelled the folder picker.
 */
export async function saveFileToFolder(
  fileName: string,
  content: FileContent,
  mimeType: string,
  encoding?: 'base64',
): Promise<boolean> {
  if (Platform.OS !== 'android') throw new Error('Folder saving is only used on Android.');
  let folder: Directory;
  try {
    folder = await Directory.pickDirectoryAsync(ANDROID_DOCUMENTS_URI);
  } catch {
    return false; // picker dismissed
  }
  const file = folder.createFile(fileName, mimeType);
  await file.write(content, encoding ? { encoding } : undefined);
  return true;
}

export function saveTextFileToFolder(fileName: string, content: string, mimeType: string): Promise<boolean> {
  return saveFileToFolder(fileName, content, mimeType);
}

/**
 * Lets the user pick a file and returns its text, or null if they cancelled.
 * Uses the file-system module's own picker so the app is granted read access to the chosen file.
 */
export async function pickTextFile(): Promise<{ name: string; text: string } | null> {
  // JSON and CSV files often arrive as text/plain or octet-stream, so accept anything and validate the content.
  const picked = await File.pickFileAsync({ mimeTypes: '*/*' });
  if (picked.canceled) return null;
  return { name: picked.result.name, text: await picked.result.text() };
}
