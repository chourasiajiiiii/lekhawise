import { Storage } from 'expo-sqlite/kv-store';
import { useCallback, useSyncExternalStore } from 'react';

/**
 * Small typed key/value settings backed by expo-sqlite's kv-store.
 * Reads are synchronous, so the theme and app lock are known before first render.
 */

const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

export function getSetting<T>(key: string, fallback: T): T {
  if (cache.has(key)) return cache.get(key) as T;
  let value = fallback;
  try {
    const raw = Storage.getItemSync(key);
    if (raw !== null) value = JSON.parse(raw) as T;
  } catch (error) {
    console.warn(`Could not read setting "${key}"`, error);
  }
  cache.set(key, value);
  return value;
}

export function setSetting<T>(key: string, value: T): void {
  Storage.setItemSync(key, JSON.stringify(value));
  cache.set(key, value);
  listeners.get(key)?.forEach((listener) => listener());
}

export function removeSetting(key: string): void {
  Storage.removeItemSync(key);
  cache.delete(key);
  listeners.get(key)?.forEach((listener) => listener());
}

/** Forgets cached values so the next read goes to storage. Used by tests between cases. */
export function resetSettingsCache(): void {
  cache.clear();
}

function subscribe(key: string, listener: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(listener);
  return () => {
    set.delete(listener);
  };
}

/** React hook: `const [currency, setCurrency] = useSetting('currency', 'USD');` */
export function useSetting<T>(key: string, fallback: T): [T, (value: T) => void] {
  const value = useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(key, listener), [key]),
    () => getSetting(key, fallback),
  );
  const update = useCallback((next: T) => setSetting(key, next), [key]);
  return [value, update];
}
