import { cartethyiaBattlePack } from './cartethyiaBattlePack';

export interface CartethyiaBattleSceneGeometry {
  heroStartX: number;
  heroEncounterX: number;
  monsterEncounterX: number;
  monsterSpawnX: number;
  monsterLungeX: number;
  attackAnchorDistance: number;
}

export interface CartethyiaAttackRangeInput {
  heroX: number;
  monsterX: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  const lowerBounded = Math.max(minimum, value);
  return Math.min(maximum, lowerBounded);
}

export function calculateBattleSceneGeometry(
  arenaWidth: number,
  compact: boolean,
): CartethyiaBattleSceneGeometry {
  const displayWidth = cartethyiaBattlePack.displayWidth;
  const minimumArenaWidth = displayWidth * 2 + 24;
  const safeArenaWidth = Math.max(minimumArenaWidth, arenaWidth);
  const combat = cartethyiaBattlePack.combat;
  const edgeInset = compact ? combat.compactEdgeInset : combat.regularEdgeInset;
  const preferredMonsterX = safeArenaWidth - displayWidth - edgeInset;
  const minimumMonsterX = displayWidth + edgeInset;
  const monsterEncounterX = Math.max(minimumMonsterX, preferredMonsterX);
  const preferredHeroX =
    monsterEncounterX + combat.monsterHurtAnchorX - combat.heroAttackAnchorX - combat.attackGap;
  const maximumHeroX = monsterEncounterX - displayWidth / 3;
  const heroEncounterX = clamp(preferredHeroX, edgeInset, maximumHeroX);
  const heroStartX = Math.min(edgeInset, heroEncounterX);
  const monsterSpawnX = safeArenaWidth + combat.monsterSpawnOffset;
  const monsterLungeX = monsterEncounterX - combat.monsterLungeDistance;
  const heroAttackAnchor = heroEncounterX + combat.heroAttackAnchorX;
  const monsterHurtAnchor = monsterEncounterX + combat.monsterHurtAnchorX;
  const attackAnchorDistance = monsterHurtAnchor - heroAttackAnchor;

  return {
    heroStartX,
    heroEncounterX,
    monsterEncounterX,
    monsterSpawnX,
    monsterLungeX,
    attackAnchorDistance,
  };
}

export function isCartethyiaAttackInRange(input: CartethyiaAttackRangeInput): boolean {
  const combat = cartethyiaBattlePack.combat;
  const heroAttackAnchor = input.heroX + combat.heroAttackAnchorX;
  const monsterHurtAnchor = input.monsterX + combat.monsterHurtAnchorX;
  const distance = monsterHurtAnchor - heroAttackAnchor;
  const absoluteDistance = Math.abs(distance);
  return absoluteDistance <= combat.attackGap;
}
