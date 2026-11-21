import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { getRandomBytes } from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { fromBase64, s2kSha256, toBase64 } from '../crypto/passwordBox';
import { getSetting, removeSetting, setSetting } from '../settings/settings';

/**
 * App PIN. Only a salted, slow hash is kept, in the phone's secure storage (Android Keystore,
 * iOS Keychain), never the PIN itself. After repeated wrong attempts the PIN pad pauses,
 * with the pause growing each time.
 */

const PIN_KEY = 'app.pinHash';
/** Bytes hashed per check (RFC 4880 S2K with SHA-256): instant on a phone, a real cost per guess. */
const S2K_COUNT = 1024 * 1024;
const FAILURES_KEY = 'pinFailures';
const FREE_ATTEMPTS = 5;

export const PIN_MIN_LENGTH = 4;
export const PIN_MAX_LENGTH = 6;

/** v1 used PBKDF2 (too slow in JavaScript on Hermes); v2 uses the native-hash S2K. */
type StoredPin =
  | { v: 1; iterations: number; salt: string; hash: string; length: number }
  | { v: 2; count: number; salt: string; hash: string; length: number };

async function hashPin(pin: string, salt: Uint8Array, stored: Pick<StoredPin, 'v'> & { count?: number; iterations?: number }) {
  const bytes =
    stored.v === 2
      ? await s2kSha256(pin, salt, stored.count ?? S2K_COUNT)
      : await pbkdf2Async(sha256, pin, salt, { c: stored.iterations ?? 0, dkLen: 32, asyncTick: 20 });
  return toBase64(bytes);
}

export function isValidPin(pin: string): boolean {
  return new RegExp(`^\\d{${PIN_MIN_LENGTH},${PIN_MAX_LENGTH}}$`).test(pin);
}

export async function setPin(pin: string): Promise<void> {
  if (!isValidPin(pin)) throw new Error(`The PIN must be ${PIN_MIN_LENGTH} to ${PIN_MAX_LENGTH} digits.`);
  const salt = getRandomBytes(16);
  const stored: StoredPin = {
    v: 2,
    count: S2K_COUNT,
    salt: toBase64(salt),
    hash: await hashPin(pin, salt, { v: 2, count: S2K_COUNT }),
    length: pin.length,
  };
  await SecureStore.setItemAsync(PIN_KEY, JSON.stringify(stored));
  removeSetting(FAILURES_KEY);
}

export async function clearPin(): Promise<void> {
  await SecureStore.deleteItemAsync(PIN_KEY);
  removeSetting(FAILURES_KEY);
}

async function readPin(): Promise<StoredPin | null> {
  const raw = await SecureStore.getItemAsync(PIN_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredPin;
  } catch {
    return null;
  }
}

export async function hasPin(): Promise<boolean> {
  return (await readPin()) !== null;
}

/** Number of digits in the saved PIN, so the pad can check as soon as enough are typed. */
export async function pinLength(): Promise<number | null> {
  return (await readPin())?.length ?? null;
}

type Failures = { count: number; until: number };

/** Milliseconds until another attempt is allowed (0 when allowed now). */
export function pinLockoutRemaining(now: number = Date.now()): number {
  const failures = getSetting<Failures | null>(FAILURES_KEY, null);
  return failures ? Math.max(0, failures.until - now) : 0;
}

/** 30 s after five wrong attempts, then doubling with every further wrong attempt (capped at an hour). */
export function lockoutFor(failedCount: number): number {
  if (failedCount < FREE_ATTEMPTS) return 0;
  return Math.min(30_000 * 2 ** (failedCount - FREE_ATTEMPTS), 3_600_000);
}

export type PinCheck = { ok: true } | { ok: false; lockedForMs: number; attemptsLeft: number };

export async function verifyPin(pin: string, now: number = Date.now()): Promise<PinCheck> {
  const waiting = pinLockoutRemaining(now);
  if (waiting > 0) return { ok: false, lockedForMs: waiting, attemptsLeft: 0 };
  const stored = await readPin();
  if (!stored) return { ok: false, lockedForMs: 0, attemptsLeft: 0 };
  const hash = await hashPin(pin, fromBase64(stored.salt), stored);
  if (hash === stored.hash) {
    removeSetting(FAILURES_KEY);
    return { ok: true };
  }
  const count = (getSetting<Failures | null>(FAILURES_KEY, null)?.count ?? 0) + 1;
  const lockedForMs = lockoutFor(count);
  setSetting<Failures>(FAILURES_KEY, { count, until: now + lockedForMs });
  return { ok: false, lockedForMs, attemptsLeft: Math.max(0, FREE_ATTEMPTS - count) };
}
