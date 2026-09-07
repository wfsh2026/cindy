import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { BATTLE_ASSET_IDS, type PersonalModPackage } from '../../../shared/personalMod';
import { decodePersonalMod, InvalidPersonalModError } from '../package';
import { PersonalModService, parsePersonalModState, type PersonalModPorts, type PersonalModState } from '../service';

let packageBytes: Buffer;

beforeAll(async () => {
  const testPath = fileURLToPath(import.meta.url);
  const directory = path.dirname(testPath);
  const root = path.resolve(directory, '../../../../../../mods/cartethyia-battle');
  const manifestPath = path.join(root, 'manifest.json');
  const raw = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);
  const assets: PersonalModPackage['assets'] = {} as PersonalModPackage['assets'];
  for (const key of BATTLE_ASSET_IDS) {
    const assetPath = path.join(root, 'assets', manifest.assets[key]);
    const buffer = await readFile(assetPath);
    const hash = createHash('sha256');
    hash.update(buffer);
    const sha256 = hash.digest('hex');
    const base64 = buffer.toString('base64');
    assets[key] = { sha256, base64 };
  }
  const pack = { ...manifest, assets };
  const text = JSON.stringify(pack);
  packageBytes = Buffer.from(text);
});

function createHarness() {
  let state: PersonalModState = { version: 1, installed: null, pending: [] };
  const refs = new Map<string, number>();
  const control = { ingestFailAt: 0, calls: 0, releaseFails: false, current: true, failCommit: false };
  const assertCurrent = () => { if (!control.current) throw new Error('owner changed'); };
  const ports: PersonalModPorts = {
    assertCurrent,
    read: () => structuredClone(state),
    write: (next) => {
      assertCurrent();
      if (control.failCommit && next.installed?.revision !== state.installed?.revision) throw new Error('disk unavailable');
      state = structuredClone(next);
    },
    ingest: async (buffer, revision) => {
      control.calls += 1;
      const count = (refs.get(revision) ?? 0) + 1;
      refs.set(revision, count);
      if (control.ingestFailAt === control.calls) throw new Error('lost ingest acknowledgement');
      const hash = createHash('sha256');
      hash.update(buffer);
      const digest = hash.digest('hex');
      return `cindy-media://blobs/${digest}.png`;
    },
    release: async (revision) => {
      if (control.releaseFails) throw new Error('worker unavailable');
      refs.delete(revision);
    },
  };
  const service = new PersonalModService(ports);
  return { service, control, refs, state: () => state };
}

describe('personal Mod resource package', () => {
  it('decodes all independent package assets and installs, updates, then uninstalls', async () => {
    const harness = createHarness();
    const first = await harness.service.install(packageBytes);
    expect(first.version).toBe('1.0.0');
    const keys = Object.keys(first.assets);
    expect(keys).toHaveLength(15);
    const second = await harness.service.install(packageBytes);
    expect(second.revision).not.toBe(first.revision);
    const oldRef = harness.refs.has(first.revision);
    expect(oldRef).toBe(false);
    await harness.service.remove(second.revision);
    const result = await harness.service.get();
    expect(result).toBeNull();
    expect(harness.refs.size).toBe(0);
  });

  it('keeps the old revision after partial ingestion fails, recovers the durable journal on retry', async () => {
    const harness = createHarness();
    const first = await harness.service.install(packageBytes);
    harness.control.ingestFailAt = harness.control.calls + 2;
    harness.control.releaseFails = true;
    const update = harness.service.install(packageBytes);
    await expect(update).rejects.toThrow('lost ingest');
    const state = harness.state();
    expect(state.installed?.revision).toBe(first.revision);
    expect(state.pending).toHaveLength(1);
    harness.control.releaseFails = false;
    const recovered = await harness.service.get();
    expect(recovered?.revision).toBe(first.revision);
    expect(harness.refs.size).toBe(1);
    const recoveredState = harness.state();
    expect(recoveredState.pending).toHaveLength(0);
  });

  it('does not replace a working installation when committing metadata fails', async () => {
    const harness = createHarness();
    const first = await harness.service.install(packageBytes);
    harness.control.failCommit = true;
    const update = harness.service.install(packageBytes);
    await expect(update).rejects.toThrow('disk unavailable');
    const current = await harness.service.get();
    expect(current?.revision).toBe(first.revision);
    expect(harness.refs.size).toBe(1);
  });

  it('rejects stale uninstall requests and owner changes', async () => {
    const harness = createHarness();
    const first = await harness.service.install(packageBytes);
    const second = await harness.service.install(packageBytes);
    const removal = harness.service.remove(first.revision);
    await expect(removal).rejects.toThrow('Mod changed');
    harness.control.current = false;
    const changedOwner = harness.service.remove(second.revision);
    await expect(changedOwner).rejects.toThrow('owner changed');
    const state = harness.state();
    expect(state.installed?.revision).toBe(second.revision);
  });

  it('rejects changed bytes, unsupported templates, path assets, and executable fields before writing', async () => {
    const raw = packageBytes.toString('utf8');
    const base = JSON.parse(raw);
    const invalidPackages = [
      { ...base, template: 'unknown-template' },
      { ...base, script: 'alert(1)' },
      { ...base, assets: { ...base.assets, '../outside.png': base.assets.ground } },
      { ...base, assets: { ...base.assets, ground: { ...base.assets.ground, sha256: '0'.repeat(64) } } },
    ];
    for (const invalid of invalidPackages) {
      const text = JSON.stringify(invalid);
      const bytes = Buffer.from(text);
      const harness = createHarness();
      const result = harness.service.install(bytes);
      await expect(result).rejects.toBeInstanceOf(InvalidPersonalModError);
      expect(harness.control.calls).toBe(0);
    }
  });

  it('rejects valid PNGs with incompatible sprite dimensions', async () => {
    const raw = packageBytes.toString('utf8');
    const pack = JSON.parse(raw);
    pack.assets.heroAttack = pack.assets.ground;
    const text = JSON.stringify(pack);
    const bytes = Buffer.from(text);
    const result = decodePersonalMod(bytes);
    await expect(result).rejects.toBeInstanceOf(InvalidPersonalModError);
  });

  it('does not silently overwrite corrupt install state', () => {
    const read = () => parsePersonalModState('{"version":2}');
    expect(read).toThrow();
  });
});
