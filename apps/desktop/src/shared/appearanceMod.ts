export const APPEARANCE_ASSET_KEYS = ['icon', 'logo', 'wordmark', 'avatar', 'loading', 'loginHero', 'loginHero2x', 'loginWordmark', 'loginWordmark2x', 'statusSuccess', 'statusFailure', 'statusNeutral', 'shareCharacter'] as const;
export type AppearanceAssetKey = typeof APPEARANCE_ASSET_KEYS[number];
import type { ThemeModOptions } from './themeModParts';
export interface AppearanceSelection { familyId: string; type: 'light' | 'dark'; options?: ThemeModOptions }
export interface AppearanceModMetadata {
  id: string;
  version: string;
  source: 'builtin' | 'directory';
  directory?: string;
  appDisplayName?: string;
  assistantName?: string;
}
export interface AppearanceModVariant {
  colors: Record<string, string>;
  assets: Partial<Record<AppearanceAssetKey, string>>;
}
export interface AppearanceModManifest {
  format: 'cindy-personal-mod';
  schemaVersion: 2;
  category: 'theme';
  template: 'appearance-v1';
  id: string;
  name: string;
  version: string;
  baseFamily: 'cindy';
  identity?: { appDisplayName?: string; assistantName?: string };
  colors?: { light?: string; dark?: string };
  assets?: { light?: Partial<Record<AppearanceAssetKey, string>>; dark?: Partial<Record<AppearanceAssetKey, string>> };
}
