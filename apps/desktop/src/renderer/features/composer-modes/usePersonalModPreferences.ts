import { useSyncExternalStore } from 'react';
import type { ModDisplayOption, ModDisplayOptions } from './types';

const STORAGE_KEY = 'cartethyia.personalMods.v1';
const listeners = new Set<() => void>();
let fallbackRaw: string | null = null;
let storageUnavailable = false;

interface Overrides {
  enabled?: boolean;
  source?: 'builtin';
  mods?: Record<string, Partial<ModDisplayOptions>>;
}

export const DEFAULT_MOD_DISPLAY: Readonly<ModDisplayOptions> = { character: true, battle: true, ground: true, damage: true, effects: true, idle: true };

function readRaw(): string | null {
  if (storageUnavailable) return fallbackRaw;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return fallbackRaw;
  }
}

function parseOverrides(raw: string | null): Overrides {
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Overrides = {};
    if (typeof value.enabled === 'boolean') result.enabled = value.enabled;
    if (value.source === 'builtin') result.source = 'builtin';
    const entries = Object.entries(value.mods ?? {});
    for (const [id, stored] of entries.slice(0, 64)) {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id) || !stored || typeof stored !== 'object') continue;
      const options: Partial<ModDisplayOptions> = {};
      const keys = Object.keys(DEFAULT_MOD_DISPLAY) as ModDisplayOption[];
      for (const key of keys) {
        const candidate = (stored as Partial<ModDisplayOptions>)[key];
        if (typeof candidate === 'boolean') options[key] = candidate;
      }
      result.mods = { ...result.mods, [id]: options };
    }
    return result;
  } catch {
    return {};
  }
}

function notify(): void {
  for (const listener of listeners) listener();
}

function onStorage(event: StorageEvent): void {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  storageUnavailable = false;
  fallbackRaw = event.newValue;
  notify();
}

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  const unsubscribe = () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
  return unsubscribe;
}

function writeOverrides(overrides: Overrides): void {
  const keys = Object.keys(overrides);
  const raw = keys.length ? JSON.stringify(overrides) : null;
  fallbackRaw = raw;
  try {
    if (raw === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, raw);
    storageUnavailable = false;
  } catch {
    storageUnavailable = true;
    // Decorative preferences remain usable when browser storage is unavailable.
  }
  notify();
}

export function setPersonalModsEnabled(enabled: boolean): void {
  const raw = readRaw();
  const overrides = parseOverrides(raw);
  if (enabled) delete overrides.enabled;
  else overrides.enabled = false;
  writeOverrides(overrides);
}

export function setModDisplayOption(id: string, option: ModDisplayOption, enabled: boolean): void {
  const raw = readRaw();
  const overrides = parseOverrides(raw);
  const options = { ...overrides.mods?.[id], [option]: enabled };
  // Store only deviations; resetting removes overrides instead of freezing defaults.
  if (enabled === DEFAULT_MOD_DISPLAY[option]) delete options[option];
  const keys = Object.keys(options);
  if (keys.length) overrides.mods = { ...overrides.mods, [id]: options };
  else delete overrides.mods?.[id];
  const modKeys = Object.keys(overrides.mods ?? {});
  if (!modKeys.length) delete overrides.mods;
  writeOverrides(overrides);
}

export function resetModDisplayOptions(id: string): void {
  const raw = readRaw();
  const overrides = parseOverrides(raw);
  delete overrides.mods?.[id];
  const keys = Object.keys(overrides.mods ?? {});
  if (!keys.length) delete overrides.mods;
  writeOverrides(overrides);
}

export function setCharacterSource(source: 'builtin' | 'imported'): void {
  const raw = readRaw();
  const overrides = parseOverrides(raw);
  if (source === 'builtin') overrides.source = source; else delete overrides.source;
  writeOverrides(overrides);
}

export function usePersonalModPreferences(id = 'cartethyia-battle') {
  const raw = useSyncExternalStore(subscribe, readRaw, readRaw);
  const overrides = parseOverrides(raw);
  const display = { ...DEFAULT_MOD_DISPLAY, ...overrides.mods?.[id] };
  return { enabled: overrides.enabled ?? true, display, source: overrides.source ?? 'imported' };
}
