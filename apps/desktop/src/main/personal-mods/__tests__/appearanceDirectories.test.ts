import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyAppearanceDirectory } from '../appearanceDirectories';

let root: string;
let source: string;
let destination: string;
beforeEach(async () => {
  const prefix = path.join(os.tmpdir(), 'cindy-theme-copy-');
  root = await fs.mkdtemp(prefix);
  source = path.join(root, 'source'); destination = path.join(root, 'destination');
  await fs.mkdir(source);
});
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
async function writeManifest(overrides: Record<string, unknown> = {}) {
  const manifest = { format: 'cindy-personal-mod', schemaVersion: 2, category: 'theme', template: 'appearance-v1', baseFamily: 'cindy', id: 'sample', name: '示例', version: '1.0.0', ...overrides };
  const raw = JSON.stringify(manifest); const file = path.join(source, 'manifest.json'); await fs.writeFile(file, raw);
}

describe('theme directory import and copying', () => {
  it('copies a valid package under a distinct id without changing the source', async () => {
    await writeManifest();
    const first = await copyAppearanceDirectory(source, destination);
    const second = await copyAppearanceDirectory(source, destination);
    expect(first).not.toBe(second);
    const file = path.join(first, 'manifest.json'); const raw = await fs.readFile(file, 'utf8'); const manifest = JSON.parse(raw);
    expect(manifest.id).toMatch(/^theme-sample-/);
    const original = path.join(source, 'manifest.json'); const originalRaw = await fs.readFile(original, 'utf8');
    expect(originalRaw).toContain('"id":"sample"');
  });
  it('does not walk or copy undeclared files from a supplied directory', async () => {
    const privateFile = path.join(source, 'private.txt'); await fs.writeFile(privateFile, 'not a theme resource');
    const overrides = { assets: { light: { unknownFutureSlot: '../source/private.txt' } } }; await writeManifest(overrides);
    const copied = await copyAppearanceDirectory(source, destination);
    const files = await fs.readdir(copied);
    expect(files).toEqual(['manifest.json']);
    const entries = await fs.readdir(destination);
    expect(entries).toHaveLength(1);
  });
  it('rejects a known resource with a parent path before publishing a copy', async () => {
    const overrides = { colors: { dark: '../outside.json' } }; await writeManifest(overrides);
    const result = copyAppearanceDirectory(source, destination);
    await expect(result).rejects.toThrow('Invalid resource path');
  });
});
