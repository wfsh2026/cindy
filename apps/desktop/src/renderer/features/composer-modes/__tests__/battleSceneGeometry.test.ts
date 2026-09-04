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

  it('窄输入框仍保持怪物从右侧外生成并移动到接战点', () => {
    const geometry = calculateBattleSceneGeometry(320, true);

    expect(geometry.monsterSpawnX).toBeGreaterThan(320);
    expect(geometry.monsterEncounterX).toBeLessThan(320);
    expect(geometry.heroEncounterX).toBeGreaterThan(geometry.heroStartX);
  });
});
