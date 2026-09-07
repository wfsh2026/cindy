import { useEffect, useRef, type Dispatch } from 'react';

import type { CartethyiaBattleCue, CartethyiaBattleEvent } from './battleStateMachine';
import { requiredNormalHitsForRandom } from './battleStateMachine';
import { cartethyiaBattlePack } from './cartethyiaBattlePack';

interface BattleSceneClockOptions {
  cue: CartethyiaBattleCue;
  epoch: number;
  playing: boolean;
  reducedMotion: boolean;
  dispatch: Dispatch<CartethyiaBattleEvent>;
  hitKind: 'normal' | 'skill' | null;
}

export function battleSceneDuration(cue: CartethyiaBattleCue, hitKind: 'normal' | 'skill' | null = null): number | null {
  const { combat, hero, monster } = cartethyiaBattlePack;
  if (cue === 'hero-approach') return combat.approachDurationMs;
  if (cue === 'hero-return') return combat.heroReturnDurationMs;
  if (cue === 'victory') return hero.victory.durationMs;
  if (cue === 'respawn-wait') return combat.respawnWaitDurationMs;
  if (cue === 'monster-spawn') return combat.monsterSpawnDelayMs;
  if (cue === 'hero-attack') return hero.attack.durationMs;
  if (cue === 'skill') return hero.skill.durationMs;
  if (cue === 'hero-hit') return hero.hit.durationMs - (combat.monsterAttackDurationMs - combat.monsterAttackImpactMs);
  if (cue === 'monster-hit') {
    const attackDuration = hitKind === 'skill' ? hero.skill.durationMs : hero.attack.durationMs;
    const impactDelay = hitKind === 'skill' ? combat.heroSkillImpactMs : combat.heroAttackImpactMs;
    const remainingHitMs = monster.hit.durationMs - (attackDuration - impactDelay);
    return Math.max(0, remainingHitMs);
  }
  if (cue === 'monster-death') return monster.death.durationMs;
  if (cue === 'monster-attack') return combat.monsterAttackDurationMs;
  return null;
}

function battleImpactDelay(cue: CartethyiaBattleCue): number | null {
  const combat = cartethyiaBattlePack.combat;
  if (cue === 'hero-attack') return combat.heroAttackImpactMs;
  if (cue === 'skill') return combat.heroSkillImpactMs;
  if (cue === 'monster-attack') return combat.monsterAttackImpactMs;
  return null;
}

// Keep hit frames and scene endings on the same clock; pausing retains elapsed time.
export function useBattleSceneClock(options: BattleSceneClockOptions): void {
  const { cue, epoch, playing, reducedMotion, dispatch, hitKind } = options;
  const progress = useRef({ epoch: -1, elapsedMs: 0, impactSent: false });
  const runSceneClock = () => {
    if (progress.current.epoch !== epoch) progress.current = { epoch, elapsedMs: 0, impactSent: false };
    const normalDuration = battleSceneDuration(cue, hitKind);
    if (!playing || normalDuration === null) return;
    const clock = progress.current;
    const deliberateWait = cue === 'respawn-wait' || cue === 'monster-spawn';
    const reducedDuration = Math.min(normalDuration, cartethyiaBattlePack.combat.reducedMotionSceneDurationMs);
    const duration = reducedMotion && !deliberateWait ? reducedDuration : normalDuration;
    const startedAt = performance.now();
    const completeScene = () => {
      let nextRequiredNormalHits: number | undefined;
      if (cue === 'respawn-wait') {
        const randomValue = Math.random();
        nextRequiredNormalHits = requiredNormalHitsForRandom(randomValue);
      }
      const event: CartethyiaBattleEvent = { type: 'scene-completed', epoch, nextRequiredNormalHits };
      dispatch(event);
    };
    const applyImpact = () => {
      clock.impactSent = true;
      const event: CartethyiaBattleEvent = { type: 'attack-impact', epoch };
      dispatch(event);
    };
    const impactDelay = battleImpactDelay(cue);
    let impactTimer: number | undefined;
    if (impactDelay !== null && !clock.impactSent) {
      const scaledDelay = reducedMotion ? impactDelay * duration / normalDuration : impactDelay;
      const remainingImpactMs = Math.max(0, scaledDelay - clock.elapsedMs);
      impactTimer = window.setTimeout(applyImpact, remainingImpactMs);
    }
    const remainingSceneMs = Math.max(0, duration - clock.elapsedMs);
    const sceneTimer = window.setTimeout(completeScene, remainingSceneMs);
    const pauseClock = () => {
      const stoppedAt = performance.now();
      clock.elapsedMs += stoppedAt - startedAt;
      window.clearTimeout(sceneTimer);
      if (impactTimer !== undefined) window.clearTimeout(impactTimer);
    };
    return pauseClock;
  };
  useEffect(runSceneClock, [cue, epoch, playing, reducedMotion, dispatch, hitKind]);
}
