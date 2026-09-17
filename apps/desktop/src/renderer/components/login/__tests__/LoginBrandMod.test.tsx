// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginBrandStage } from '../LoginBrandStage';
import { cindyLight } from '@/themes/builtin/cindy-light';
import { cindyDark } from '@/themes/builtin/cindy-dark';
import { cartethyiaLight, cartethyiaDark } from '@/themes/cartethyia';
import { themeService } from '@/themes/theme-service';

vi.mock('@/contexts/LoginHandoffContext', () => ({ LOGIN_HANDOFF_TIMINGS: {}, useLoginHandoff: () => ({ brandLayout: 'login', brandStageMounted: true, reportBrandAssetsReady: () => undefined }) }));
vi.mock('../LoginStage', () => ({ useViewportSize: () => ({ width: 1280, height: 900 }) }));
afterEach(cleanup);

describe('login artwork follows the active theme', () => {
  it.each(['light', 'dark'] as const)('restores the official hero, wordmark and density variants in %s mode', async mode => {
    const base = mode === 'light' ? cindyLight : cindyDark;
    const mod = mode === 'light' ? cartethyiaLight : cartethyiaDark;
    themeService.applyTheme(base);
    const element = <LoginBrandStage />;
    render(element);
    const hero = screen.getByTestId('login-brand-hero');
    const logo = screen.getByTestId('login-brand-wordmark');
    const originalHero = hero.getAttribute('src');
    const originalHeroSet = hero.getAttribute('srcset');
    const originalLogo = logo.getAttribute('src');
    const enable = async () => { themeService.applyTheme(mod); };
    await act(enable);
    const themedHero = hero.getAttribute('src');
    const themedLogo = logo.getAttribute('src');
    expect(themedHero).toBe(mod.brand?.loginHero?.src);
    expect(themedLogo).toBe(mod.brand?.loginWordmark?.src);
    expect(themedHero).not.toBe(originalHero);
    const disable = async () => { themeService.applyTheme(base); };
    await act(disable);
    const restoredHero = hero.getAttribute('src');
    const restoredHeroSet = hero.getAttribute('srcset');
    const restoredLogo = logo.getAttribute('src');
    const restoredName = logo.getAttribute('alt');
    expect(restoredHero).toBe(originalHero);
    expect(restoredHeroSet).toBe(originalHeroSet);
    expect(restoredLogo).toBe(originalLogo);
    expect(restoredName).toBe('Cindy');
  });
});
