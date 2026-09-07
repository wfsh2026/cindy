/** Resource-only format. The versioned template owns movement, timing and rendering. */
export const PERSONAL_MOD_ID = 'cartethyia-battle' as const;
export const PERSONAL_MOD_MAX_BYTES = 16 * 1024 * 1024;
export const PERSONAL_MOD_IPC = { get: 'personal-mod:get', import: 'personal-mod:import', remove: 'personal-mod:remove', changed: 'personal-mod:changed' } as const;

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
  id: typeof PERSONAL_MOD_ID;
  version: string;
  assets: Record<BattleAssetId, { sha256: string; base64: string }>;
}

export interface InstalledPersonalMod {
  id: typeof PERSONAL_MOD_ID;
  version: string;
  revision: string;
  assets: Record<BattleAssetId, string>;
}

export type PersonalModResult = { ok: true; mod: InstalledPersonalMod | null; canceled?: boolean }
  | { ok: false; error: 'invalid-package' | 'unavailable' | 'failed' };

export interface PersonalModApi {
  get(): Promise<PersonalModResult>;
  import(): Promise<PersonalModResult>;
  remove(revision: string): Promise<PersonalModResult>;
  onChanged(listener: () => void): () => void;
}

export function isInstalledPersonalMod(value: unknown): value is InstalledPersonalMod {
  if (!value || typeof value !== 'object') return false;
  const mod = value as InstalledPersonalMod;
  if (mod.id !== PERSONAL_MOD_ID || typeof mod.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(mod.version)) return false;
  if (typeof mod.revision !== 'string' || !/^[a-f0-9-]{36}$/.test(mod.revision)) return false;
  if (!mod.assets || typeof mod.assets !== 'object') return false;
  for (const key of BATTLE_ASSET_IDS) {
    const url = mod.assets[key];
    if (typeof url !== 'string' || !/^cindy-media:\/\/blobs\/[a-f0-9]{64}\.png$/.test(url)) return false;
  }
  return true;
}
