import { describe, expect, it } from 'vitest';
import { applyThemeModParts, availableThemeParts } from '../mod-parts';
import { cartethyiaDark } from '../builtin/cartethyia';
import { cindyDark } from '../builtin/cindy-dark';
import { THEME_MOD_PARTS } from '../../../shared/themeModParts';

describe('independent theme Mod parts', () => {
  it('disables individual images and names without discarding other parts', () => {
    const options = { parts: { login: false, appName: false } };
    const result = applyThemeModParts(cartethyiaDark, options);
    expect(result.brand?.loginHero).toBeUndefined();
    expect(result.mod?.appDisplayName).toBeUndefined();
    expect(result.brand?.avatar).toEqual(cartethyiaDark.brand?.avatar);
    expect(result.colors).toEqual(cartethyiaDark.colors);
    expect(cartethyiaDark.brand?.loginHero).toBeDefined();
  });
  it('separates project overrides from overall palette overrides', () => {
    const paletteOff = { parts: { colors: false } };
    const projectsOnly = applyThemeModParts(cartethyiaDark, paletteOff);
    expect(projectsOnly.colors['sidebar-project-icon']).toBe(cartethyiaDark.colors['sidebar-project-icon']);
    expect(projectsOnly.colors.surface).toBe(cindyDark.colors.surface);
    const projectOff = { parts: { projects: false } };
    const paletteOnly = applyThemeModParts(cartethyiaDark, projectOff);
    expect(paletteOnly.colors['sidebar-project-icon']).toBe(cindyDark.colors['sidebar-project-icon']);
  });
  it('restores the base values when every part is off and offers only provided parts', () => {
    const pairs = THEME_MOD_PARTS.map(part => [part, false]);
    const options = { parts: Object.fromEntries(pairs) };
    const result = applyThemeModParts(cartethyiaDark, options);
    expect(result.colors).toEqual(cindyDark.colors);
    expect(result.brand).toEqual(cindyDark.brand);
    const plain = { id: 'plain', name: 'plain', type: 'dark' as const, colors: { surface: '#123456' } };
    const available = availableThemeParts([plain]);
    expect(available).toEqual(['colors']);
  });
});
