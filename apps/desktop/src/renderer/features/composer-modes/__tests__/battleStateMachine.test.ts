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

  it('技能排队等待普通攻击及受击完成，不计入普通攻击死亡次数', () => {
    const initial = createCartethyiaBattleState();
    const approaching = reduceCartethyiaBattleState(initial, {
      type: 'signal',
      signal: runningSignal({ currentActionSummary: '读取文件' }),
      requiredNormalHits: 4,
    });
    const attacking = completeScene(approaching);
    const queued = reduceCartethyiaBattleState(attacking, {
      type: 'signal',
      signal: runningSignal({ currentActionSummary: '修改代码' }),
    });
    const normalHit = completeScene(queued);
    const skill = completeScene(normalHit);
    const skillHit = completeScene(skill);
    const resumed = completeScene(skillHit);

    expect(queued.cue).toBe('hero-attack');
    expect(queued.epoch).toBe(attacking.epoch);
    expect(queued.skillPending).toBe(true);
    expect(skill.cue).toBe('skill');
    expect(skillHit.cue).toBe('monster-hit');
    expect(skillHit.normalHitsTaken).toBe(1);
    expect(resumed.cue).toBe('hero-attack');
    expect(resumed.normalHitsTaken).toBe(1);
  });

  it('击杀后先原地胜利，再归位等待、刷新怪物，双方再次同时接近', () => {
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
    const victory = completeScene(monsterDeath);
    const advancing = completeScene(victory);
    const waiting = completeScene(advancing);
    const spawning = completeScene(waiting, 10);
    const monsterApproaching = completeScene(spawning);
    const nextAttack = completeScene(monsterApproaching);

    expect(victory.cue).toBe('victory');
    expect(advancing.cue).toBe('hero-return');
    expect(waiting.cue).toBe('respawn-wait');
    expect(waiting.encounterId).toBe(monsterDeath.encounterId);
    expect(spawning.encounterId).toBe(monsterDeath.encounterId + 1);
    expect(spawning.cue).toBe('monster-spawn');
    expect(spawning.requiredNormalHits).toBe(10);
    expect(spawning.normalHitsTaken).toBe(0);
    expect(monsterApproaching.cue).toBe('hero-approach');
    expect(nextAttack.cue).toBe('hero-attack');
  });

  it('任务成功会结束当前怪物，胜利后归位空闲，不再生成下一只', () => {
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
    const returning = completeScene(victory);
    const idle = completeScene(returning, 8);
    const stableIdle = completeScene(idle);

    expect(terminal.cue).toBe('monster-death');
    expect(returning.cue).toBe('hero-return');
    expect(victory.cue).toBe('victory');
    expect(idle.cue).toBe('idle');
    expect(stableIdle).toBe(idle);
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

  it('命中帧只结算一次，过期命中不会影响下一段攻击', () => {
    const initial = createCartethyiaBattleState();
    const signal = runningSignal();
    const approaching = reduceCartethyiaBattleState(initial, { type: 'signal', signal });
    const attacking = completeScene(approaching);
    const impactEvent = { type: 'attack-impact' as const, epoch: attacking.epoch };
    const hit = reduceCartethyiaBattleState(attacking, impactEvent);
    const duplicate = reduceCartethyiaBattleState(hit, impactEvent);
    const recovering = completeScene(hit);
    const stale = reduceCartethyiaBattleState(recovering, impactEvent);
    expect(hit.normalHitsTaken).toBe(1);
    expect(hit.impact?.damage).toBe(100);
    expect(duplicate).toBe(hit);
    expect(recovering.normalHitsTaken).toBe(1);
    expect(stale).toBe(recovering);
  });

  it.each(['hero-return', 'respawn-wait'] as const)('任务在 %s 阶段完成不会重新变出怪物', (cue) => {
    const initial = createCartethyiaBattleState();
    const signal = runningSignal();
    const running = reduceCartethyiaBattleState(initial, { type: 'signal', signal });
    const returning: CartethyiaBattleState = { ...running, cue };
    const completedSignal = runningSignal({ phase: 'completed' });
    const completed = reduceCartethyiaBattleState(returning, { type: 'signal', signal: completedSignal });
    const victory = completeScene(completed);
    const stable = completeScene(victory);
    expect(victory.cue).toBe('idle');
    expect(stable).toBe(victory);
    expect(stable.encounterId).toBe(running.encounterId);
  });
});
