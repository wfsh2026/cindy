import type { AppearanceAssetKey } from './appearanceMod';
import { normalizeModIdentity, resolveModNames, type ModIdentity } from './modIdentity';

export const THEME_MOD_PARTS = ['appName', 'assistantName', 'avatar', 'home', 'loading', 'login', 'authorization', 'share', 'colors', 'projects'] as const;
export type ThemeModPart = typeof THEME_MOD_PARTS[number];
export type ThemeModParts = Partial<Record<ThemeModPart, boolean>>;
export interface ThemeModOptions { parts?: ThemeModParts; names?: ModIdentity }

export const THEME_ASSET_PART: Record<AppearanceAssetKey, ThemeModPart> = {
  icon: 'home', logo: 'home', wordmark: 'loading', loading: 'loading', avatar: 'avatar',
  loginHero: 'login', loginHero2x: 'login', loginWordmark: 'login', loginWordmark2x: 'login',
  statusSuccess: 'authorization', statusFailure: 'authorization', statusNeutral: 'authorization', shareCharacter: 'share',
};

export function normalizeThemeModOptions(raw: unknown): ThemeModOptions {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const input = raw as ThemeModOptions;
  const parts: ThemeModParts = {};
  for (const key of THEME_MOD_PARTS) { if (input.parts?.[key] === false) parts[key] = false; }
  const names = normalizeModIdentity(input.names);
  delete names.themeId;
  for (const key of ['appName', 'assistantName'] as const) { if (input.names?.[key] === '') names[key] = ''; }
  const result: ThemeModOptions = {};
  const partKeys = Object.keys(parts);
  const nameKeys = Object.keys(names);
  if (partKeys.length) result.parts = parts;
  if (nameKeys.length) result.names = names;
  return result;
}

export function themePartEnabled(options: ThemeModOptions | undefined, part: ThemeModPart): boolean {
  return options?.parts?.[part] !== false;
}

export function resolveThemeModNames(identity: ModIdentity, theme: Parameters<typeof resolveModNames>[1], options?: ThemeModOptions): ModIdentity {
  const effective = { ...identity };
  for (const key of ['appName', 'assistantName'] as const) {
    const value = options?.names?.[key];
    if (value === undefined) continue;
    delete effective.themeId;
    if (value) effective[key] = value; else delete effective[key];
  }
  const resolved = resolveModNames(effective, theme);
  if (!themePartEnabled(options, 'appName')) resolved.appName = undefined;
  if (!themePartEnabled(options, 'assistantName')) resolved.assistantName = undefined;
  return resolved;
}
