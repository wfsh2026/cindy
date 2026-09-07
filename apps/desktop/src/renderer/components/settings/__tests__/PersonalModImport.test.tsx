// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalModsSection } from '../PersonalModsSection';
import { installedModFixture } from '@/features/composer-modes/__tests__/personalModFixture';
import { __resetComposerModePreferenceForTest } from '@/features/composer-modes/useComposerModePreference';
import type { InstalledPersonalMod, PersonalModApi, PersonalModResult } from '../../../../shared/personalMod';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/state/agentIslandActivity', () => ({ useAgentIslandActivity: () => null }));

let installed: InstalledPersonalMod | null;
let api: PersonalModApi;

beforeEach(() => {
  localStorage.clear();
  __resetComposerModePreferenceForTest();
  installed = null;
  api = {
    get: vi.fn(async (): Promise<PersonalModResult> => ({ ok: true, mod: installed })),
    import: vi.fn(async (): Promise<PersonalModResult> => { installed = installedModFixture; return { ok: true, mod: installed }; }),
    remove: vi.fn(async (): Promise<PersonalModResult> => { installed = null; return { ok: true, mod: null }; }),
    onChanged: () => () => undefined,
  };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { platform: 'win32', personalMods: api } });
});

afterEach(() => {
  cleanup();
  __resetComposerModePreferenceForTest();
  localStorage.clear();
  Reflect.deleteProperty(window, 'electronAPI');
});

function click(name: string): void {
  const button = screen.getByRole('button', { name });
  fireEvent.click(button);
}

describe('Personal Mod import UI', () => {
  it('starts empty, imports a Mod and uninstalls the exact version after confirmation', async () => {
    const element = <PersonalModsSection />;
    render(element);
    const empty = await screen.findByText('settings.personalMods.empty');
    expect(empty).not.toBeNull();
    click('settings.personalMods.import');
    const enabled = await screen.findByRole('switch', { name: 'settings.personalMods.cartethyiaName' });
    const checked = enabled.getAttribute('aria-checked');
    expect(checked).toBe('true');
    click('settings.personalMods.remove');
    const modal = screen.getByRole('alertdialog');
    const queries = within(modal);
    const confirm = queries.getByRole('button', { name: 'settings.personalMods.remove' });
    fireEvent.click(confirm);
    const assertEmpty = () => {
      const message = screen.getByText('settings.personalMods.empty');
      expect(message).not.toBeNull();
    };
    await waitFor(assertEmpty);
    expect(api.remove).toHaveBeenCalledWith(installedModFixture.revision);
    const preference = localStorage.getItem('cartethyia.composerMode.v1');
    expect(preference).toBeNull();
  });

  it('preserves disabled preferences on import and on an unsuccessful update', async () => {
    localStorage.setItem('cartethyia.composerMode.v1', 'standard');
    const element = <PersonalModsSection />;
    render(element);
    await screen.findByText('settings.personalMods.empty');
    click('settings.personalMods.import');
    const enabled = await screen.findByRole('switch', { name: 'settings.personalMods.cartethyiaName' });
    const checked = enabled.getAttribute('aria-checked');
    expect(checked).toBe('false');
    api.import = vi.fn(async (): Promise<PersonalModResult> => ({ ok: false, error: 'invalid-package' }));
    click('settings.personalMods.import');
    const message = await screen.findByRole('alert');
    expect(message.textContent).toBe('settings.personalMods.errors.invalid-package');
    const stillInstalled = screen.getByRole('switch', { name: 'settings.personalMods.cartethyiaName' });
    expect(stillInstalled).not.toBeNull();
    const preference = localStorage.getItem('cartethyia.composerMode.v1');
    expect(preference).toBe('standard');
  });

  it('does not remove the current Mod when the native import dialog is canceled', async () => {
    installed = installedModFixture;
    api.import = vi.fn(async (): Promise<PersonalModResult> => ({ ok: true, mod: null, canceled: true }));
    const element = <PersonalModsSection />;
    render(element);
    await screen.findByRole('switch', { name: 'settings.personalMods.cartethyiaName' });
    click('settings.personalMods.import');
    const finished = () => {
      const button = screen.getByRole('button', { name: 'settings.personalMods.import' });
      expect(button.hasAttribute('disabled')).toBe(false);
    };
    await waitFor(finished);
    const control = screen.getByRole('switch', { name: 'settings.personalMods.cartethyiaName' });
    expect(control).not.toBeNull();
  });
});
