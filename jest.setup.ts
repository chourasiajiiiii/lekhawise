/**
 * Test doubles for phone-only modules, so whole screens can be rendered and tapped on a computer.
 * The database double runs real SQL on Node's built-in SQLite (fresh, empty database per render),
 * and the AES double uses Node's real AES-GCM, so encryption is tested for real.
 */
/* eslint-disable @typescript-eslint/no-require-imports */
import { configure } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { setLocalePrefs } from '@/core/i18n/locale';
import { resetSettingsCache } from '@/core/settings/settings';

// ---- expo-sqlite: SQLiteProvider + useSQLiteContext over an in-memory database
jest.mock('expo-sqlite', () => {
  const React = require('react');
  const { createTestDatabase } = require('@/core/db/testing/nodeSqlite');
  const DbContext = React.createContext(null);
  function SQLiteProvider({ children, onInit }: { children: unknown; onInit?: (db: unknown) => Promise<void> }) {
    const [db, setDb] = React.useState(null);
    React.useEffect(() => {
      // If React runs this effect twice, only the latest database may become the app's database;
      // otherwise a slower first initialisation could swap databases in the middle of a test.
      let cancelled = false;
      const instance = createTestDatabase();
      (globalThis as { __testDb?: unknown }).__testDb = instance;
      Promise.resolve(onInit?.(instance)).then(
        () => {
          if (!cancelled) setDb(instance);
        },
        (error: unknown) => process.stdout.write(`SQLITE INIT FAILED: ${String(error)}\n`),
      );
      return () => {
        cancelled = true;
      };
    }, [onInit]);
    return db ? React.createElement(DbContext.Provider, { value: db }, children) : null;
  }
  return {
    SQLiteProvider,
    useSQLiteContext: () => React.useContext(DbContext),
    // Used only to check for encryption support before opening; Node's SQLite has none.
    openDatabaseAsync: async () => createTestDatabase(),
    defaultDatabaseDirectory: '/data/test/SQLite',
  };
});

// ---- expo-sqlite/kv-store: in-memory settings
const mockStore = new Map<string, string>();
jest.mock('expo-sqlite/kv-store', () => ({
  Storage: {
    getItemSync: (key: string) => mockStore.get(key) ?? null,
    setItemSync: (key: string, value: string) => mockStore.set(key, value),
    removeItemSync: (key: string) => mockStore.delete(key),
  },
}));

// ---- expo-crypto: ids, random bytes and AES-256-GCM backed by Node's crypto
jest.mock('expo-crypto', () => {
  const nodeCrypto = jest.requireActual('crypto');
  const toBytes = (input: string | Uint8Array | ArrayBuffer) =>
    typeof input === 'string' ? new Uint8Array(Buffer.from(input, 'base64')) : new Uint8Array(input);
  class AESEncryptionKey {
    raw: Uint8Array;
    constructor(raw: Uint8Array) {
      this.raw = raw;
    }
    static async import(bytes: Uint8Array) {
      return new AESEncryptionKey(new Uint8Array(bytes));
    }
  }
  class AESSealedData {
    bytes: Uint8Array;
    constructor(bytes: Uint8Array) {
      this.bytes = bytes;
    }
    static fromCombined(combined: string | Uint8Array) {
      return new AESSealedData(toBytes(combined));
    }
    async combined(encoding?: 'base64') {
      return encoding === 'base64' ? Buffer.from(this.bytes).toString('base64') : this.bytes;
    }
  }
  return {
    randomUUID: () => nodeCrypto.randomUUID(),
    getRandomBytes: (n: number) => new Uint8Array(nodeCrypto.randomBytes(n)),
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    digest: async (_algorithm: string, data: Uint8Array) => {
      const hash = nodeCrypto.createHash('sha256').update(data).digest();
      return hash.buffer.slice(hash.byteOffset, hash.byteOffset + hash.byteLength);
    },
    AESEncryptionKey,
    AESSealedData,
    aesEncryptAsync: async (plain: Uint8Array | string, key: AESEncryptionKey) => {
      const iv = nodeCrypto.randomBytes(12);
      const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key.raw, iv);
      const body = Buffer.concat([cipher.update(toBytes(plain)), cipher.final()]);
      return new AESSealedData(new Uint8Array(Buffer.concat([iv, body, cipher.getAuthTag()])));
    },
    aesDecryptAsync: async (sealed: AESSealedData, key: AESEncryptionKey) => {
      const bytes = Buffer.from(sealed.bytes);
      const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key.raw, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(bytes.length - 16));
      return new Uint8Array(Buffer.concat([decipher.update(bytes.subarray(12, bytes.length - 16)), decipher.final()]));
    },
  };
});

// ---- expo-secure-store: in-memory
const mockSecure = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: async (key: string) => mockSecure.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => void mockSecure.set(key, value),
  deleteItemAsync: async (key: string) => void mockSecure.delete(key),
}));

