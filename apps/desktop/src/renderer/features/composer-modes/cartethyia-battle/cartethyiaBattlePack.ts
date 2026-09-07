import type { InstalledPersonalMod } from '../../../../shared/personalMod';

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
  idle: { id: 'hero-idle', url: '', frameCount: 4, durationMs: 920 },
  move: { id: 'hero-move', url: '', frameCount: 6, durationMs: 540 },
  attack: { id: 'hero-attack', url: '', frameCount: 6, durationMs: 760 },
  skill: { id: 'hero-skill', url: '', frameCount: 3, durationMs: 720 },
  hit: { id: 'hero-hit', url: '', frameCount: 3, durationMs: 420 },
  victory: { id: 'hero-victory', url: '', frameCount: 5, durationMs: 800 },
  sleep: { id: 'hero-sleep', url: '', frameCount: 6, durationMs: 1500 },
};

const monster: Record<CartethyiaMonsterMotion, CartethyiaSpriteAnimation> = {
  idle: { id: 'monster-idle', url: '', frameCount: 4, durationMs: 1080 },
  hit: { id: 'monster-hit', url: '', frameCount: 3, durationMs: 420 },
  death: { id: 'monster-death', url: '', frameCount: 4, durationMs: 760 },
};

const effects = {
  arc: { id: 'effect-arc', url: '', frameCount: 4, durationMs: 300 },
  energy: { id: 'effect-energy', url: '', frameCount: 4, durationMs: 360 },
  impact: { id: 'effect-impact', url: '', frameCount: 3, durationMs: 300 },
  shard: { id: 'effect-shard', url: '', frameCount: 4, durationMs: 600 },
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
    approachDurationMs: 1000,
    heroReturnDurationMs: 800,
    respawnWaitDurationMs: 700,
    monsterAttackDurationMs: 520,
    monsterSpawnDelayMs: 180,
    reducedMotionSceneDurationMs: 360,
    heroAttackImpactMs: 380,
    heroSkillImpactMs: 240,
    monsterAttackImpactMs: 234,
  },
  groundPlatformUrl: '',
  hero,
  monster,
  effects,
} as const;

/** v1 keeps its playback contract in the host; all artwork comes from the imported package. */
export function resolveCartethyiaBattlePack(assets: InstalledPersonalMod['assets']) {
  return {
    ...cartethyiaBattlePack,
    groundPlatformUrl: assets.ground,
    hero: {
      idle: { ...hero.idle, url: assets.heroIdle }, move: { ...hero.move, url: assets.heroMove },
      attack: { ...hero.attack, url: assets.heroAttack }, skill: { ...hero.skill, url: assets.heroSkill },
      hit: { ...hero.hit, url: assets.heroHit }, victory: { ...hero.victory, url: assets.heroVictory },
      sleep: { ...hero.sleep, url: assets.heroSleep },
    },
    monster: {
      idle: { ...monster.idle, url: assets.monsterIdle }, hit: { ...monster.hit, url: assets.monsterHit },
      death: { ...monster.death, url: assets.monsterDeath },
    },
    effects: {
      arc: { ...effects.arc, url: assets.arc }, energy: { ...effects.energy, url: assets.energy },
      impact: { ...effects.impact, url: assets.impact }, shard: { ...effects.shard, url: assets.shard },
    },
  };
}
