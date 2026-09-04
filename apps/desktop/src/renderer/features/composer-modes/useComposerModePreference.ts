import { useCallback, useEffect, useState } from 'react';

import type { ComposerModeId } from './types';

const STORAGE_KEY = 'cartethyia.composerMode.v1';
const listeners = new Set<() => void>();
let memoryValue: ComposerModeId | null = null;
let storageSubscribed = false;

function defaultMode(): ComposerModeId {
  return window.electronAPI?.platform === 'win32' ? 'cartethyia-battle' : 'standard';
}

function parseMode(raw: string | null): ComposerModeId | null {
  return raw === 'standard' || raw === 'cartethyia-battle' ? raw : null;
}

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}

function handleStorage(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY) return;
  memoryValue = parseMode(event.newValue) ?? defaultMode();
  notifyListeners();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!storageSubscribed) {
    window.addEventListener('storage', handleStorage);
    storageSubscribed = true;
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size !== 0 || !storageSubscribed) return;
    window.removeEventListener('storage', handleStorage);
    storageSubscribed = false;
  };
}

export function getComposerModePreference(): ComposerModeId {
  if (memoryValue !== null) return memoryValue;
  const fallback = defaultMode();
  try {
    const parsed = parseMode(window.localStorage.getItem(STORAGE_KEY));
    if (!parsed || parsed === fallback) {
      window.localStorage.removeItem(STORAGE_KEY);
      memoryValue = fallback;
      return fallback;
    }
    memoryValue = parsed;
    return parsed;
  } catch {
    return fallback;
  }
}

export function setComposerModePreference(next: ComposerModeId): void {
  const fallback = defaultMode();
  memoryValue = next;
  try {
    if (next === fallback) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // localStorage 不可用时，当前窗口仍使用内存态。
  }
  notifyListeners();
}

export function useComposerModePreference(): {
  mode: ComposerModeId;
  setMode: (next: ComposerModeId) => void;
} {
  const [mode, setModeState] = useState<ComposerModeId>(getComposerModePreference);
  const setMode = useCallback((next: ComposerModeId) => {
    setComposerModePreference(next);
  }, []);

  useEffect(() => {
    const sync = () => setModeState(getComposerModePreference());
    return subscribe(sync);
  }, []);

  return { mode, setMode };
}

export function __resetComposerModePreferenceForTest(): void {
  memoryValue = null;
  listeners.clear();
  if (!storageSubscribed) return;
  window.removeEventListener('storage', handleStorage);
  storageSubscribed = false;
}
