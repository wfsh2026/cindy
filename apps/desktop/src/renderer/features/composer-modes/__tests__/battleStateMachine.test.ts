import { describe, expect, it } from 'vitest';

import {
  createCartethyiaBattleState,
  reduceCartethyiaBattleState,
  requiredNormalHitsForRandom,
  type CartethyiaBattleSignal,
  type CartethyiaBattleState,
} from '../cartethyia-battle/battleStateMachine';

function runningSignal(patch: Partial<CartethyiaBattleSignal> = {}): CartethyiaBattleSignal {
  return {
    phase: 'running',
    turnKey: 1,
    currentActionSummary: null,
    ...patch,
  };
}

function completeScene(
  state: CartethyiaBattleState,
  nextRequiredNormalHits?: number,
): CartethyiaBattleState {
  return reduceCartethyiaBattleState(state, {
    type: 'scene-completed',
    epoch: state.epoch,
    nextRequiredNormalHits,
  });
}

function completeNormalExchange(state: CartethyiaBattleState): CartethyiaBattleState {
  const monsterHit = completeScene(state);
  const monsterResponse = completeScene(monsterHit);
  if (monsterResponse.cue === 'monster-death') return monsterResponse;
  const heroHit = completeScene(monsterResponse);
  return completeScene(heroHit);
}

