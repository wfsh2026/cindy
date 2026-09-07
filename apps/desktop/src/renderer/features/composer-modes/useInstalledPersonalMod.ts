import { useSyncExternalStore } from 'react';
import { isInstalledPersonalMod, type InstalledPersonalMod, type PersonalModResult } from '../../../shared/personalMod';

interface CatalogState { mod: InstalledPersonalMod | null; loading: boolean; error: boolean }
let state: CatalogState = { mod: null, loading: true, error: false };
let generation = 0;
const listeners = new Set<() => void>();
let unsubscribeHost: (() => void) | undefined;

function publish(next: CatalogState): void {
  state = next;
  for (const listener of listeners) listener();
}

function getSnapshot(): CatalogState { return state; }

export function applyPersonalModResult(result: PersonalModResult): boolean {
  if (!result.ok || result.canceled) return false;
  if (result.mod !== null && !isInstalledPersonalMod(result.mod)) return false;
  generation += 1;
  publish({ mod: result.mod, loading: false, error: false });
  return true;
}

export async function refreshPersonalMod(): Promise<void> {
  const requestedGeneration = ++generation;
  const api = window.electronAPI?.personalMods;
  if (!api) {
    publish({ mod: null, loading: false, error: true });
    return;
  }
  try {
    const result = await api.get();
    if (requestedGeneration !== generation) return;
    if (!applyPersonalModResult(result)) publish({ mod: null, loading: false, error: true });
  } catch {
    if (requestedGeneration === generation) publish({ mod: null, loading: false, error: true });
  }
}

function invalidate(): void {
  // Clear before requesting the new owner's catalog; stale in-flight reads are discarded.
  publish({ mod: null, loading: true, error: false });
  void refreshPersonalMod();
}

function onFocus(): void { void refreshPersonalMod(); }

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    unsubscribeHost = window.electronAPI?.personalMods?.onChanged(invalidate);
    window.addEventListener('focus', onFocus);
    void refreshPersonalMod();
  }
  const unsubscribe = () => {
    listeners.delete(listener);
    if (listeners.size !== 0) return;
    unsubscribeHost?.();
    unsubscribeHost = undefined;
    window.removeEventListener('focus', onFocus);
    generation += 1;
    state = { mod: null, loading: true, error: false };
  };
  return unsubscribe;
}

export function useInstalledPersonalMod(): CatalogState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
