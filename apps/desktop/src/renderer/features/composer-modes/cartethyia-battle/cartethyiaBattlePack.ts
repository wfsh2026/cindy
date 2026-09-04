import groundPlatformUrl from './assets/ground-platform.png';
import heroAttackUrl from './assets/hero-attack.png';
import heroHitUrl from './assets/hero-hit.png';
import heroIdleUrl from './assets/hero-idle.png';
import heroMoveUrl from './assets/hero-move.png';
import heroSkillUrl from './assets/hero-skill.png';
import heroSleepUrl from './assets/hero-sleep.png';
import heroVictoryUrl from './assets/hero-victory.png';
import monsterDeathUrl from './assets/monster-death.png';
import monsterHitUrl from './assets/monster-hit.png';
import monsterIdleUrl from './assets/monster-idle.png';

export type CartethyiaHeroMotion =
  'idle' | 'move' | 'attack' | 'skill' | 'hit' | 'victory' | 'sleep';
export type CartethyiaMonsterMotion = 'idle' | 'hit' | 'death';

export interface CartethyiaSpriteAnimation {
  id: string;
  url: string;
  frameCount: number;
  durationMs: number;
}

const hero: Record<CartethyiaHeroMotion, CartethyiaSpriteAnimation> = {
  idle: { id: 'hero-idle', url: heroIdleUrl, frameCount: 4, durationMs: 920 },
  move: { id: 'hero-move', url: heroMoveUrl, frameCount: 6, durationMs: 540 },
  attack: { id: 'hero-attack', url: heroAttackUrl, frameCount: 6, durationMs: 760 },
  skill: { id: 'hero-skill', url: heroSkillUrl, frameCount: 8, durationMs: 720 },
  hit: { id: 'hero-hit', url: heroHitUrl, frameCount: 3, durationMs: 420 },
  victory: { id: 'hero-victory', url: heroVictoryUrl, frameCount: 6, durationMs: 900 },
  sleep: { id: 'hero-sleep', url: heroSleepUrl, frameCount: 6, durationMs: 1500 },
};

const monster: Record<CartethyiaMonsterMotion, CartethyiaSpriteAnimation> = {
  idle: { id: 'monster-idle', url: monsterIdleUrl, frameCount: 4, durationMs: 1080 },
  hit: { id: 'monster-hit', url: monsterHitUrl, frameCount: 3, durationMs: 420 },
  death: { id: 'monster-death', url: monsterDeathUrl, frameCount: 4, durationMs: 760 },
};

export const cartethyiaBattlePack = {
  frameWidth: 240,
  frameHeight: 160,
  displayWidth: 120,
  displayHeight: 80,
  combat: {
    heroAttackAnchorX: 82,
    monsterHurtAnchorX: 32,
    attackGap: 10,
    regularEdgeInset: 18,
    compactEdgeInset: 8,
    monsterLungeDistance: 18,
    monsterSpawnOffset: 12,
    heroApproachDurationMs: 900,
    heroAdvanceDurationMs: 900,
    monsterApproachDurationMs: 1050,
    monsterAttackDurationMs: 520,
    monsterSpawnDelayMs: 180,
    reducedMotionSceneDurationMs: 360,
  },
  groundPlatformUrl,
  hero,
  monster,
} as const;
