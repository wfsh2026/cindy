// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setModDisplayOption, DEFAULT_MOD_DISPLAY } from '../usePersonalModPreferences';
import type { ModDisplayOption } from '../types';

import { installedModFixture } from './personalModFixture';
import { CartethyiaBattleStage } from '../cartethyia-battle/CartethyiaBattleStage';

const context = vi.hoisted(() => ({
  visible: true,
  reducedMotion: false,
  activity: { phase: 'running', startedAtMs: 1, currentActionSummary: null } as {
    phase: string; startedAtMs: number; currentActionSummary: string | null;
  },
}));
vi.mock('@/hooks/useWindowVisible', () => ({ useDocumentVisible: () => context.visible }));
vi.mock('@/hooks/useReducedMotion', () => ({ useReducedMotion: () => context.reducedMotion }));
vi.mock('@/state/agentIslandActivity', () => ({ useAgentIslandActivity: () => context.activity }));

function advance(milliseconds: number): void {
  const advanceTimers = () => vi.advanceTimersByTime(milliseconds);
  act(advanceTimers);
}

function stage(active = true, stopGeneration = 0) {
  return <CartethyiaBattleStage sessionId="battle-test" active={active} compact={false} stopGeneration={stopGeneration} />;
}

function cue(container: HTMLElement): string | undefined {
  const root = container.querySelector<HTMLElement>('[data-battle-cue]');
  return root?.dataset.battleCue;
}

