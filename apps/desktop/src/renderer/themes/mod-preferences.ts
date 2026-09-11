import { useSyncExternalStore } from 'react';
import { normalizeThemeModOptions, type ThemeModOptions, type ThemeModPart } from '../../shared/themeModParts';

const KEY = 'cindy.themeModOptions.v1';
const listeners = new Set<() => void>();
let fallback: string | null = null;

function read(): string | null { try { return localStorage.getItem(KEY); } catch { return fallback; } }
function parse(raw: string | null): Record<string, ThemeModOptions> {
  try {
    const input = raw ? JSON.parse(raw) : {};
    const entries = Object.entries(input);
    const result: Record<string, ThemeModOptions> = Object.create(null);
    for (const [id, value] of entries.slice(0, 128)) {
      if (id.length > 256 || id === '__proto__' || id === 'constructor') continue;
      result[id] = normalizeThemeModOptions(value);
    }
    return result;
  } catch { return {}; }
}
function notify(): void { for (const listener of listeners) listener(); }
function onStorage(event: StorageEvent): void { if (event.key === KEY || event.key === null) notify(); }
export function subscribeThemeModOptions(listener: () => void): () => void {
  if (!listeners.size) window.addEventListener('storage', onStorage);
  listeners.add(listener);
  return () => { listeners.delete(listener); if (!listeners.size) window.removeEventListener('storage', onStorage); };
}
export function getThemeModOptions(id: string): ThemeModOptions { const raw = read(); const all = parse(raw); return all[id] ?? {}; }
export function useThemeModOptions(id: string): ThemeModOptions { const raw = useSyncExternalStore(subscribeThemeModOptions, read, read); const all = parse(raw); return all[id] ?? {}; }
function write(id: string, value: ThemeModOptions): void {
  const raw = read();
  const all = parse(raw);
  const next = normalizeThemeModOptions(value);
  const keys = Object.keys(next);
  if (keys.length) all[id] = next; else delete all[id];
  fallback = JSON.stringify(all);
  try { localStorage.setItem(KEY, fallback); } catch { /* Keep this window usable. */ }
  notify();
}
export function setThemeModPart(id: string, part: ThemeModPart, enabled: boolean): void {
  const old = getThemeModOptions(id);
  const parts = { ...old.parts, [part]: enabled };
  const next = { ...old, parts };
  write(id, next);
}
export function setThemeModName(id: string, field: 'appName' | 'assistantName', value: string): void {
  const old = getThemeModOptions(id);
  const trimmed = value.trim();
  const names = { ...old.names, [field]: trimmed };
  const next = { ...old, names };
  write(id, next);
}
export function resetThemeModParts(id: string): void {
  const old = getThemeModOptions(id);
  const next = { names: old.names };
  write(id, next);
}
