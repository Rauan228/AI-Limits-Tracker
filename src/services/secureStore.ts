import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { AccountCredentials } from '../models/types';

const MEMORY_VAULT = new Map<string, string>();

function getStorageKey(accountId: string): string {
  return `sec_cred_${accountId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}

export async function saveAccountCredentials(
  accountId: string,
  credentials: AccountCredentials
): Promise<void> {
  const key = getStorageKey(accountId);
  const serialized = JSON.stringify(credentials);

  if (Platform.OS === 'web') {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.setItem(key, serialized);
      } else {
        MEMORY_VAULT.set(key, serialized);
      }
    } catch {
      MEMORY_VAULT.set(key, serialized);
    }
    return;
  }

  await SecureStore.setItemAsync(key, serialized, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
}

export async function getAccountCredentials(
  accountId: string
): Promise<AccountCredentials | null> {
  const key = getStorageKey(accountId);

  if (Platform.OS === 'web') {
    try {
      let raw: string | null = null;
      if (typeof window !== 'undefined' && window.localStorage) {
        raw = window.localStorage.getItem(key);
      } else {
        raw = MEMORY_VAULT.get(key) || null;
      }
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  try {
    const raw = await SecureStore.getItemAsync(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    // Sanitized: never log credentials or token strings
    return null;
  }
}

export async function deleteAccountCredentials(accountId: string): Promise<void> {
  const key = getStorageKey(accountId);

  if (Platform.OS === 'web') {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(key);
      }
      MEMORY_VAULT.delete(key);
    } catch {}
    return;
  }

  try {
    await SecureStore.deleteItemAsync(key);
  } catch {}
}