describe('Cartethyia battle playback', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    const random = vi.spyOn(Math, 'random');
    random.mockReturnValue(0);
    context.visible = true;
    context.reducedMotion = false;
    context.activity = { phase: 'running', startedAtMs: 1, currentActionSummary: null };
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('turns off battle movement while retaining the character and ground', () => {
    setModDisplayOption('cartethyia-battle', 'battle', false);
    const element = stage(); const view = render(element);
    advance(5000);
    const current = cue(view.container);
    expect(current).toBe('idle');
    const hero = view.container.querySelector('.cartethyia-battle__hero');
    const monster = view.container.querySelector('.cartethyia-battle__monster');
    const damage = view.container.querySelector('.cartethyia-battle__damage');
    expect(hero).not.toBeNull(); expect(monster).toBeNull(); expect(damage).toBeNull();
  });

  it('removes all visual content and timers when every part is off', () => {
    const keys = Object.keys(DEFAULT_MOD_DISPLAY) as ModDisplayOption[];
    for (const key of keys) setModDisplayOption('cartethyia-battle', key, false);
    const element = stage(); const view = render(element);
    const arena = view.container.querySelector('[data-composer-mode]');
    expect(arena).toBeNull();
    advance(0);
    const timers = vi.getTimerCount(); expect(timers).toBe(0);
  });

  it('双方同时开始接近，到位后攻击，命中帧才出现伤害且暂停后精确续播', () => {
    const element = stage();
    const view = render(element);
    const approachCue = cue(view.container);
    expect(approachCue).toBe('hero-approach');
    const actors = view.container.querySelectorAll('.cartethyia-battle__actor');
    expect(actors.length).toBe(2);
    advance(999);
    const approaching = cue(view.container);
    expect(approaching).toBe('hero-approach');
    advance(1);
    advance(200);
    const beforeHit = view.container.querySelector('.cartethyia-battle__damage');
    expect(beforeHit).toBeNull();

    const pausedElement = stage(false);
    view.rerender(pausedElement);
    advance(5000);
    const pausedCue = cue(view.container);
    expect(pausedCue).toBe('hero-attack');
    const resumedElement = stage();
    view.rerender(resumedElement);
    advance(179);
    const stillBeforeHit = view.container.querySelector('.cartethyia-battle__damage');
    expect(stillBeforeHit).toBeNull();
    advance(1);
    const damage = view.container.querySelector('.cartethyia-battle__damage');
    expect(damage?.textContent).toBe('−100');
    const hitSprite = view.container.querySelector<HTMLImageElement>('.cartethyia-battle__monster img');
    expect(hitSprite?.src).toBe(installedModFixture.assets.monsterHit);
    const slash = view.container.querySelector('.cartethyia-battle__slash-effect img');
    expect(slash).not.toBeNull();
    const root = view.container.querySelector<HTMLElement>('[data-normal-hits]');
    expect(root?.dataset.normalHits).toBe('1');
    advance(380);
    const recoveryCue = cue(view.container);
    expect(recoveryCue).toBe('monster-hit');
    expect(root?.dataset.normalHits).toBe('1');
  });

  it('击杀后原地胜利完整播放，再归位等待；隐藏窗口暂停等待，刷新后双方接近', () => {
    const element = stage();
    const view = render(element);
    advance(1000);
    for (let hit = 0; hit < 3; hit += 1) {
      advance(380);
      advance(380);
      advance(40);
      if (hit < 2) {
        advance(234);
        advance(286);
        advance(134);
      }
    }
    const deathCue = cue(view.container);
    expect(deathCue).toBe('monster-death');
    advance(760);
    const victoryCue = cue(view.container);
    expect(victoryCue).toBe('victory');
    const victorySprite = view.container.querySelector<HTMLImageElement>('.cartethyia-battle__hero img');
    expect(victorySprite?.src).toBe(installedModFixture.assets.heroVictory);
    advance(799);
    const stillCelebrating = cue(view.container);
    expect(stillCelebrating).toBe('victory');
    advance(1);
    const returnCue = cue(view.container);
    expect(returnCue).toBe('hero-return');
    const absentMonster = view.container.querySelector('.cartethyia-battle__monster-actor');
    expect(absentMonster).toBeNull();
    advance(799);
    const stillReturning = cue(view.container);
    expect(stillReturning).toBe('hero-return');
    advance(1);
    const waitCue = cue(view.container);
    expect(waitCue).toBe('respawn-wait');
    advance(400);
    context.visible = false;
    const hiddenElement = stage();
    view.rerender(hiddenElement);
    advance(5000);
    context.visible = true;
    const visibleElement = stage();
    view.rerender(visibleElement);
    advance(299);
    const stillWaiting = cue(view.container);
    expect(stillWaiting).toBe('respawn-wait');
    advance(1);
    const spawnCue = cue(view.container);
    expect(spawnCue).toBe('monster-spawn');
    advance(180);
    const nextApproach = cue(view.container);
    expect(nextApproach).toBe('hero-approach');
  });

  it('等待用户输入不推进命中，停止后清理飘血和旧计时器', () => {
    const element = stage();
    const view = render(element);
    advance(1000);
    advance(100);
    context.activity = { ...context.activity, phase: 'needs-interaction' };
    const waitingElement = stage();
    view.rerender(waitingElement);
    advance(4000);
    const noDamage = view.container.querySelector('.cartethyia-battle__damage');
    expect(noDamage).toBeNull();
    context.activity = { ...context.activity, phase: 'running' };
    const runningElement = stage();
    view.rerender(runningElement);
    advance(280);
    const damage = view.container.querySelector('.cartethyia-battle__damage');
    expect(damage).not.toBeNull();
    const stoppedElement = stage(true, 1);
    view.rerender(stoppedElement);
    advance(10000);
    const stoppedCue = cue(view.container);
    expect(stoppedCue).toBe('idle');
    const staleDamage = view.container.querySelector('.cartethyia-battle__damage');
    expect(staleDamage).toBeNull();
    view.unmount();
    const timerCount = vi.getTimerCount();
    expect(timerCount).toBe(0);
  });

  it('减少动态效果时仍能结束场景并结算一次命中', () => {
    context.reducedMotion = true;
    const element = stage();
    const view = render(element);
    advance(360);
    advance(144);
    advance(216);
    const recoveryCue = cue(view.container);
    expect(recoveryCue).toBe('monster-hit');
    const root = view.container.querySelector<HTMLElement>('[data-normal-hits]');
    expect(root?.dataset.normalHits).toBe('1');
  });

  it('频繁摘要更新排队技能，不重启攻击；技能接触时角色保持完整并播放独立能量', () => {
    const element = stage();
    const view = render(element);
    advance(1000);
    advance(200);
    context.activity = { ...context.activity, currentActionSummary: '读取文件' };
    const firstUpdate = stage();
    view.rerender(firstUpdate);
    context.activity = { ...context.activity, currentActionSummary: '修改代码' };
    const secondUpdate = stage();
    view.rerender(secondUpdate);
    const attackCue = cue(view.container);
    expect(attackCue).toBe('hero-attack');
    advance(180);
    advance(380);
    advance(40);
    const skillCue = cue(view.container);
    expect(skillCue).toBe('skill');
    advance(240);
    const energy = view.container.querySelector<HTMLImageElement>('.cartethyia-battle__energy-effect img');
    const actor = view.container.querySelector<HTMLImageElement>('.cartethyia-battle__hero img');
    const monster = view.container.querySelector<HTMLImageElement>('.cartethyia-battle__monster img');
    expect(energy?.src).toBe(installedModFixture.assets.energy);
    expect(actor?.src).toBe(installedModFixture.assets.heroSkill);
    expect(monster?.src).toBe(installedModFixture.assets.monsterHit);
    const damage = view.container.querySelector('.cartethyia-battle__damage');
    expect(damage?.textContent).toBe('−200');
  });

  it('连续五轮均在击杀后胜利、归位、等待，且怪物不会在等待中复活', () => {
    const element = stage();
    const view = render(element);
    for (let encounter = 1; encounter <= 5; encounter += 1) {
      advance(1000);
      for (let hit = 0; hit < 3; hit += 1) {
        advance(380);
        advance(380);
        advance(40);
        if (hit < 2) {
          advance(234);
          advance(286);
          advance(134);
        }
      }
      advance(760);
      const victory = cue(view.container);
      expect(victory).toBe('victory');
      advance(800);
      const returning = cue(view.container);
      expect(returning).toBe('hero-return');
      advance(800);
      const waiting = cue(view.container);
      expect(waiting).toBe('respawn-wait');
      const missingMonster = view.container.querySelector('.cartethyia-battle__monster');
      expect(missingMonster).toBeNull();
      advance(700);
      const spawning = cue(view.container);
      expect(spawning).toBe('monster-spawn');
      advance(180);
    }
  });
});

vi.mock('@/features/composer-modes/useInstalledPersonalMod', async () => {
  const { installedModFixture } = await import('./personalModFixture');
  return { useInstalledPersonalMod: () => ({ mod: installedModFixture, loading: false, error: false }), refreshPersonalMod: async () => undefined };
});
