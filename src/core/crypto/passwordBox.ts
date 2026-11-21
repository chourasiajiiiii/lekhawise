import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import {
  AESEncryptionKey,
  AESSealedData,
  aesDecryptAsync,
  aesEncryptAsync,
  CryptoDigestAlgorithm,
  digest,
  getRandomBytes,
} from 'expo-crypto';
import { strToU8 } from 'fflate';

/**
 * Password-based encryption for files the user keeps elsewhere (backups).
 *
 * - Key: the OpenPGP "iterated and salted" S2K (RFC 4880, section 3.7.1.3, as used by GnuPG): SHA-256
 *   over salt + password repeated to `count` bytes. One native hash call over 32 MB makes every
 *   password guess cost an attacker about as much as 250,000 rounds of PBKDF2, while the phone needs
 *   well under a second. (PBKDF2 written in JavaScript took 25 s on Hermes, which has no JIT.)
 * - Cipher: AES-256-GCM from the phone's own crypto library (expo-crypto). GCM is authenticated,
 *   so a wrong password or a modified file is detected instead of producing garbage.
 * - The method and its cost are stored in the file, so they can change later without breaking old files.
 */

export const S2K_COUNT = 32 * 1024 * 1024;

export type SealedBox = {
  cipher: 'aes-256-gcm';
  kdf: 'openpgp-s2k-sha256' | 'pbkdf2-sha256';
  /** Bytes hashed, for openpgp-s2k-sha256. */
  count?: number;
  /** Rounds, for pbkdf2-sha256. */
  iterations?: number;
  salt: string; // base64
  data: string; // base64 of iv + ciphertext + tag
};

export class WrongPasswordError extends Error {
  constructor() {
    super('Wrong password, or the file has been changed.');
  }
}

/** RFC 4880 iterated and salted S2K with SHA-256, giving a 32-byte key. */
export async function s2kSha256(secret: string, salt: Uint8Array, count: number): Promise<Uint8Array> {
  const password = strToU8(secret.normalize('NFC'));
  const unit = new Uint8Array(salt.length + password.length);
  unit.set(salt);
  unit.set(password, salt.length);
  const total = Math.max(count, unit.length);
  const buffer = new Uint8Array(total);
  buffer.set(unit.subarray(0, Math.min(unit.length, total)));
  // The buffer is salt+password repeated; doubling the filled prefix keeps the pattern intact.
  for (let filled = Math.min(unit.length, total); filled < total; ) {
    const n = Math.min(filled, total - filled);
    buffer.copyWithin(filled, 0, n);
    filled += n;
  }
  return new Uint8Array(await digest(CryptoDigestAlgorithm.SHA256, buffer));
}

async function deriveKey(password: string, box: Pick<SealedBox, 'kdf' | 'count' | 'iterations'>, salt: Uint8Array) {
  const bytes =
    box.kdf === 'openpgp-s2k-sha256'
      ? await s2kSha256(password, salt, box.count ?? S2K_COUNT)
      : await pbkdf2Async(sha256, password.normalize('NFC'), salt, { c: box.iterations ?? 0, dkLen: 32, asyncTick: 20 });
  return AESEncryptionKey.import(bytes);
}

export async function sealWithPassword(plain: Uint8Array, password: string, count: number = S2K_COUNT): Promise<SealedBox> {
  if (!password) throw new Error('A password is required.');
  const salt = getRandomBytes(16);
  const header = { kdf: 'openpgp-s2k-sha256' as const, count };
  const key = await deriveKey(password, header, salt);
  const sealed = await aesEncryptAsync(plain, key);
  return {
    cipher: 'aes-256-gcm',
    ...header,
    salt: toBase64(salt),
    data: await sealed.combined('base64'),
  };
}

export async function openWithPassword(box: SealedBox, password: string): Promise<Uint8Array> {
  const known =
    box.cipher === 'aes-256-gcm' &&
    ((box.kdf === 'openpgp-s2k-sha256' && Number.isInteger(box.count) && (box.count ?? 0) <= 256 * 1024 * 1024) ||
      (box.kdf === 'pbkdf2-sha256' && Number.isInteger(box.iterations)));
  if (!known) throw new Error('This file uses an encryption method this version of the app does not know.');
  const key = await deriveKey(password, box, fromBase64(box.salt));
  try {
    const sealed = AESSealedData.fromCombined(box.data);
    return await aesDecryptAsync(sealed, key);
  } catch {
    throw new WrongPasswordError();
  }
}

export function isSealedBox(value: unknown): value is SealedBox {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.cipher === 'string' && typeof v.kdf === 'string' && typeof v.salt === 'string' && typeof v.data === 'string';
}

// Small base64 helpers for short values such as the salt.
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    out += i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? ALPHABET[n & 63] : '=';
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let j = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (ALPHABET.indexOf(clean[i]) << 18) |
      (ALPHABET.indexOf(clean[i + 1]) << 12) |
      ((ALPHABET.indexOf(clean[i + 2] ?? 'A') & 63) << 6) |
      (ALPHABET.indexOf(clean[i + 3] ?? 'A') & 63);
    bytes[j++] = (n >> 16) & 255;
    if (i + 2 < clean.length) bytes[j++] = (n >> 8) & 255;
    if (i + 3 < clean.length) bytes[j++] = n & 255;
  }
  return bytes.slice(0, j);
}