describe('Cartethyia battle state machine', () => {
  it('为每只怪物生成包含边界的 3–10 次普通攻击次数', () => {
    const minimum = requiredNormalHitsForRandom(0);
    const belowNextBucket = requiredNormalHitsForRandom(0.124999);
    const nextBucket = requiredNormalHitsForRandom(0.125);
    const maximum = requiredNormalHitsForRandom(0.999999);
    const clampedMaximum = requiredNormalHitsForRandom(1);

    expect(minimum).toBe(3);
    expect(belowNextBucket).toBe(3);
    expect(nextBucket).toBe(4);
    expect(maximum).toBe(10);
    expect(clampedMaximum).toBe(10);
  });

  it('新任务先让角色接近怪物，到位后才开始普通攻击', () => {
    const initial = createCartethyiaBattleState();
    const approaching = reduceCartethyiaBattleState(initial, {
      type: 'signal',
      signal: runningSignal(),
      requiredNormalHits: 6,
    });
    const attacking = completeScene(approaching);

    expect(approaching.cue).toBe('hero-approach');
    expect(approaching.requiredNormalHits).toBe(6);
    expect(attacking.cue).toBe('hero-attack');
    expect(attacking.normalHitsTaken).toBe(0);
  });

  it('怪物仅在承受随机目标次数的普通攻击后死亡', () => {
    const initial = createCartethyiaBattleState();
    const approaching = reduceCartethyiaBattleState(initial, {
      type: 'signal',
      signal: runningSignal(),
      requiredNormalHits: 3,
    });
    const firstAttack = completeScene(approaching);
    const secondAttack = completeNormalExchange(firstAttack);
    const thirdAttack = completeNormalExchange(secondAttack);
    const monsterDeath = completeNormalExchange(thirdAttack);

    expect(secondAttack.cue).toBe('hero-attack');
    expect(secondAttack.normalHitsTaken).toBe(1);
    expect(thirdAttack.normalHitsTaken).toBe(2);
    expect(monsterDeath.cue).toBe('monster-death');
    expect(monsterDeath.normalHitsTaken).toBe(3);
  });

  it('技能只播放受击反馈，不计入普通攻击死亡次数', () => {
    const initial = createCartethyiaBattleState();
    const approaching = reduceCartethyiaBattleState(initial, {
      type: 'signal',
      signal: runningSignal({ currentActionSummary: '读取文件' }),
      requiredNormalHits: 4,
    });
    const attacking = completeScene(approaching);
    const skill = reduceCartethyiaBattleState(attacking, {
      type: 'signal',
      signal: runningSignal({ currentActionSummary: '修改代码' }),
    });
    const skillHit = completeScene(skill);
    const resumed = completeScene(skillHit);

    expect(skill.cue).toBe('skill');
    expect(skillHit.cue).toBe('monster-hit');
    expect(skillHit.normalHitsTaken).toBe(0);
    expect(resumed.cue).toBe('hero-attack');
    expect(resumed.normalHitsTaken).toBe(0);
  });

  it('击杀动画完成后前进，再生成并等待下一只怪物靠近', () => {
    const initial = createCartethyiaBattleState();
    const approaching = reduceCartethyiaBattleState(initial, {
      type: 'signal',
      signal: runningSignal(),
      requiredNormalHits: 3,
    });
    const firstAttack = completeScene(approaching);
    const secondAttack = completeNormalExchange(firstAttack);
    const thirdAttack = completeNormalExchange(secondAttack);
    const monsterDeath = completeNormalExchange(thirdAttack);
    const advancing = completeScene(monsterDeath);
    const spawning = completeScene(advancing, 10);
    const monsterApproaching = completeScene(spawning);
    const nextAttack = completeScene(monsterApproaching);

    expect(advancing.cue).toBe('hero-advance');
    expect(spawning.cue).toBe('monster-spawn');
    expect(spawning.requiredNormalHits).toBe(10);
    expect(spawning.normalHitsTaken).toBe(0);
    expect(monsterApproaching.cue).toBe('monster-approach');
    expect(nextAttack.cue).toBe('hero-attack');
  });

  it('任务成功会结束当前怪物并停在胜利，不再生成下一只', () => {
    const initial = createCartethyiaBattleState();
    const approaching = reduceCartethyiaBattleState(initial, {
      type: 'signal',
      signal: runningSignal(),
      requiredNormalHits: 5,
    });
    const attacking = completeScene(approaching);
    const terminal = reduceCartethyiaBattleState(attacking, {
      type: 'signal',
      signal: runningSignal({ phase: 'completed' }),
    });
    const victory = completeScene(terminal);
    const stableVictory = completeScene(victory, 8);

    expect(terminal.cue).toBe('monster-death');
    expect(victory.cue).toBe('victory');
    expect(stableVictory).toBe(victory);
  });

  it('任务失败由怪物攻击与角色受击收口到空闲', () => {
    const initial = createCartethyiaBattleState();
    const approaching = reduceCartethyiaBattleState(initial, {
      type: 'signal',
      signal: runningSignal(),
      requiredNormalHits: 7,
    });
    const attacking = completeScene(approaching);
    const monsterAttack = reduceCartethyiaBattleState(attacking, {
      type: 'signal',
      signal: runningSignal({ phase: 'error' }),
    });
    const heroHit = completeScene(monsterAttack);
    const idle = completeScene(heroHit);

    expect(monsterAttack.cue).toBe('monster-attack');
    expect(heroHit.cue).toBe('hero-hit');
    expect(idle.cue).toBe('idle');
  });

  it('等待用户交互时保留当前场景，恢复后从原动画继续', () => {
    const initial = createCartethyiaBattleState();
    const approaching = reduceCartethyiaBattleState(initial, {
      type: 'signal',
      signal: runningSignal(),
      requiredNormalHits: 5,
    });
    const waiting = reduceCartethyiaBattleState(approaching, {
      type: 'signal',
      signal: runningSignal({ phase: 'needs-interaction' }),
    });
    const resumed = reduceCartethyiaBattleState(waiting, {
      type: 'signal',
      signal: runningSignal(),
    });

    expect(waiting.cue).toBe('hero-approach');
    expect(waiting.epoch).toBe(approaching.epoch);
    expect(resumed.cue).toBe('hero-approach');
    expect(resumed.epoch).toBe(approaching.epoch);
  });

  it('主动停止会拒绝旧动画回调和同一任务的迟到终态', () => {
    const initial = createCartethyiaBattleState();
    const approaching = reduceCartethyiaBattleState(initial, {
      type: 'signal',
      signal: runningSignal(),
      requiredNormalHits: 5,
    });
    const oldEpoch = approaching.epoch;
    const stopped = reduceCartethyiaBattleState(approaching, { type: 'stopped', generation: 1 });
    const staleScene = reduceCartethyiaBattleState(stopped, {
      type: 'scene-completed',
      epoch: oldEpoch,
    });
    const lateTerminal = reduceCartethyiaBattleState(staleScene, {
      type: 'signal',
      signal: runningSignal({ phase: 'completed' }),
    });
    const restarted = reduceCartethyiaBattleState(lateTerminal, {
      type: 'signal',
      signal: runningSignal({ turnKey: 2 }),
      requiredNormalHits: 8,
    });

    expect(staleScene).toBe(stopped);
    expect(lateTerminal.cue).toBe('idle');
    expect(restarted.cue).toBe('hero-approach');
    expect(restarted.requiredNormalHits).toBe(8);
  });

  it('仅在当前空闲代次进入睡眠', () => {
    const initial = createCartethyiaBattleState();
    const sleeping = reduceCartethyiaBattleState(initial, {
      type: 'sleep',
      epoch: initial.epoch,
    });
    const staleSleep = reduceCartethyiaBattleState(sleeping, {
      type: 'sleep',
      epoch: initial.epoch,
    });

    expect(sleeping.cue).toBe('sleep');
    expect(staleSleep).toBe(sleeping);
  });
});
