import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadAppearancePacks } from '../appearancePacks';

vi.mock('electron', () => ({ nativeImage: { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 32, height: 32 }), toDataURL: () => 'data:image/png;base64,fixture' }) } }));
let root: string;
let folder: string;
let manifest: Record<string, unknown>;
function save() { const file = path.join(folder, 'manifest.json'); const raw = JSON.stringify(manifest); fs.writeFileSync(file, raw); }
beforeEach(() => {
  const prefix = path.join(os.tmpdir(), 'cindy-appearance-pack-');
  root = fs.mkdtempSync(prefix);
  folder = path.join(root, 'packs', 'sample');
  fs.mkdirSync(folder, { recursive: true });
  manifest = { format: 'cindy-personal-mod', schemaVersion: 2, category: 'theme', template: 'appearance-v1', baseFamily: 'cindy', id: 'sample', name: '示例', version: '1.0.0', identity: { appDisplayName: '示例助手' } };
  save();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('appearance Mod source loading', () => {
  it('loads both modes with optional colors and keeps identity as data', () => {
    const result = loadAppearancePacks(root);
    expect(result.diagnostics).toEqual([]);
    expect(result.themes).toHaveLength(2);
    expect(result.themes[0]).toMatchObject({ type: 'light', colors: {}, mod: { id: 'sample', appDisplayName: '示例助手', source: 'directory' } });
    expect(result.themes[1].type).toBe('dark');
  });

  it('keeps the last working revision after a partial edit and recovers on refresh', () => {
    const previous = loadAppearancePacks(root);
    const file = path.join(folder, 'manifest.json');
    fs.writeFileSync(file, '{');
    const broken = loadAppearancePacks(root);
    expect(broken.themes).toEqual(previous.themes);
    expect(broken.diagnostics).toHaveLength(1);
    manifest.name = '新名称';
    save();
    const updated = loadAppearancePacks(root);
    expect(updated.themes[0].name).toBe('新名称');
    expect(updated.diagnostics).toEqual([]);
  });

  it('rejects resource traversal, CSS injection and unsupported templates', () => {
    manifest.colors = { dark: '../outside.json' };
    save();
    const traversal = loadAppearancePacks(root);
    expect(traversal.themes).toEqual([]);
    const file = path.join(folder, 'colors.json');
    fs.writeFileSync(file, '{"surface":"red;}body{display:none"}');
    manifest.colors = { dark: 'colors.json' };
    save();
    const injection = loadAppearancePacks(root);
    expect(injection.themes).toEqual([]);
    manifest.template = 'execute-script';
    save();
    const unsupported = loadAppearancePacks(root);
    expect(unsupported.themes).toEqual([]);
  });

  it('does not let identity fields overwrite directory ownership metadata', () => {
    manifest.identity = { id: 'other', source: 'builtin', directory: '../outside', appDisplayName: '小卡' };
    save();
    const result = loadAppearancePacks(root);
    expect(result.themes[0].mod).toMatchObject({ id: 'sample', source: 'directory', directory: 'sample' });
  });
});
