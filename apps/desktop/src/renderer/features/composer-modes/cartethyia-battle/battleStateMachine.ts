import type { AgentIslandSessionPhase } from '../../../../shared/agentIsland';

export const CARTETHYIA_MIN_NORMAL_HITS = 3;
export const CARTETHYIA_MAX_NORMAL_HITS = 10;

export type CartethyiaBattleCue =
  | 'idle'
  | 'sleep'
  | 'waiting'
  | 'hero-approach'
  | 'hero-attack'
  | 'skill'
  | 'monster-hit'
  | 'monster-attack'
  | 'hero-hit'
  | 'monster-death'
  | 'hero-return'
  | 'respawn-wait'
  | 'monster-spawn'
  | 'victory';

export interface CartethyiaBattleSignal {
  phase: AgentIslandSessionPhase;
  turnKey: number | null;
  currentActionSummary: string | null;
}

type CartethyiaBattleHitKind = 'normal' | 'skill' | null;
type CartethyiaBattleTerminal = 'completed' | 'error' | null;

export interface CartethyiaBattleImpact {
  epoch: number;
  target: 'hero' | 'monster';
  kind: 'normal' | 'skill';
  damage: number;
}

/**
 * Keeps the decorative encounter loop independent from the task lifecycle. Task signals can
 * interrupt a scene, while epoch prevents late animation callbacks from advancing a newer scene.
 */
export interface CartethyiaBattleState {
  cue: CartethyiaBattleCue;
  epoch: number;
  signal: CartethyiaBattleSignal | null;
  initialized: boolean;
  terminalSuppressed: boolean;
  suppressedTurnKey: number | null;
  stopGeneration: number;
  encounterId: number;
  requiredNormalHits: number;
  normalHitsTaken: number;
  hitKind: CartethyiaBattleHitKind;
  terminalRequested: CartethyiaBattleTerminal;
  impact: CartethyiaBattleImpact | null;
  skillPending: boolean;
}

export type CartethyiaBattleEvent =
  | {
      type: 'signal';
      signal: CartethyiaBattleSignal | null;
      requiredNormalHits?: number;
    }
  | { type: 'stopped'; generation: number }
  | { type: 'scene-completed'; epoch: number; nextRequiredNormalHits?: number }
  | { type: 'attack-impact'; epoch: number }
  | { type: 'sleep'; epoch: number };

export function requiredNormalHitsForRandom(randomValue: number): number {
  const lowerBounded = Math.max(0, randomValue);
  const maximumRandomValue = 1 - Number.EPSILON;
  const normalized = Math.min(maximumRandomValue, lowerBounded);
  const possibleHitCounts = CARTETHYIA_MAX_NORMAL_HITS - CARTETHYIA_MIN_NORMAL_HITS + 1;
  const randomOffset = Math.floor(normalized * possibleHitCounts);
  return CARTETHYIA_MIN_NORMAL_HITS + randomOffset;
}

export function createCartethyiaBattleState(): CartethyiaBattleState {
  return {
    cue: 'idle',
    epoch: 0,
    signal: null,
    initialized: false,
    terminalSuppressed: false,
    suppressedTurnKey: null,
    stopGeneration: 0,
    encounterId: 0,
    requiredNormalHits: CARTETHYIA_MIN_NORMAL_HITS,
    normalHitsTaken: 0,
    hitKind: null,
    terminalRequested: null,
    impact: null,
    skillPending: false,
  };
}

function sameSignal(
  previous: CartethyiaBattleSignal | null,
  current: CartethyiaBattleSignal | null,
): boolean {
  if (!previous || !current) return previous === current;
  return (
    previous.phase === current.phase &&
    previous.turnKey === current.turnKey &&
    previous.currentActionSummary === current.currentActionSummary
  );
}

function normalizeRequiredNormalHits(value: number | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return CARTETHYIA_MIN_NORMAL_HITS;
  const rounded = Math.round(value);
  const lowerBounded = Math.max(CARTETHYIA_MIN_NORMAL_HITS, rounded);
  return Math.min(CARTETHYIA_MAX_NORMAL_HITS, lowerBounded);
}

