import { useSyncExternalStore } from 'react';
import { normalizeModIdentity, type ModIdentity } from '../../../shared/modIdentity';
import { themeService } from '@/themes/theme-service';
import { BRAND_NAME } from '@cindy/maker-shared/branding';
import { resolveThemeModNames } from '../../../shared/themeModParts';

let identity: ModIdentity = {};
let generation = 0;
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | undefined;

function publish(value: ModIdentity): void {
  identity = value;
  for (const listener of listeners) listener();
}

async function refresh(): Promise<void> {
  const requested = ++generation;
  try {
    const raw = await window.electronAPI?.personalMods?.getIdentity?.();
    if (requested === generation) publish(normalizeModIdentity(raw));
  } catch { if (requested === generation) publish({}); }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    const changed = () => { publish({}); void refresh(); };
    unsubscribe = window.electronAPI?.personalMods?.onChanged(changed);
    void refresh();
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) { unsubscribe?.(); unsubscribe = undefined; generation += 1; identity = {}; }
  };
}

function snapshot(): ModIdentity { return identity; }
export function useModIdentity(): ModIdentity { return useSyncExternalStore(subscribe, snapshot, snapshot); }

export async function saveModIdentity(value: ModIdentity): Promise<void> {
  const api = window.electronAPI?.personalMods;
  if (!api?.setIdentity) throw new Error('Identity settings unavailable');
  await api.setIdentity(value);
  await refresh();
}

function subscribeTheme(listener: () => void): () => void { return themeService.onDidChangeTheme(listener); }
function currentTheme() { return themeService.getCurrentTheme(); }

export function useModPresentation() {
  const names = useModIdentity();
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, currentTheme);
  const resolved = resolveThemeModNames(names, theme?.mod, theme?.modOptions);
  return { appName: resolved.appName ?? BRAND_NAME, assistantName: resolved.assistantName ?? BRAND_NAME, avatar: theme?.brand?.avatar?.src };
}
