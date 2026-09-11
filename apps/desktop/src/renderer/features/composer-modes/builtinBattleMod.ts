import type { InstalledPersonalMod } from '../../../shared/personalMod';
import ground from '../../../../../../mods/cartethyia-battle/assets/ground-platform-v2.png';
import heroIdle from '../../../../../../mods/cartethyia-battle/assets/hero-idle.png';
import heroMove from '../../../../../../mods/cartethyia-battle/assets/hero-move.png';
import heroAttack from '../../../../../../mods/cartethyia-battle/assets/hero-attack-v2.png';
import heroSkill from '../../../../../../mods/cartethyia-battle/assets/hero-skill-v2.png';
import heroHit from '../../../../../../mods/cartethyia-battle/assets/hero-hit-v2.png';
import heroVictory from '../../../../../../mods/cartethyia-battle/assets/hero-victory-v2.png';
import heroSleep from '../../../../../../mods/cartethyia-battle/assets/hero-sleep.png';
import monsterIdle from '../../../../../../mods/cartethyia-battle/assets/monster-idle-v2.png';
import monsterHit from '../../../../../../mods/cartethyia-battle/assets/monster-hit-v2.png';
import monsterDeath from '../../../../../../mods/cartethyia-battle/assets/monster-death-v2.png';
import arc from '../../../../../../mods/cartethyia-battle/assets/effect-arc.png';
import energy from '../../../../../../mods/cartethyia-battle/assets/effect-energy.png';
import impact from '../../../../../../mods/cartethyia-battle/assets/effect-impact.png';
import shard from '../../../../../../mods/cartethyia-battle/assets/effect-shard.png';

export const builtinBattleMod: InstalledPersonalMod = {
  id: 'cartethyia-battle', version: '1.0.0', revision: '00000000-0000-4000-8000-000000000001',
  assets: { ground, heroIdle, heroMove, heroAttack, heroSkill, heroHit, heroVictory, heroSleep, monsterIdle, monsterHit, monsterDeath, arc, energy, impact, shard },
};
