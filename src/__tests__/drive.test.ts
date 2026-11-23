import { deleteFile, downloadFile, DriveError, listFiles, uploadFile } from '@/features/expenses/drive/driveApi';
import { driveErrorKind, isAutoBackupDue } from '@/features/expenses/drive/driveBackup';
import { SignedOutError } from '@/features/expenses/drive/googleAccount';

type Call = { url: string; init: RequestInit };

function mockFetch(responses: { status?: number; body: unknown }[]): Call[] {
  const calls: Call[] = [];
  global.fetch = jest.fn(async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init });
    const next = responses.shift() ?? { body: {} };
    const status = next.status ?? 200;
    const text = typeof next.body === 'string' ? next.body : JSON.stringify(next.body);
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => JSON.parse(text),
      text: async () => text,
    } as Response;
  }) as typeof fetch;
  return calls;
}

describe('Drive REST calls', () => {
  it('uploads into the app folder as one multipart request with the token', async () => {
    const calls = mockFetch([
      { body: { id: 'f1', name: 'lekhawise-backup-2026-11-24.json', size: '42', createdTime: '2026-11-24T10:00:00Z', appProperties: { device: 'Pixel' } } },
    ]);
    const file = await uploadFile('tok', 'lekhawise-backup-2026-11-24.json', '{"a":1}', 'application/json', { device: 'Pixel' });

    expect(file).toEqual({
      id: 'f1',
      name: 'lekhawise-backup-2026-11-24.json',
      size: 42,
      createdTime: '2026-11-24T10:00:00Z',
      appProperties: { device: 'Pixel' },
    });
    const { url, init } = calls[0];
    expect(url).toContain('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const contentType = (init.headers as Record<string, string>)['Content-Type'];
    const boundary = /boundary=(.+)$/.exec(contentType)?.[1];
    expect(boundary).toBeTruthy();
    const body = String(init.body);
    expect(body).toContain('"parents":["appDataFolder"]');
    expect(body).toContain('{"a":1}');
    expect(body.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it('lists only backups in the app folder, newest first, across pages', async () => {
    const calls = mockFetch([
      {
        body: {
          nextPageToken: 'p2',
          files: [
            { id: 'old', name: 'lekhawise-backup-2026-11-01.json', size: '10', createdTime: '2026-11-01T08:00:00Z' },
            { id: 'other', name: 'notes-lekhawise-backup.txt', size: '1', createdTime: '2026-11-30T08:00:00Z' },
          ],
        },
      },
      { body: { files: [{ id: 'new', name: 'lekhawise-backup-2026-11-20.json', size: '20', createdTime: '2026-11-20T08:00:00Z' }] } },
    ]);
    const files = await listFiles('tok', 'lekhawise-backup-');

    expect(files.map((f) => f.id)).toEqual(['new', 'old']);
    expect(calls[0].url).toContain('spaces=appDataFolder');
    expect(calls[1].url).toContain('pageToken=p2');
  });

  it('downloads content and deletes by id', async () => {
    const calls = mockFetch([{ body: 'backup text' }, { status: 204, body: '' }]);
    expect(await downloadFile('tok', 'id/1')).toBe('backup text');
    await deleteFile('tok', 'id/1');

    expect(calls[0].url).toBe('https://www.googleapis.com/drive/v3/files/id%2F1?alt=media');
    expect(calls[1].init.method).toBe('DELETE');
  });

  it('turns HTTP errors and missing internet into DriveError with a status', async () => {
    mockFetch([{ status: 403, body: { error: { message: 'The user has exceeded their Drive storage quota' } } }]);
    const quota = await downloadFile('tok', 'x').catch((e: unknown) => e);
    expect(quota).toBeInstanceOf(DriveError);
    expect((quota as DriveError).status).toBe(403);
    expect(driveErrorKind(quota)).toBe('storageFull');

    global.fetch = jest.fn(async () => {
      throw new TypeError('Network request failed');
    }) as typeof fetch;
    const offline = await downloadFile('tok', 'x').catch((e: unknown) => e);
    expect((offline as DriveError).status).toBe(0);
    expect(driveErrorKind(offline)).toBe('offline');
    expect(driveErrorKind(new SignedOutError())).toBe('signedOut');
    expect(driveErrorKind(new Error('?'))).toBe('failed');
  });
});

describe('automatic Drive backup schedule', () => {
  const now = new Date('2026-11-24T12:00:00Z');

  it('is never due when off, and due at once without a previous backup', () => {
    expect(isAutoBackupDue('off', null, now)).toBe(false);
    expect(isAutoBackupDue('daily', null, now)).toBe(true);
  });

  it('waits a day or a week after the last backup', () => {
    expect(isAutoBackupDue('daily', '2026-11-23T13:00:00Z', now)).toBe(false);
    expect(isAutoBackupDue('daily', '2026-11-23T11:59:00Z', now)).toBe(true);
    expect(isAutoBackupDue('weekly', '2026-11-20T12:00:00Z', now)).toBe(false);
    expect(isAutoBackupDue('weekly', '2026-11-17T11:00:00Z', now)).toBe(true);
  });
});
