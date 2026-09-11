import { ThemeProvider } from '@/hooks/useTheme';
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PersonalModsSection } from '../PersonalModsSection';
import { ComposerModeHost, ComposerModeSlot } from '@/features/composer-modes/ComposerModeHost';
import { __resetComposerModePreferenceForTest, useComposerModePreference } from '@/features/composer-modes/useComposerModePreference';
import { usePersonalModPreferences, setPersonalModsEnabled } from '@/features/composer-modes/usePersonalModPreferences';
import { ModErrorBoundary } from '@/features/composer-modes/ModErrorBoundary';

const context = vi.hoisted(() => ({ activity: null as null | { phase: 'running'; startedAtMs: number; currentActionSummary: null } }));
vi.mock('@/hooks/useWindowVisible', () => ({ useDocumentVisible: () => true }));
vi.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => false }));
vi.mock('@/state/agentIslandActivity', () => ({ useAgentIslandActivity: () => context.activity }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const modeKey = 'cartethyia.composerMode.v1';
const modsKey = 'cartethyia.personalMods.v1';

function openCharacterList(): void {
  const entry = screen.queryByRole('button', { name: 'settings.personalMods.categories.character' });
  if (entry) fireEvent.click(entry);
}
function characterQueries() {
  const region = document.querySelector('[data-mod-source="imported"]');
  return region ? within(region as HTMLElement) : screen;
}
function click(label: string): void {
  openCharacterList();
  const queries = characterQueries();
  const actual = label === 'settings.personalMods.configure' ? 'settings.personalMods.cartethyiaName' : label === 'settings.defaults.restore' ? 'settings.personalMods.resetParts' : label;
  const control = queries.getByRole('button', { name: actual });
  fireEvent.click(control);
}
function toggle(label: string): void {
  openCharacterList();
  const queries = characterQueries();
  const actual = label === 'settings.personalMods.master' ? 'settings.personalMods.cartethyiaName' : label;
  const control = queries.getByRole('switch', { name: actual });
  fireEvent.click(control);
}

function advance(milliseconds: number): void {
  const advanceTimers = () => vi.advanceTimersByTime(milliseconds);
  act(advanceTimers);
}

function LiveStage() {
  const { mode } = useComposerModePreference();
  return <ComposerModeHost mode={mode}><ComposerModeSlot sessionId="test" active compact={false} stopGeneration={0} /></ComposerModeHost>;
}

describe('Personal Mods', () => {
  beforeEach(() => {
    localStorage.clear();
    __resetComposerModePreferenceForTest();
    Object.defineProperty(window, 'electronAPI', { configurable: true, value: { platform: 'win32' } });
    context.activity = null;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const random = vi.spyOn(Math, 'random');
    random.mockReturnValue(0);
  });

  afterEach(() => {
    cleanup();
    __resetComposerModePreferenceForTest();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('preserves the legacy disabled choice, resets display overrides without enabling the Mod', () => {
    localStorage.setItem(modeKey, 'standard');
    const element = <ThemeProvider><PersonalModsSection /></ThemeProvider>;
    render(element);
    openCharacterList();
    const queries = characterQueries();
    const enabled = queries.getByRole('switch', { name: 'settings.personalMods.cartethyiaName' });
    const checked = enabled.getAttribute('aria-checked');
    expect(checked).toBe('false');
    click('settings.personalMods.configure');
    toggle('settings.personalMods.options.ground');
    const raw = localStorage.getItem(modsKey);
    expect(raw).toBe('{"mods":{"cartethyia-battle":{"ground":false}}}');
    click('settings.defaults.restore');
    const resetRaw = localStorage.getItem(modsKey);
    const oldChoice = localStorage.getItem(modeKey);
    expect(resetRaw).toBeNull();
    expect(oldChoice).toBe('standard');
  });

  it('unmounts the live stage on master off and lets the shortcut turn it back on', () => {
    context.activity = { phase: 'running', startedAtMs: 1, currentActionSummary: null };
    const element = <><ThemeProvider><PersonalModsSection /></ThemeProvider><LiveStage /></>;
    const view = render(element);
    openCharacterList();
    const before = view.container.querySelector('[data-battle-cue]');
    expect(before).not.toBeNull();
    toggle('settings.personalMods.master');
    const after = view.container.querySelector('[data-battle-cue]');
    expect(after).toBeNull();
    // Flush the control's zero-delay UI notification before counting scene timers.
    advance(0);
    const timers = vi.getTimerCount();
    expect(timers).toBe(0);
    const hook = renderHook(useComposerModePreference);
    expect(hook.result.current.mode).toBe('standard');
    expect(hook.result.current.selectedMode).toBe('standard');
    const enableShortcut = () => hook.result.current.setMode('cartethyia-battle');
    act(enableShortcut);
    const restored = view.container.querySelector('[data-battle-cue]');
    expect(restored).not.toBeNull();
  });

  it('previews a full battle with switches off, applies display choices, then stops without task activity', () => {
    localStorage.setItem(modeKey, 'standard');
    const element = <ThemeProvider><PersonalModsSection /></ThemeProvider>;
    const view = render(element);
    openCharacterList();
    const disable = () => setPersonalModsEnabled(false);
    act(disable);
    click('settings.personalMods.configure');
    toggle('settings.personalMods.options.ground');
    toggle('settings.personalMods.options.damage');
    toggle('settings.personalMods.options.effects');
    toggle('settings.personalMods.options.idle');
    click('settings.personalMods.preview');
    advance(1000);
    advance(380);
    const impact = view.container.querySelector('[data-impact-target="monster"]');
    expect(impact).not.toBeNull();
    const decorations = view.container.querySelector('.cartethyia-battle__ground, .cartethyia-battle__damage, .cartethyia-battle__contact-effect');
    expect(decorations).toBeNull();
    const cues = new Set<string>();
    for (let step = 0; step < 160; step += 1) {
      advance(100);
      const stage = view.container.querySelector<HTMLElement>('[data-battle-cue]');
      if (stage?.dataset.battleCue) cues.add(stage.dataset.battleCue);
    }
    const sawVictory = cues.has('victory');
    const sawReturn = cues.has('hero-return');
    expect(sawVictory).toBe(true);
    expect(sawReturn).toBe(true);
    const stage = view.container.querySelector('[data-battle-cue]');
    expect(stage).toBeNull();
    expect(context.activity).toBeNull();
    const oldChoice = localStorage.getItem(modeKey);
    expect(oldChoice).toBe('standard');
    const timers = vi.getTimerCount();
    expect(timers).toBe(0);
  });

  it('hides the idle stage and its sleep timer, then shows it when a task runs', () => {
    const element = <><ThemeProvider><PersonalModsSection /></ThemeProvider><LiveStage /></>;
    const view = render(element);
    openCharacterList();
    click('settings.personalMods.configure');
    toggle('settings.personalMods.options.idle');
    const hidden = view.container.querySelector('[data-battle-cue]');
    expect(hidden).toBeNull();
    advance(0);
    const timers = vi.getTimerCount();
    expect(timers).toBe(0);
    context.activity = { phase: 'running', startedAtMs: 1, currentActionSummary: null };
    const next = <><ThemeProvider><PersonalModsSection /></ThemeProvider><LiveStage /></>;
    view.rerender(next);
    const running = view.container.querySelector('[data-battle-cue="hero-approach"]');
    expect(running).not.toBeNull();
  });

  it('ignores malformed preferences and synchronizes changes and storage clearing across windows', () => {
    localStorage.setItem(modsKey, '{"enabled":"false","mods":{"cartethyia-battle":{"ground":0}}}');
    const hook = renderHook(usePersonalModPreferences);
    expect(hook.result.current.enabled).toBe(true);
    expect(hook.result.current.display.ground).toBe(true);
    const changeElsewhere = () => {
      localStorage.setItem(modsKey, '{"enabled":false}');
      const event = new StorageEvent('storage', { key: modsKey, newValue: '{"enabled":false}' });
      window.dispatchEvent(event);
    };
    act(changeElsewhere);
    expect(hook.result.current.enabled).toBe(false);
    const clearElsewhere = () => {
      localStorage.clear();
      const event = new StorageEvent('storage', { key: null });
      window.dispatchEvent(event);
    };
    act(clearElsewhere);
    expect(hook.result.current.enabled).toBe(true);
  });

  it('isolates a broken Mod and offers a working reload', () => {
    let broken = true;
    function BrokenMod() {
      if (broken) throw new Error('test Mod failed');
      return <div data-testid="recovered" />;
    }
    const error = vi.spyOn(console, 'error');
    error.mockImplementation(() => undefined);
    const element = <><div data-testid="composer" /><ModErrorBoundary><BrokenMod /></ModErrorBoundary></>;
    render(element);
    openCharacterList();
    const composer = screen.getByTestId('composer');
    expect(composer).not.toBeNull();
    broken = false;
    click('settings.personalMods.reload');
    const recovered = screen.getByTestId('recovered');
    expect(recovered).not.toBeNull();
  });
});

vi.mock('@/features/composer-modes/useInstalledPersonalMod', async () => {
  const { installedModFixture } = await import('@/features/composer-modes/__tests__/personalModFixture');
  return { useInstalledPersonalMod: () => ({ mod: installedModFixture, loading: false, error: false }), refreshPersonalMod: async () => undefined };
});
