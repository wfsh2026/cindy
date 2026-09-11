import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createModExample, manageModDirectory, readBattleDirectory } from '../directories';
import { decodePersonalMod } from '../package';

let root: string;
beforeEach(async () => { const prefix = path.join(os.tmpdir(), 'cindy-mod-directory-'); root = await fs.mkdtemp(prefix); });
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

describe('editable Mod examples', () => {
  it('copies the bundled source into an independent, loadable custom battle', async () => {
    const source = path.resolve(__dirname, '../../../../../../mods/cartethyia-battle');
    const request = { source, destination: root, name: 'cartethyia-battle' };
    const folder = await createModExample(request);
    const bytes = await readBattleDirectory(folder);
    const decoded = await decodePersonalMod(bytes);
    expect(decoded.id).toMatch(/^cartethyia-battle-copy-/);
    expect(decoded.name).toContain('卡提西亚战斗');
    const keys = Object.keys(decoded.assets);
    expect(keys).toHaveLength(15);
  });

  it('uninstalls without losing source files and restores the same directory', async () => {
    const folder = path.join(root, 'sample');
    await fs.mkdir(folder);
    const file = path.join(folder, 'manifest.json');
    await fs.writeFile(file, 'original source');
    const removal = { action: 'uninstall' as const, directory: 'sample' };
    const removed = await manageModDirectory(root, removal);
    const retained = path.join(removed, 'manifest.json');
    const bytes = await fs.readFile(retained, 'utf8');
    expect(bytes).toBe('original source');
    const restore = { action: 'restore' as const, directory: 'sample' };
    const restored = await manageModDirectory(root, restore);
    const realFolder = await fs.realpath(folder);
    expect(restored).toBe(realFolder);
  });

  it('rejects parent paths and refuses to overwrite another disabled source directory', async () => {
    const invalid = { action: 'uninstall' as const, directory: '../outside' };
    const invalidResult = manageModDirectory(root, invalid);
    await expect(invalidResult).rejects.toThrow('Invalid Mod directory');
    const folder = path.join(root, 'sample');
    const disabled = path.join(root, '.disabled', 'sample');
    await fs.mkdir(folder);
    await fs.mkdir(disabled, { recursive: true });
    const removal = { action: 'uninstall' as const, directory: 'sample' };
    const result = manageModDirectory(root, removal);
    await expect(result).rejects.toThrow('Destination already exists');
    const retained = await fs.stat(folder);
    const isDirectory = retained.isDirectory();
    expect(isDirectory).toBe(true);
  });
});