jest.mock('expo-local-authentication', () => ({
  SecurityLevel: { NONE: 0, SECRET: 1, BIOMETRIC_WEAK: 2, BIOMETRIC_STRONG: 3 },
  getEnrolledLevelAsync: jest.fn(async () => 3),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

// ---- files: written files are kept in memory so tests can read what was shared
const mockFiles = new Map<string, string | Uint8Array>();
jest.mock('expo-file-system', () => {
  const join = (parts: (string | { uri: string })[]) =>
    parts.map((p) => (typeof p === 'string' ? p : p.uri)).join('/');
  class File {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockFiles.has(this.uri);
    }
    get size() {
      const content = mockFiles.get(this.uri);
      return typeof content === 'string' ? content.length : (content?.length ?? 0);
    }
    get parentDirectory() {
      return new Directory(this.uri.split('/').slice(0, -1).join('/'));
    }
    create() {
      mockFiles.set(this.uri, '');
    }
    delete() {
      mockFiles.delete(this.uri);
    }
    async write(content: string | Uint8Array, options?: { encoding?: string }) {
      mockFiles.set(this.uri, options?.encoding === 'base64' ? Buffer.from(content as string, 'base64').toString('binary') : content);
    }
    async text() {
      const content = mockFiles.get(this.uri) ?? '';
      return typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
    }
    async bytes() {
      const content = mockFiles.get(this.uri) ?? '';
      return typeof content === 'string' ? new Uint8Array(Buffer.from(content, 'binary')) : content;
    }
    async base64() {
      const content = mockFiles.get(this.uri) ?? '';
      return Buffer.from(typeof content === 'string' ? Buffer.from(content, 'binary') : content).toString('base64');
    }
    async copy(target: File) {
      mockFiles.set(target.uri, mockFiles.get(this.uri) ?? '');
    }
    get name() {
      return this.uri.split('/').pop() ?? '';
    }
    /** Tests set the next pick with (File.pickFileAsync as jest.Mock).mockResolvedValueOnce(...). */
    static pickFileAsync = jest.fn(async () => ({ canceled: true, result: null }));
  }
  class Directory {
    uri: string;
    constructor(...parts: (string | { uri: string })[]) {
      this.uri = join(parts);
    }
    get exists() {
      return true;
    }
    create() {}
    list() {
      return [...mockFiles.keys()]
        .filter((uri) => uri.startsWith(`${this.uri}/`) && !uri.slice(this.uri.length + 1).includes('/'))
        .map((uri) => new File(uri));
    }
    createFile(name: string) {
      const file = new File(this, name);
      file.create();
      return file;
    }
    static pickDirectoryAsync = jest.fn();
  }
  return { File, Directory, Paths: { cache: { uri: 'file:///cache' }, document: { uri: 'file:///docs' } } };
});
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(async () => {}),
}));

jest.mock('expo-print', () => ({
  printToFileAsync: jest.fn(async ({ html }: { html: string }) => ({
    uri: 'file:///cache/print.pdf',
    base64: Buffer.from(`%PDF ${html}`).toString('base64'),
  })),
}));

jest.mock('expo-image-picker', () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ granted: true })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true })),
}));

jest.mock('expo-image-manipulator', () => ({
  SaveFormat: { JPEG: 'jpeg' },
  ImageManipulator: {
    manipulate: (uri: string) => {
      const context = {
        resize: () => context,
        renderAsync: async () => ({ saveAsync: async () => ({ uri, width: 100, height: 100 }) }),
      };
      return context;
    },
  },
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  setNotificationChannelAsync: jest.fn(async () => null),
  getPermissionsAsync: jest.fn(async () => ({ granted: true, canAskAgain: true })),
  requestPermissionsAsync: jest.fn(async () => ({ granted: true })),
  scheduleNotificationAsync: jest.fn(async () => 'id'),
  cancelAllScheduledNotificationsAsync: jest.fn(async () => {}),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getLastNotificationResponse: jest.fn(() => null),
  AndroidImportance: { DEFAULT: 3 },
  SchedulableTriggerInputTypes: { DATE: 'date' },
}));

// ---- home-screen widget: records what the app would show
jest.mock('expo-widgets', () => ({
  createWidget: jest.fn(() => ({ updateSnapshot: jest.fn(), reload: jest.fn() })),
}));
jest.mock('@expo/ui/swift-ui', () => ({ Text: 'Text', VStack: 'VStack', Spacer: 'Spacer' }));
jest.mock('@expo/ui/swift-ui/modifiers', () => ({
  containerBackground: jest.fn(),
  font: jest.fn(),
  foregroundStyle: jest.fn(),
  padding: jest.fn(),
}));

jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn(async () => {}) }));

jest.mock('expo-screen-capture', () => ({
  preventScreenCaptureAsync: jest.fn(async () => {}),
  allowScreenCaptureAsync: jest.fn(async () => {}),
  enableAppSwitcherProtectionAsync: jest.fn(async () => {}),
  disableAppSwitcherProtectionAsync: jest.fn(async () => {}),
}));

jest.mock('@react-native-community/datetimepicker', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Picker = (props: object) => React.createElement(View, { testID: 'date-picker', ...props });
  return { __esModule: true, default: Picker, DateTimePickerAndroid: { open: jest.fn() } };
});

(globalThis as { __files?: Map<string, string | Uint8Array> }).__files = mockFiles;

// Tabs and stacks keep earlier screens mounted but hidden. Query only what a user can actually see.
configure({ defaultIncludeHiddenElements: false });

beforeEach(() => {
  jest.clearAllMocks(); // call history only; mock implementations stay
  mockStore.clear();
  mockFiles.clear();
  mockSecure.clear();
  resetSettingsCache();
  // Tests run in English with fixed formats, whatever the computer's own settings are.
  mockStore.set('language', JSON.stringify('en'));
  setLocalePrefs({ language: 'en', dateFormat: 'system', numberFormat: 'international' });
  mockStore.set('numberFormat', JSON.stringify('international'));
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});
