/**
 * The few Google Drive v3 REST calls the backup needs. Files live in the app's own hidden "appDataFolder":
 * only LekhaWise (signed in as the same Google account) can see them, they do not clutter the user's Drive,
 * and the app only asks for the narrow drive.appdata permission.
 */

export const DRIVE_APPDATA_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FILE_FIELDS = 'id,name,size,createdTime,appProperties';

export type DriveFile = {
  id: string;
  name: string;
  /** Bytes. */
  size: number;
  createdTime: string;
  appProperties: Record<string, string>;
};

/** A Drive request failed. `status` is the HTTP status, or 0 when the phone could not reach Google at all. */
export class DriveError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'DriveError';
  }
}

type RawFile = { id: string; name: string; size?: string; createdTime: string; appProperties?: Record<string, string> };

function toDriveFile(raw: RawFile): DriveFile {
  return { id: raw.id, name: raw.name, size: Number(raw.size ?? 0), createdTime: raw.createdTime, appProperties: raw.appProperties ?? {} };
}

async function request(token: string, url: string, init: RequestInit = {}): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers: { ...init.headers, Authorization: `Bearer ${token}` } });
  } catch {
    throw new DriveError('Could not reach Google Drive. Check the internet connection.', 0);
  }
  if (!response.ok) {
    let detail = '';
    try {
      detail = ((await response.json()) as { error?: { message?: string } }).error?.message ?? '';
    } catch {
      // no JSON body
    }
    throw new DriveError(detail || `Google Drive answered ${response.status}.`, response.status);
  }
  return response;
}

/** Uploads a text file into the app's folder. `appProperties` are small searchable labels (shown in the list). */
export async function uploadFile(
  token: string,
  name: string,
  content: string,
  mimeType: string,
  appProperties: Record<string, string> = {},
): Promise<DriveFile> {
  const boundary = `lekhawise-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const metadata = { name, mimeType, parents: ['appDataFolder'], appProperties };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}; charset=UTF-8\r\n\r\n${content}\r\n` +
    `--${boundary}--`;
  const response = await request(token, `${UPLOAD}/files?uploadType=multipart&fields=${FILE_FIELDS}`, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  return toDriveFile((await response.json()) as RawFile);
}

/** The app's files whose name starts with `prefix`, newest first. */
export async function listFiles(token: string, prefix: string): Promise<DriveFile[]> {
  const files: DriveFile[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name contains '${prefix.replace(/['\\]/g, '')}' and trashed = false`,
      orderBy: 'createdTime desc',
      pageSize: '100',
      fields: `nextPageToken,files(${FILE_FIELDS})`,
    });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await request(token, `${API}/files?${params.toString()}`);
    const page = (await response.json()) as { files?: RawFile[]; nextPageToken?: string };
    files.push(...(page.files ?? []).filter((f) => f.name.startsWith(prefix)).map(toDriveFile));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return files.sort((a, b) => b.createdTime.localeCompare(a.createdTime));
}

export async function downloadFile(token: string, id: string): Promise<string> {
  const response = await request(token, `${API}/files/${encodeURIComponent(id)}?alt=media`);
  return response.text();
}

export async function deleteFile(token: string, id: string): Promise<void> {
  await request(token, `${API}/files/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
