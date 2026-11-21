import { randomUUID } from 'expo-crypto';

/** Random v4 UUID. Text ids let backups from different devices merge without clashes. */
export function newId(): string {
  return randomUUID();
}
