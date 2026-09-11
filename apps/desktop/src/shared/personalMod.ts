/** Resource-only format. The versioned template owns movement, timing and rendering. */
import type { ModIdentity } from './modIdentity';
import type { AppearanceSelection } from './appearanceMod';
export const PERSONAL_MOD_ID = 'cartethyia-battle' as const;
export const PERSONAL_MOD_MAX_BYTES = 16 * 1024 * 1024;
export const PERSONAL_MOD_IPC = { get: 'personal-mod:get', import: 'personal-mod:import', remove: 'personal-mod:remove', changed: 'personal-mod:changed', example: 'personal-mod:example', directory: 'personal-mod:directory', importDirectory: 'personal-mod:import-directory' } as const;

export const BATTLE_ASSET_SIZES = {
  ground: [2168, 185],
  heroIdle: [960, 160], heroMove: [1440, 160], heroAttack: [1440, 160],
  heroSkill: [720, 160], heroHit: [720, 160], heroVictory: [1200, 160], heroSleep: [1440, 160],
  monsterIdle: [960, 160], monsterHit: [720, 160], monsterDeath: [960, 160],
  arc: [960, 160], energy: [960, 160], impact: [720, 160], shard: [960, 160],
} as const;
export type BattleAssetId = keyof typeof BATTLE_ASSET_SIZES;
export const BATTLE_ASSET_IDS = Object.keys(BATTLE_ASSET_SIZES) as BattleAssetId[];

export interface PersonalModPackage {
  format: 'cindy-personal-mod';
  schemaVersion: 1;
  template: 'composer-battle-v1';
  id: string;
  name?: string;
  version: string;
  assets: Record<BattleAssetId, { sha256: string; base64: string }>;
}

export interface InstalledPersonalMod {
  id: string;
  name?: string;
  version: string;
  revision: string;
  assets: Record<BattleAssetId, string>;
}

export type PersonalModResult = { ok: true; mod: InstalledPersonalMod | null; canceled?: boolean }
  | { ok: false; error: 'invalid-package' | 'unavailable' | 'failed' };

export interface PersonalModApi {
  setAppearanceSelection?(selection: AppearanceSelection): Promise<void>;
  getIdentity?(): Promise<ModIdentity>;
  setIdentity?(identity: ModIdentity): Promise<ModIdentity>;
  get(): Promise<PersonalModResult>;
  import(): Promise<PersonalModResult>;
  remove(revision: string): Promise<PersonalModResult>;
  onChanged(listener: () => void): () => void;
  exportExample?(kind: 'theme' | 'battle'): Promise<ModDirectoryResult>;
  manageDirectory?(request: { action: 'open' | 'uninstall' | 'restore' | 'copy'; directory: string }): Promise<ModDirectoryResult>;
  importThemeDirectory?(): Promise<ModDirectoryResult>;
  importDirectory?(): Promise<PersonalModResult>;
}

export type ModDirectoryResult = { success: true; path: string; canceled?: boolean } | { success: false; error: string };

export function isInstalledPersonalMod(value: unknown): value is InstalledPersonalMod {
  if (!value || typeof value !== 'object') return false;
  const mod = value as InstalledPersonalMod;
  if (typeof mod.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(mod.id) || typeof mod.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(mod.version)) return false;
  if (mod.name !== undefined && (typeof mod.name !== 'string' || !mod.name.trim() || mod.name.length > 80)) return false;
  if (typeof mod.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(mod.revision)) return false;
  if (!mod.assets || typeof mod.assets !== 'object') return false;
  for (const key of BATTLE_ASSET_IDS) {
    const url = mod.assets[key];
    if (typeof url !== 'string' || !/^cindy-media:\/\/blobs\/[a-f0-9]{64}\.png$/.test(url)) return false;
  }
  return true;
}
