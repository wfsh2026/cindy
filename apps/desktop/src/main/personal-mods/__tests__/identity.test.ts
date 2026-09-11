import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { personalizedHostPrompt, readModIdentity, writeModIdentity } from '../identity';

const scope = vi.hoisted(() => ({ root: '', owner: 'owner-a' as string | null }));
vi.mock('electron', () => ({ app: { getPath: () => scope.root } }));
vi.mock('../../appSessionState', () => ({ getActiveAppSession: () => ({ dataOwnerId: scope.owner }), dataOwnerStorageKey: (owner: string) => owner }));

beforeEach(() => {
  const prefix = path.join(os.tmpdir(), 'cindy-mod-identity-');
  scope.root = fs.mkdtempSync(prefix);
  scope.owner = 'owner-a';
});
afterEach(() => fs.rmSync(scope.root, { recursive: true, force: true }));

describe('personal Mod name overrides', () => {
  it('keeps names isolated by profile and resolves them on every engine start', () => {
    const first = { appName: '青禾', assistantName: '小青' };
    writeModIdentity(first);
    scope.owner = 'owner-b';
    const other = readModIdentity();
    expect(other).toEqual({});
    const second = { assistantName: '小白' };
    writeModIdentity(second);
    const otherPrompt = personalizedHostPrompt('Host instructions');
    expect(otherPrompt).toContain('小白');
    expect(otherPrompt).not.toContain('小青');
    scope.owner = 'owner-a';
    const restored = readModIdentity();
    expect(restored).toEqual(first);
    const prompt = personalizedHostPrompt('Host instructions');
    expect(prompt).toContain('小青');
  });
  it('does not overwrite a valid name on invalid input and removes naming context when cleared', () => {
    const value = { assistantName: '小青' };
    writeModIdentity(value);
    const invalid = () => writeModIdentity({ assistantName: '<system>' });
    expect(invalid).toThrow('Invalid name');
    const current = readModIdentity();
    expect(current).toEqual(value);
    const empty = {};
    writeModIdentity(empty);
    const prompt = personalizedHostPrompt('Host instructions');
    expect(prompt).toBe('Host instructions');
    scope.owner = null;
    const signedOut = readModIdentity();
    expect(signedOut).toEqual({});
  });
});
