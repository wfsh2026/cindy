import { BATTLE_ASSET_IDS, type InstalledPersonalMod } from '../../../../shared/personalMod';

const assets = {} as InstalledPersonalMod['assets'];
for (const [index, key] of BATTLE_ASSET_IDS.entries()) {
  const number = index.toString(16);
  const hash = number.padStart(64, '0');
  assets[key] = `cindy-media://blobs/${hash}.png`;
}
export const installedModFixture: InstalledPersonalMod = {
  id: 'cartethyia-battle', version: '1.0.0', revision: '11111111-1111-4111-8111-111111111111', assets,
};