function startEncounter(
  state: CartethyiaBattleState,
  signal: CartethyiaBattleSignal,
  requiredNormalHits: number | undefined,
): CartethyiaBattleState {
  const normalizedHits = normalizeRequiredNormalHits(requiredNormalHits);
  return {
    ...state,
    cue: 'hero-approach',
    epoch: state.epoch + 1,
    signal,
    initialized: true,
    terminalSuppressed: false,
    suppressedTurnKey: null,
    encounterId: state.encounterId + 1,
    requiredNormalHits: normalizedHits,
    normalHitsTaken: 0,
    hitKind: null,
    terminalRequested: null,
    impact: null,
    skillPending: false,
  };
}

function canQueueSkill(cue: CartethyiaBattleCue): boolean {
  return (
    cue === 'hero-attack' || cue === 'monster-hit' || cue === 'monster-attack' || cue === 'hero-hit'
  );
}

function reduceSignal(
  state: CartethyiaBattleState,
  event: Extract<CartethyiaBattleEvent, { type: 'signal' }>,
): CartethyiaBattleState {
  const current = event.signal;
  if (!state.initialized) {
    if (!current) return state;
    const terminal = current.phase === 'completed' || current.phase === 'error';
    if (terminal) return { ...state, signal: current, initialized: true };
    if (current.phase === 'needs-interaction') {
      return { ...state, cue: 'waiting', signal: current, initialized: true };
    }
    return startEncounter(state, current, event.requiredNormalHits);
  }
  if (sameSignal(state.signal, current)) return state;
  if (!current) {
    return {
      ...state,
      cue: 'idle',
      epoch: state.epoch + 1,
      signal: null,
      terminalSuppressed: false,
      suppressedTurnKey: null,
      normalHitsTaken: 0,
      hitKind: null,
      terminalRequested: null,
      impact: null,
      skillPending: false,
    };
  }
  if (state.terminalSuppressed) {
    const newTurnStarted =
      current.phase === 'running' && current.turnKey !== state.suppressedTurnKey;
    if (!newTurnStarted) {
      return { ...state, cue: 'idle', epoch: state.epoch + 1, signal: current };
    }
  }
  if (current.phase === 'completed') {
    if (state.cue === 'hero-return' || state.cue === 'victory' || state.cue === 'monster-death') {
      return { ...state, signal: current, terminalRequested: 'completed' };
    }
    const alreadyHome = state.cue === 'respawn-wait' || state.cue === 'idle' || state.cue === 'sleep' || state.cue === 'waiting';
    return {
      ...state,
      cue: alreadyHome ? 'idle' : 'monster-death',
      epoch: state.epoch + 1,
      signal: current,
      hitKind: null,
      terminalRequested: 'completed',
      impact: null,
    };
  }
  if (current.phase === 'error') {
    if (state.cue === 'hero-return' || state.cue === 'victory' || state.cue === 'monster-death') {
      return { ...state, signal: current, terminalRequested: 'error' };
    }
    const alreadyHome = state.cue === 'respawn-wait' || state.cue === 'idle' || state.cue === 'sleep' || state.cue === 'waiting';
    return {
      ...state,
      cue: alreadyHome ? 'idle' : 'monster-attack',
      epoch: state.epoch + 1,
      signal: current,
      hitKind: null,
      terminalRequested: 'error',
      impact: null,
    };
  }
  if (current.phase === 'needs-interaction') {
    if (state.cue === 'idle' || state.cue === 'sleep' || state.cue === 'waiting') {
      return { ...state, cue: 'waiting', epoch: state.epoch + 1, signal: current };
    }
    return { ...state, signal: current };
  }

  const resumingPausedScene =
    state.signal?.phase === 'needs-interaction' && current.turnKey === state.signal.turnKey;
  if (resumingPausedScene && state.cue !== 'waiting') return { ...state, signal: current };
  if (resumingPausedScene) return startEncounter(state, current, event.requiredNormalHits);
  const newTurnStarted =
    state.signal?.phase !== 'running' || current.turnKey !== state.signal.turnKey;
  if (newTurnStarted) return startEncounter(state, current, event.requiredNormalHits);
  const summaryChanged =
    current.currentActionSummary !== null &&
    current.currentActionSummary !== state.signal?.currentActionSummary;
  if (summaryChanged && canQueueSkill(state.cue)) {
    return { ...state, signal: current, skillPending: true };
  }
  return { ...state, signal: current };
}

