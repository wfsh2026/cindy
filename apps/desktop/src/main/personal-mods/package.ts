import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { BATTLE_ASSET_IDS, BATTLE_ASSET_SIZES, PERSONAL_MOD_MAX_BYTES } from '../../shared/personalMod';
import type { BattleAssetId, PersonalModPackage } from '../../shared/personalMod';

export class InvalidPersonalModError extends Error {
  constructor() { super('Invalid personal Mod package'); }
}

function requireValid(valid: boolean): asserts valid {
  if (!valid) throw new InvalidPersonalModError();
}

function hasOnlyKeys(value: object, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  if (keys.length !== expected.length) return false;
  const known = (key: string) => expected.includes(key);
  return keys.every(known);
}

export async function decodePersonalMod(bytes: Buffer): Promise<{ id: string; name?: string; version: string; assets: Record<BattleAssetId, Buffer> }> {
  requireValid(bytes.length > 0 && bytes.length <= PERSONAL_MOD_MAX_BYTES);
  let pack: PersonalModPackage;
  try {
    const raw = bytes.toString('utf8');
    pack = JSON.parse(raw);
  } catch { throw new InvalidPersonalModError(); }
  requireValid(!!pack && typeof pack === 'object');
  const keys = ['format', 'schemaVersion', 'template', 'id', 'version', 'assets'];
  if (pack.name !== undefined) keys.push('name');
  const exactKeys = hasOnlyKeys(pack, keys);
  requireValid(exactKeys);
  requireValid(pack.format === 'cindy-personal-mod' && pack.schemaVersion === 1 && pack.template === 'composer-battle-v1');
  requireValid(typeof pack.id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(pack.id));
  if (pack.name !== undefined) requireValid(typeof pack.name === 'string' && pack.name.trim().length > 0 && pack.name.length <= 80);
  requireValid(typeof pack.version === 'string' && /^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(pack.version));
  requireValid(!!pack.assets && typeof pack.assets === 'object');
  const exactAssets = hasOnlyKeys(pack.assets, BATTLE_ASSET_IDS);
  requireValid(exactAssets);
  const assets = {} as Record<BattleAssetId, Buffer>;
  for (const key of BATTLE_ASSET_IDS) {
    const asset = pack.assets[key];
    requireValid(!!asset && typeof asset === 'object');
    const exactAssetKeys = hasOnlyKeys(asset, ['sha256', 'base64']);
    requireValid(exactAssetKeys);
    requireValid(typeof asset.sha256 === 'string' && /^[a-f0-9]{64}$/.test(asset.sha256));
    requireValid(typeof asset.base64 === 'string' && asset.base64.length <= 3 * 1024 * 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(asset.base64));
    const buffer = Buffer.from(asset.base64, 'base64');
    const canonical = buffer.toString('base64');
    requireValid(canonical === asset.base64);
    const hash = createHash('sha256');
    hash.update(buffer);
    const digest = hash.digest('hex');
    requireValid(digest === asset.sha256);
    const signature = buffer.subarray(0, 8);
    const signatureHex = signature.toString('hex');
    requireValid(signatureHex === '89504e470d0a1a0a');
    try {
      const image = sharp(buffer, { limitInputPixels: 2_000_000, failOn: 'warning' });
      const metadata = await image.metadata();
      const [width, height] = BATTLE_ASSET_SIZES[key];
      requireValid(metadata.format === 'png' && metadata.width === width && metadata.height === height && (metadata.pages ?? 1) === 1);
      // Decode and re-encode: validate every pixel and discard non-image metadata.
      const png = image.png();
      assets[key] = await png.toBuffer();
    } catch { throw new InvalidPersonalModError(); }
  }
  return { id: pack.id, ...(pack.name ? { name: pack.name } : {}), version: pack.version, assets };
}
