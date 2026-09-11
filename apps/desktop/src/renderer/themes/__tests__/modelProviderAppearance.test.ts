import { describe, expect, it } from 'vitest';

import { modelProviderColor } from '@/lib/modelProviderAppearance';
import { contrastRatio, parseCssColor, type Rgb } from '../../../shared/theme-import/color';
import { cartethyiaDark, cartethyiaLight } from '../builtin/cartethyia';
import { cindyDark } from '../builtin/cindy-dark';
import { cindyLight } from '../builtin/cindy-light';
import { exportThemeColors } from '../theme-service';
import '../colors';

function rgb(value: string | undefined): Rgb {
  const parsed = value ? parseCssColor(value) : null;
  if (!parsed) throw new Error(`Missing palette color: ${value}`);
  return parsed;
}

describe('Model provider appearance', () => {
  it('binds the actual provider, including custom providers with builtin-looking names', () => {
    const cindy = modelProviderColor('xd');
    const openai = modelProviderColor('openai');
    const custom = modelProviderColor('custom-openai');
    const another = modelProviderColor('custom-openai-2');
    const repeated = modelProviderColor('custom-openai');
    const inheritedName = modelProviderColor('toString');
    expect(cindy).toBe('var(--model-provider-xd)');
    expect(openai).toBe('var(--model-provider-openai)');
    expect(custom).not.toBe(openai);
    expect(another).not.toBe(custom);
    expect(repeated).toBe(custom);
    expect(inheritedName).toContain('model-provider-custom-');
  });

  it.each([cindyLight, cindyDark])('$id stays opted out of provider identity colors', (theme) => {
    const colors = exportThemeColors(theme);
    expect(colors['model-provider-xd']).toBeUndefined();
  });

  it.each([cartethyiaLight, cartethyiaDark])('$id keeps labels readable on normal, hover and selected surfaces', (theme) => {
    const colors = exportThemeColors(theme);
    const textKeys = ['model-item-text', 'model-item-desc'];
    const keys = Object.keys(colors);
    const providerKeys = keys.filter((key) => key.startsWith('model-provider-'));
    const surfaces = ['model-dropdown-bg', 'model-item-hover', 'model-item-selected-bg'];
    for (const surface of surfaces) {
      const background = rgb(colors[surface]);
      for (const key of [...textKeys, ...providerKeys]) {
        const foreground = rgb(colors[key]);
        const ratio = contrastRatio(foreground, background);
        expect(ratio, `${theme.id}: ${key} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        if (!key.startsWith('model-provider-')) continue;
        const tint = {
          r: foreground.r * 0.12 + background.r * 0.88,
          g: foreground.g * 0.12 + background.g * 0.88,
          b: foreground.b * 0.12 + background.b * 0.88,
        };
        const badgeRatio = contrastRatio(foreground, tint);
        expect(badgeRatio, `${theme.id}: ${key} badge on ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    const border = rgb(colors['model-item-selected-border']);
    const selected = rgb(colors['model-item-selected-bg']);
    const borderRatio = contrastRatio(border, selected);
    expect(borderRatio).toBeGreaterThanOrEqual(3);
  });
});
