// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useInstalledPersonalMod } from '../useInstalledPersonalMod';
import { useComposerModePreference, __resetComposerModePreferenceForTest } from '../useComposerModePreference';
import { installedModFixture } from './personalModFixture';
import type { PersonalModApi, PersonalModResult } from '../../../../shared/personalMod';

let changed: () => void;
let api: PersonalModApi;

beforeEach(() => {
  localStorage.clear();
  __resetComposerModePreferenceForTest();
  api = {
    get: vi.fn(async (): Promise<PersonalModResult> => ({ ok: true, mod: null })),
    import: vi.fn(), remove: vi.fn(),
    onChanged: (listener) => { changed = listener; return () => undefined; },
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { platform: 'win32', personalMods: api } });
});

afterEach(() => {
  cleanup();
  __resetComposerModePreferenceForTest();
  localStorage.clear();
  Reflect.deleteProperty(window, 'electronAPI');
});

describe('installed Mod catalog', () => {
  it('provides the bundled battle without an imported package', async () => {
    const hook = renderHook(useComposerModePreference);
    const loaded = () => expect(api.get).toHaveBeenCalled();
    await waitFor(loaded);
    expect(hook.result.current.mode).toBe('cartethyia-battle');
    expect(hook.result.current.available).toBe(true);
    expect(hook.result.current.selectedMode).toBe('cartethyia-battle');
  });

  it('drops an old owner response after a catalog invalidation', async () => {
    let resolveOld: (value: PersonalModResult) => void = () => undefined;
    const oldRequest = new Promise<PersonalModResult>((resolve) => { resolveOld = resolve; });
    const get = vi.mocked(api.get);
    get.mockReturnValueOnce(oldRequest);
    get.mockResolvedValue({ ok: true, mod: null });
    const hook = renderHook(useInstalledPersonalMod);
    const switchOwner = async () => { changed(); };
    await act(switchOwner);
    const resolve = async () => {
      const result: PersonalModResult = { ok: true, mod: installedModFixture };
      resolveOld(result);
    };
    await act(resolve);
    expect(hook.result.current.mod).toBeNull();
    expect(hook.result.current.loading).toBe(false);
  });

  it('rejects non-managed artwork URLs from a malformed response', async () => {
    const assets = { ...installedModFixture.assets, ground: 'file:///private.png' };
    const mod = { ...installedModFixture, assets };
    const get = vi.mocked(api.get);
    get.mockResolvedValue({ ok: true, mod });
    const hook = renderHook(useInstalledPersonalMod);
    const failed = () => expect(hook.result.current.error).toBe(true);
    await waitFor(failed);
    expect(hook.result.current.mod).toBeNull();
  });
});
