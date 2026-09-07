import { describe, expect, it } from 'vitest';

import {
  calculateBattleSceneGeometry,
  isCartethyiaAttackInRange,
} from '../cartethyia-battle/battleSceneGeometry';

describe('Cartethyia battle scene geometry', () => {
  it('角色出生点在攻击范围外，接战点在攻击范围内', () => {
    const geometry = calculateBattleSceneGeometry(460, false);
    const startRange = isCartethyiaAttackInRange({
      heroX: geometry.heroStartX,
      monsterX: geometry.monsterEncounterX,
    });
    const encounterRange = isCartethyiaAttackInRange({
      heroX: geometry.heroEncounterX,
      monsterX: geometry.monsterEncounterX,
    });

    expect(startRange).toBe(false);
    expect(encounterRange).toBe(true);
    expect(geometry.attackAnchorDistance).toBe(10);
  });

  it('窄输入框仍保持怪物在最右侧生成并移动到中央接战点', () => {
    const geometry = calculateBattleSceneGeometry(320, true);

    expect(geometry.monsterSpawnX).toBe(192);
    expect(geometry.monsterSpawnX).toBeGreaterThan(geometry.monsterEncounterX);
    expect(geometry.monsterEncounterX).toBeLessThan(320);
    expect(geometry.heroEncounterX).toBeGreaterThan(geometry.heroStartX);
  });

  it.each([252, 320, 460, 800, 1200])('宽度 %i 时双方攻击锚点在容器中心两侧', (width) => {
    const geometry = calculateBattleSceneGeometry(width, false);
    const heroAttackX = geometry.heroEncounterX + 82;
    const monsterHurtX = geometry.monsterEncounterX + 32;
    const center = (heroAttackX + monsterHurtX) / 2;
    expect(center).toBe(width / 2);
    expect(geometry.heroEncounterX).toBeGreaterThan(geometry.heroStartX);
    expect(geometry.monsterEncounterX).toBeLessThan(geometry.monsterSpawnX);
    expect(geometry.attackAnchorDistance).toBe(10);
  });
});