function completeScene(
  state: CartethyiaBattleState,
  event: Extract<CartethyiaBattleEvent, { type: 'scene-completed' }>,
): CartethyiaBattleState {
  if (event.epoch !== state.epoch || state.signal?.phase === 'needs-interaction') return state;
  if (state.cue === 'hero-approach') {
    return { ...state, cue: 'hero-attack', epoch: state.epoch + 1 };
  }
  if (state.cue === 'hero-attack') {
    return {
      ...state,
      cue: 'monster-hit',
      epoch: state.epoch + 1,
      normalHitsTaken: state.impact?.epoch === state.epoch ? state.normalHitsTaken : state.normalHitsTaken + 1,
      hitKind: 'normal',
    };
  }
  if (state.cue === 'skill') {
    return { ...state, cue: 'monster-hit', epoch: state.epoch + 1, hitKind: 'skill' };
  }
  if (state.cue === 'monster-hit') {
    if (state.normalHitsTaken >= state.requiredNormalHits) {
      return { ...state, cue: 'monster-death', epoch: state.epoch + 1, hitKind: null, skillPending: false };
    }
    if (state.hitKind === 'skill') {
      return { ...state, cue: 'hero-attack', epoch: state.epoch + 1, hitKind: null };
    }
    if (state.skillPending) {
      return { ...state, cue: 'skill', epoch: state.epoch + 1, hitKind: null, skillPending: false };
    }
    return { ...state, cue: 'monster-attack', epoch: state.epoch + 1, hitKind: null };
  }
  if (state.cue === 'monster-attack') {
    return { ...state, cue: 'hero-hit', epoch: state.epoch + 1 };
  }
  if (state.cue === 'hero-hit') {
    const nextCue = state.terminalRequested === 'error' ? 'idle' : state.skillPending ? 'skill' : 'hero-attack';
    const impact = nextCue === 'idle' ? null : state.impact;
    return { ...state, cue: nextCue, epoch: state.epoch + 1, impact, skillPending: false };
  }
  if (state.cue === 'monster-death') {
    return { ...state, cue: 'victory', epoch: state.epoch + 1, impact: null, skillPending: false };
  }
  if (state.cue === 'victory') {
    return { ...state, cue: 'hero-return', epoch: state.epoch + 1, impact: null };
  }
  if (state.cue === 'hero-return') {
    const nextCue = state.terminalRequested ? 'idle' : 'respawn-wait';
    return { ...state, cue: nextCue, epoch: state.epoch + 1 };
  }
  if (state.cue === 'respawn-wait') {
    const normalizedHits = normalizeRequiredNormalHits(event.nextRequiredNormalHits);
    return {
      ...state,
      cue: 'monster-spawn',
      epoch: state.epoch + 1,
      encounterId: state.encounterId + 1,
      requiredNormalHits: normalizedHits,
      normalHitsTaken: 0,
      hitKind: null,
    };
  }
  if (state.cue === 'monster-spawn') {
    return { ...state, cue: 'hero-approach', epoch: state.epoch + 1 };
  }
  return state;
}

export function reduceCartethyiaBattleState(
  state: CartethyiaBattleState,
  event: CartethyiaBattleEvent,
): CartethyiaBattleState {
  if (event.type === 'signal') return reduceSignal(state, event);
  if (event.type === 'attack-impact') {
    const attack = state.cue === 'hero-attack' || state.cue === 'skill' || state.cue === 'monster-attack';
    const paused = state.signal?.phase === 'needs-interaction';
    if (!attack || paused || event.epoch !== state.epoch || state.impact?.epoch === event.epoch) return state;
    const target = state.cue === 'monster-attack' ? 'hero' : 'monster';
    const kind = state.cue === 'skill' ? 'skill' : 'normal';
    const damage = target === 'hero' ? 32 : kind === 'skill' ? 200 : 100;
    const normalHitsTaken = state.cue === 'hero-attack' ? state.normalHitsTaken + 1 : state.normalHitsTaken;
    return { ...state, normalHitsTaken, impact: { epoch: event.epoch, target, kind, damage } };
  }
  if (event.type === 'stopped') {
    if (event.generation === state.stopGeneration) return state;
    return {
      ...state,
      cue: 'idle',
      epoch: state.epoch + 1,
      initialized: true,
      terminalSuppressed: true,
      suppressedTurnKey: state.signal?.turnKey ?? null,
      stopGeneration: event.generation,
      normalHitsTaken: 0,
      hitKind: null,
      terminalRequested: null,
      impact: null,
      skillPending: false,
    };
  }
  if (event.type === 'scene-completed') return completeScene(state, event);
  if (event.epoch !== state.epoch || state.signal || state.cue !== 'idle') return state;
  return { ...state, cue: 'sleep', epoch: state.epoch + 1 };
}
