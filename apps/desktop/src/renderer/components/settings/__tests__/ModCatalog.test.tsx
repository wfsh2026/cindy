// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalModsSection } from '../PersonalModsSection';
import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import { useModPresentation } from '@/features/composer-modes/useModIdentity';
import { useThemeBrand } from '@/hooks/useThemeBrand';
import { getThemeModOptions } from '@/themes/mod-preferences';
import { __resetComposerModePreferenceForTest } from '@/features/composer-modes/useComposerModePreference';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('@/state/agentIslandActivity', () => ({ useAgentIslandActivity: () => null }));
const mirror = vi.fn(async () => undefined);
const saveIdentity = vi.fn();
beforeEach(() => {
  localStorage.clear(); __resetComposerModePreferenceForTest(); mirror.mockClear(); saveIdentity.mockClear();
  const personalMods = { get: async () => ({ ok: true, mod: null }), getIdentity: async () => ({}), setIdentity: saveIdentity, setAppearanceSelection: mirror, onChanged: () => () => undefined };
  const localThemes = { list: async () => ({ success: true, themes: [], diagnostics: [] }) };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: { platform: 'win32', personalMods, localThemes } });
});
afterEach(() => { cleanup(); localStorage.clear(); __resetComposerModePreferenceForTest(); Reflect.deleteProperty(window, 'electronAPI'); });
function Observer() {
  const { familyId } = useTheme(); const names = useModPresentation(); const brand = useThemeBrand();
  return <><output data-testid="family">{familyId}</output><output data-testid="names">{names.appName}/{names.assistantName}</output><output data-testid="hero">{brand?.loginHero?.src ?? 'official'}</output></>;
}
function mount() { const element = <ThemeProvider><PersonalModsSection /><Observer /></ThemeProvider>; return render(element); }
function enter(category: 'theme' | 'character') { const button = screen.getByRole('button', { name: 'settings.personalMods.categories.' + category }); fireEvent.click(button); }
function row(name = 'Cartethyia') { const region = screen.getByRole('region', { name }); return within(region); }
function expand(name = 'Cartethyia') { const queries = row(name); const button = queries.getByRole('button', { name }); fireEvent.click(button); }
function total(name = 'Cartethyia') { const queries = row(name); const toggle = queries.getByRole('switch', { name }); fireEvent.click(toggle); }
function part(key: string) { const queries = row(); const toggle = queries.getByRole('switch', { name: 'settings.personalMods.parts.' + key }); fireEvent.click(toggle); }

describe('category pages and expandable Mod lists', () => {
  it('starts with two category entries and no Mod rows, and returns from a category list', async () => {
    const view = mount();
    const switches = screen.queryAllByRole('switch'); expect(switches).toHaveLength(0);
    enter('theme');
    const region = screen.getByRole('region', { name: 'Cartethyia' }); expect(region).not.toBeNull();
    const character = view.container.querySelector('[data-mod-category="character"]'); expect(character).toBeNull();
    const back = screen.getByRole('button', { name: 'settings.personalMods.back' }); fireEvent.click(back);
    const absent = screen.queryByRole('region', { name: 'Cartethyia' }); expect(absent).toBeNull();
    enter('character');
    const ready = () => { const found = screen.getByRole('region', { name: 'settings.personalMods.cartethyiaName' }); expect(found).not.toBeNull(); };
    await waitFor(ready);
  });
  it('keeps opening a row separate from its total switch and switches themes exclusively', () => {
    mount(); enter('theme');
    const queries = row(); const opener = queries.getByRole('button', { name: 'Cartethyia' });
    expect(opener.getAttribute('aria-expanded')).toBe('false');
    total(); expect(opener.getAttribute('aria-expanded')).toBe('false');
    const family = screen.getByTestId('family'); expect(family.textContent).toBe('cindy');
    expand(); expect(family.textContent).toBe('cindy');
    total(); expect(family.textContent).toBe('cartethyia');
    total('Classic'); expect(family.textContent).toBe('default');
    const master = queries.getByRole('switch', { name: 'Cartethyia' }); expect(master.getAttribute('aria-checked')).toBe('false');
  });
  it('applies a part switch to the live theme, mirrors it to Main, and preserves it across total off/on', async () => {
    mount(); enter('theme'); expand(); part('login');
    const hero = screen.getByTestId('hero'); expect(hero.textContent).toBe('official');
    const options = getThemeModOptions('cartethyia'); expect(options.parts?.login).toBe(false);
    const mirrored = () => expect(mirror).toHaveBeenLastCalledWith(expect.objectContaining({ familyId: 'cartethyia', options: { parts: { login: false } } }));
    await waitFor(mirrored);
    total(); total(); expect(hero.textContent).toBe('official');
    const queries = row(); const toggle = queries.getByRole('switch', { name: 'settings.personalMods.parts.login' }); expect(toggle.getAttribute('aria-checked')).toBe('false');
  });
  it('edits disabled packages without applying them and resets parts without enabling the package', () => {
    mount(); enter('theme'); total(); expand(); part('login');
    const family = screen.getByTestId('family'); expect(family.textContent).toBe('cindy');
    const queries = row(); const reset = queries.getByRole('button', { name: 'settings.personalMods.resetParts' }); fireEvent.click(reset);
    expect(family.textContent).toBe('cindy'); const options = getThemeModOptions('cartethyia'); expect(options.parts).toBeUndefined();
  });
  it('saves names inside their owning theme and removes their effect when the corresponding part is off', () => {
    mount(); enter('theme'); expand(); const queries = row();
    const input = queries.getByRole('textbox', { name: 'settings.personalMods.identity.appName' });
    const change = { target: { value: '小青' } }; fireEvent.change(input, change);
    const container = input.closest('[data-theme-part="appName"]')!; const field = within(container as HTMLElement);
    const save = field.getByRole('button', { name: 'settings.personalMods.identity.save' }); fireEvent.click(save);
    const options = getThemeModOptions('cartethyia'); expect(options.names?.appName).toBe('小青'); expect(saveIdentity).not.toHaveBeenCalled();
    const names = screen.getByTestId('names'); expect(names.textContent).toContain('小青');
    part('appName'); expect(names.textContent).toBe('Cindy/卡提西亚');
    total(); expect(names.textContent).toBe('Cindy/Cindy');
  });
  it('does not show controls for parts a theme does not provide', () => {
    mount(); enter('theme'); expand('Classic'); const queries = row('Classic');
    const color = queries.getByRole('switch', { name: 'settings.personalMods.parts.colors' }); expect(color).not.toBeNull();
    const login = queries.queryByRole('switch', { name: 'settings.personalMods.parts.login' }); expect(login).toBeNull();
  });
});
