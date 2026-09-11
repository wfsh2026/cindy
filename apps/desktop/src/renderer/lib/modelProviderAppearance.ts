import { useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';

import { themeService } from '@/themes/theme-service';

const PROVIDER_COLOR_TOKENS: Readonly<Record<string, string>> = {
  xd: 'model-provider-xd',
  openai: 'model-provider-openai',
  anthropic: 'model-provider-anthropic',
  google: 'model-provider-google',
  gemini: 'model-provider-google',
  'google-gemini-api': 'model-provider-google',
};

/** Bind identity to the actual provider ID, never its models, display name or harness. */
export function modelProviderColor(providerId: string): string {
  const knownProvider = Object.hasOwn(PROVIDER_COLOR_TOKENS, providerId);
  const token = knownProvider ? PROVIDER_COLOR_TOKENS[providerId] : undefined;
  if (token) return `var(--${token})`;
  let hash = 2166136261;
  for (const character of providerId) {
    const code = character.codePointAt(0) ?? 0;
    const mixed = hash ^ code;
    hash = Math.imul(mixed, 16777619) >>> 0;
  }
  // Stable theme-derived tints survive renames, filtering and restarts without storing UI data.
  const slot = hash % 6 + 1;
  const nextSlot = slot % 6 + 1;
  const weight = 65 + ((hash >>> 8) % 31000) / 1000;
  return `color-mix(in srgb, var(--model-provider-custom-${slot}) ${weight}%, var(--model-provider-custom-${nextSlot}))`;
}

export function modelProviderStyle(providerId: string): CSSProperties {
  const color = modelProviderColor(providerId);
  return { '--model-provider-color': color } as CSSProperties;
}

function subscribePalette(listener: () => void): () => void {
  return themeService.onDidChangeTheme(listener);
}

function hasProviderPalette(): boolean {
  const color = themeService.getColor('model-provider-xd');
  return color !== null;
}

/** Only themes that opt into provider colors change; disabling the Mod palette restores Core. */
export function useModelProviderColors(): boolean {
  return useSyncExternalStore(subscribePalette, hasProviderPalette, hasProviderPalette);
}
