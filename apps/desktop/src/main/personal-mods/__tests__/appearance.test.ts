import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeAppearanceAsset, readActiveAppearance, writeAppearanceSelection } from '../appearance';
import { personalizedHostPrompt, readModIdentity, resolvedModIdentity, writeModIdentity } from '../identity';

const scope = vi.hoisted(() => ({ root: '' }));
vi.mock('electron', () => ({ app: { getPath: () => scope.root, getAppPath: () => path.join(scope.root, 'apps', 'desktop'), isPackaged: false }, nativeImage: {
  createFromBuffer: (bytes: Buffer) => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }), toDataURL: () => `data:image/png;base64,${bytes.toString('base64')}` }),
} }));
vi.mock('../../local-themes/loader', () => ({ getLocalThemesDir: () => path.join(scope.root, 'themes') }));
vi.mock('../../appSessionState', () => ({ getActiveAppSession: () => ({ dataOwnerId: 'owner' }), dataOwnerStorageKey: () => 'owner' }));

beforeEach(() => {
  const prefix = path.join(os.tmpdir(), 'cindy-appearance-selection-');
  scope.root = fs.mkdtempSync(prefix);
  const source = path.join(scope.root, 'mods', 'cartethyia-theme');
  fs.mkdirSync(source, { recursive: true });
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jY0kAAAAASUVORK5CYII=', 'base64');
  const imageFile = path.join(source, 'status.png');
  fs.writeFileSync(imageFile, image);
  const manifest = { format: 'cindy-personal-mod', schemaVersion: 2, category: 'theme', template: 'appearance-v1', baseFamily: 'cindy', id: 'cartethyia-theme', name: 'Cartethyia', version: '1.0.0', identity: { appDisplayName: 'Cartethyia', assistantName: '卡提西亚' }, assets: { light: { statusSuccess: 'status.png' }, dark: { statusSuccess: 'status.png' } } };
  const file = path.join(source, 'manifest.json');
  const raw = JSON.stringify(manifest);
  fs.writeFileSync(file, raw);
});
afterEach(() => fs.rmSync(scope.root, { recursive: true, force: true }));

describe('appearance Mod activation and official fallback', () => {
  it('honors individual switches in Main-side artwork and AI naming', () => {
    const options = { parts: { authorization: false, assistantName: false }, names: { appName: '我的界面' } };
    const selection = { familyId: 'cartethyia', type: 'dark', options };
    writeAppearanceSelection(selection);
    const artwork = activeAppearanceAsset('statusSuccess');
    expect(artwork).toBeUndefined();
    const identity = resolvedModIdentity();
    expect(identity.appName).toBe('我的界面');
    expect(identity.assistantName).toBeUndefined();
    const restore = { familyId: 'cartethyia', type: 'dark', options: {} };
    writeAppearanceSelection(restore);
    const restored = activeAppearanceAsset('statusSuccess');
    expect(restored).toMatch(/^data:image\/png;base64,/);
  });
  it('drops theme-derived names, artwork and AI instructions when the theme is disabled', () => {
    const follow = { themeId: 'cartethyia-theme' };
    writeModIdentity(follow);
    const selected = resolvedModIdentity();
    expect(selected).toMatchObject({ appName: 'Cartethyia', assistantName: '卡提西亚' });
    const artwork = activeAppearanceAsset('statusSuccess');
    expect(artwork).toMatch(/^data:image\/png;base64,/);
    const selection = { familyId: 'cindy', type: 'dark' };
    writeAppearanceSelection(selection);
    const base = resolvedModIdentity();
    expect(base.appName).toBeUndefined();
    expect(base.assistantName).toBeUndefined();
    const original = activeAppearanceAsset('statusSuccess');
    expect(original).toBeUndefined();
    const prompt = personalizedHostPrompt('You are Cindy.');
    expect(prompt).toBe('You are Cindy.');
    const preferences = readModIdentity();
    expect(preferences).toEqual(follow);
  });

  it('preserves independently authored names when changing themes', () => {
    const names = { appName: '我的助手', assistantName: '小青' };
    writeModIdentity(names);
    const selection = { familyId: 'cindy', type: 'light' };
    writeAppearanceSelection(selection);
    const retained = resolvedModIdentity();
    expect(retained).toEqual(names);
  });

  it('validates selection without accepting arbitrary source paths and fails back after a source disappears', () => {
    const invalid = () => writeAppearanceSelection({ familyId: '../private', type: 'dark' });
    expect(invalid).toThrow('Invalid theme selection');
    const selection = { familyId: 'missing-pack-local', type: 'light' };
    writeAppearanceSelection(selection);
    const missing = readActiveAppearance();
    expect(missing).toBeNull();
  });
});
