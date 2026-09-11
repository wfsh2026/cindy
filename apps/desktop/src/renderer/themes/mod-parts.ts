import { APPEARANCE_ASSET_KEYS } from '../../shared/appearanceMod';
import { THEME_ASSET_PART, THEME_MOD_PARTS, themePartEnabled, type ThemeModOptions, type ThemeModPart } from '../../shared/themeModParts';
import type { Theme } from './types';
import { cindyLight } from './builtin/cindy-light';
import { cindyDark } from './builtin/cindy-dark';

export function availableThemeParts(themes: readonly (Theme | null)[]): ThemeModPart[] {
  const available = new Set<ThemeModPart>();
  for (const theme of themes) {
    if (!theme) continue;
    if (theme.mod?.appDisplayName) available.add('appName');
    if (theme.mod?.assistantName) available.add('assistantName');
    for (const key of APPEARANCE_ASSET_KEYS) { if (theme.brand?.[key]) available.add(THEME_ASSET_PART[key]); }
    if (theme.mod && (theme.brand?.wordmark || theme.brand?.logo)) available.add('share');
    const colors = Object.keys(theme.colors);
    if (colors.length) available.add('colors');
    if (colors.some(key => key.startsWith('sidebar-project-'))) available.add('projects');
  }
  return THEME_MOD_PARTS.filter(part => available.has(part));
}

export function applyThemeModParts(theme: Theme, options: ThemeModOptions): Theme {
  const base = theme.type === 'dark' ? cindyDark : cindyLight;
  const palette = themePartEnabled(options, 'colors');
  const projects = themePartEnabled(options, 'projects');
  const colors = { ...(palette ? theme.colors : base.colors) };
  const themeKeys = Object.keys(theme.colors);
  const baseKeys = Object.keys(base.colors);
  const projectKeys = new Set([...themeKeys, ...baseKeys]);
  for (const key of projectKeys) {
    if (!key.startsWith('sidebar-project-')) continue;
    const value = projects ? theme.colors[key] : base.colors[key];
    if (value !== undefined) colors[key] = value; else delete colors[key];
  }
  const brand: NonNullable<Theme['brand']> = {};
  for (const key of APPEARANCE_ASSET_KEYS) {
    const part = THEME_ASSET_PART[key];
    const value = themePartEnabled(options, part) ? theme.brand?.[key] : base.brand?.[key];
    if (value) brand[key] = value;
  }
  const mod = theme.mod ? { ...theme.mod } : undefined;
  if (mod) {
    mod.appDisplayName = themePartEnabled(options, 'appName') ? options.names?.appName || mod.appDisplayName : undefined;
    mod.assistantName = themePartEnabled(options, 'assistantName') ? options.names?.assistantName || mod.assistantName : undefined;
  }
  return { ...theme, colors, brand, mod, modOptions: options, modSourceBrand: theme.brand };
}
