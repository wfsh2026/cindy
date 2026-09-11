import { ThemeProvider } from '@/hooks/useTheme';
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
  const localThemes = { list: async () => ({ success: true, themes: [], diagnostics: [] }) };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { platform: 'win32', personalMods: api, localThemes } });
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

function enterCharacters() { click('settings.personalMods.categories.character'); }
async function importedRow() {
  await waitFor(() => { const row = document.querySelector('[data-mod-source="imported"]'); expect(row).not.toBeNull(); });
  const region = document.querySelector('[data-mod-source="imported"]')!;
  return within(region as HTMLElement);
}
describe('Personal Mod import UI', () => {
  it('adds an inactive imported row and removes its exact revision through the row menu', async () => {
    const element = <ThemeProvider><PersonalModsSection /></ThemeProvider>; render(element); enterCharacters();
    click('settings.personalMods.import'); const row = await importedRow();
    const enabled = row.getByRole('switch', { name: 'settings.personalMods.cartethyiaName' });
    expect(enabled.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(enabled); expect(enabled.getAttribute('aria-checked')).toBe('true');
    const menu = row.getByRole('button', { name: 'settings.personalMods.more' });
    fireEvent.pointerDown(menu, { button: 0, ctrlKey: false, pointerType: 'mouse' });
    const remove = await screen.findByRole('menuitem', { name: 'settings.personalMods.remove' }); fireEvent.click(remove);
    const modal = screen.getByRole('alertdialog'); const controls = within(modal); const confirm = controls.getByRole('button', { name: 'settings.personalMods.remove' }); fireEvent.click(confirm);
    await waitFor(() => { const removed = document.querySelector('[data-mod-source="imported"]'); expect(removed).toBeNull(); });
    expect(api.remove).toHaveBeenCalledWith(installedModFixture.revision);
    const builtin = document.querySelector('[data-mod-source="builtin"]'); expect(builtin).not.toBeNull();
  });
  it('preserves disabled preferences on import and after an invalid update', async () => {
    localStorage.setItem('cartethyia.composerMode.v1', 'standard');
    const element = <ThemeProvider><PersonalModsSection /></ThemeProvider>; render(element); enterCharacters();
    click('settings.personalMods.import'); const row = await importedRow();
    const toggle = row.getByRole('switch', { name: 'settings.personalMods.cartethyiaName' }); expect(toggle.getAttribute('aria-checked')).toBe('false');
    api.import = vi.fn(async (): Promise<PersonalModResult> => ({ ok: false, error: 'invalid-package' })); click('settings.personalMods.import');
    const message = await screen.findByRole('alert'); expect(message.textContent).toBe('settings.personalMods.errors.invalid-package');
    const retained = document.querySelector('[data-mod-source="imported"]'); expect(retained).not.toBeNull();
    const preference = localStorage.getItem('cartethyia.composerMode.v1'); expect(preference).toBe('standard');
  });
  it('keeps the installed row when the native import picker is canceled', async () => {
    installed = installedModFixture; api.import = vi.fn(async (): Promise<PersonalModResult> => ({ ok: true, mod: null, canceled: true }));
    const element = <ThemeProvider><PersonalModsSection /></ThemeProvider>; render(element); enterCharacters(); await importedRow();
    click('settings.personalMods.import');
    await waitFor(() => { const button = screen.getByRole('button', { name: 'settings.personalMods.import' }); expect(button.hasAttribute('disabled')).toBe(false); });
    const retained = document.querySelector('[data-mod-source="imported"]'); expect(retained).not.toBeNull(); expect(api.remove).not.toHaveBeenCalled();
  });
});
