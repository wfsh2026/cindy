import {
  type AnimationEvent as ReactAnimationEvent,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';

import { useDocumentVisible } from '@/hooks/useWindowVisible';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useAgentIslandActivity } from '@/state/agentIslandActivity';
import type { ComposerModeRenderProps } from '../types';
import { calculateBattleSceneGeometry } from './battleSceneGeometry';
import {
  createCartethyiaBattleState,
  reduceCartethyiaBattleState,
  requiredNormalHitsForRandom,
  type CartethyiaBattleCue,
  type CartethyiaBattleEvent,
  type CartethyiaBattleSignal,
} from './battleStateMachine';
import {
  cartethyiaBattlePack,
  type CartethyiaHeroMotion,
  type CartethyiaMonsterMotion,
} from './cartethyiaBattlePack';
import { SpriteAnimator } from './SpriteAnimator';
import './cartethyia-battle.css';

const SLEEP_DELAY_MS = 20_000;
const DEFAULT_ARENA_WIDTH = 460;

type BattleArenaStyle = CSSProperties & {
  '--cartethyia-hero-start-x': string;
  '--cartethyia-hero-encounter-x': string;
  '--cartethyia-monster-encounter-x': string;
  '--cartethyia-monster-spawn-x': string;
  '--cartethyia-monster-lunge-x': string;
  '--cartethyia-hero-approach-duration': string;
  '--cartethyia-hero-advance-duration': string;
  '--cartethyia-monster-approach-duration': string;
  '--cartethyia-monster-attack-duration': string;
};

function heroMotion(cue: CartethyiaBattleCue): CartethyiaHeroMotion {
  if (cue === 'hero-approach' || cue === 'hero-advance') return 'move';
  if (cue === 'hero-attack') return 'attack';
  if (cue === 'skill') return 'skill';
  if (cue === 'hero-hit') return 'hit';
  if (cue === 'victory') return 'victory';
  if (cue === 'sleep') return 'sleep';
  return 'idle';
}

function monsterMotion(cue: CartethyiaBattleCue): CartethyiaMonsterMotion {
  if (cue === 'monster-hit') return 'hit';
  if (cue === 'monster-death' || cue === 'victory') return 'death';
  return 'idle';
}

function heroAnimationRunsOnce(cue: CartethyiaBattleCue): boolean {
  return cue === 'hero-attack' || cue === 'skill' || cue === 'hero-hit' || cue === 'victory';
}

function monsterAnimationRunsOnce(cue: CartethyiaBattleCue): boolean {
  return cue === 'monster-hit' || cue === 'monster-death' || cue === 'victory';
}

function heroSpriteCompletesScene(cue: CartethyiaBattleCue): boolean {
  return cue === 'hero-attack' || cue === 'skill' || cue === 'hero-hit';
}

function monsterSpriteCompletesScene(cue: CartethyiaBattleCue): boolean {
  return cue === 'monster-hit' || cue === 'monster-death';
}

function cueCompletesAutomatically(cue: CartethyiaBattleCue): boolean {
  return cue !== 'idle' && cue !== 'sleep' && cue !== 'waiting' && cue !== 'victory';
}

function rollRequiredNormalHits(): number {
  const randomValue = Math.random();
  return requiredNormalHitsForRandom(randomValue);
}

export function CartethyiaBattleStage({
  sessionId,
  active,
  compact,
  stopGeneration,
}: ComposerModeRenderProps) {
  const activity = useAgentIslandActivity(sessionId ?? '__cartethyia-composer-mode__');
  const documentVisible = useDocumentVisible();
  const reducedMotion = useReducedMotion();
  const signal = useMemo<CartethyiaBattleSignal | null>(() => {
    if (!activity) return null;
    return {
      phase: activity.phase,
      turnKey: activity.startedAtMs,
      currentActionSummary: activity.currentActionSummary,
    };
  }, [activity]);
  const [battle, dispatch] = useReducer(
    reduceCartethyiaBattleState,
    undefined,
    createCartethyiaBattleState,
  );
  const arenaRef = useRef<HTMLDivElement>(null);
  const previousStopGenerationRef = useRef(stopGeneration);
  const [arenaWidth, setArenaWidth] = useState(DEFAULT_ARENA_WIDTH);
  const motionEnabled = !reducedMotion;
  const scenePlaying = active && documentVisible;
  const waiting = battle.signal?.phase === 'needs-interaction' || battle.cue === 'waiting';
  const sceneMotionPlaying = scenePlaying && !waiting;
  const animationPlaying = sceneMotionPlaying && motionEnabled;
  const geometry = useMemo(
    () => calculateBattleSceneGeometry(arenaWidth, compact),
    [arenaWidth, compact],
  );

  useEffect(() => {
    let requiredNormalHits: number | undefined;
    if (signal?.phase === 'running') requiredNormalHits = rollRequiredNormalHits();
    const event: CartethyiaBattleEvent = { type: 'signal', signal, requiredNormalHits };
    dispatch(event);
  }, [signal]);

  useEffect(() => {
    if (stopGeneration === previousStopGenerationRef.current) return;
    previousStopGenerationRef.current = stopGeneration;
    const event: CartethyiaBattleEvent = { type: 'stopped', generation: stopGeneration };
    dispatch(event);
  }, [stopGeneration]);

  useEffect(() => {
    const arena = arenaRef.current;
    if (!arena) return;
    const updateWidth = (width: number) => {
      if (width <= 0) return;
      setArenaWidth((current) => {
        const difference = Math.abs(current - width);
        return difference < 1 ? current : width;
      });
    };
    const initialBounds = arena.getBoundingClientRect();
    updateWidth(initialBounds.width);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    });
    observer.observe(arena);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!scenePlaying || battle.cue !== 'idle' || battle.signal) return;
    const epoch = battle.epoch;
    const completeSleep = () => {
      const event: CartethyiaBattleEvent = { type: 'sleep', epoch };
      dispatch(event);
    };
    const timeout = window.setTimeout(completeSleep, SLEEP_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [battle.cue, battle.epoch, battle.signal, scenePlaying]);

  useEffect(() => {
    if (!sceneMotionPlaying) return;
    const spawnWaiting = battle.cue === 'monster-spawn';
    const reducedScene = reducedMotion && cueCompletesAutomatically(battle.cue);
    if (!spawnWaiting && !reducedScene) return;
    const epoch = battle.epoch;
    const duration = spawnWaiting
      ? cartethyiaBattlePack.combat.monsterSpawnDelayMs
      : cartethyiaBattlePack.combat.reducedMotionSceneDurationMs;
    const completeScene = () => {
      let nextRequiredNormalHits: number | undefined;
      if (battle.cue === 'hero-advance') nextRequiredNormalHits = rollRequiredNormalHits();
      const event: CartethyiaBattleEvent = {
        type: 'scene-completed',
        epoch,
        nextRequiredNormalHits,
      };
      dispatch(event);
    };
    const timeout = window.setTimeout(completeScene, duration);
    return () => window.clearTimeout(timeout);
  }, [battle.cue, battle.epoch, reducedMotion, sceneMotionPlaying]);

  const completeCurrentScene = useCallback(
    (nextRequiredNormalHits?: number) => {
      const event: CartethyiaBattleEvent = {
        type: 'scene-completed',
        epoch: battle.epoch,
        nextRequiredNormalHits,
      };
      dispatch(event);
    },
    [battle.epoch],
  );

  const handleHeroSpriteAnimationEnd = useCallback(() => {
    if (!heroSpriteCompletesScene(battle.cue)) return;
    completeCurrentScene();
  }, [battle.cue, completeCurrentScene]);

  const handleMonsterSpriteAnimationEnd = useCallback(() => {
    if (!monsterSpriteCompletesScene(battle.cue)) return;
    completeCurrentScene();
  }, [battle.cue, completeCurrentScene]);

  const handleHeroActorAnimationEnd = useCallback(
    (event: ReactAnimationEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || battle.cue !== 'hero-approach') return;
      completeCurrentScene();
    },
    [battle.cue, completeCurrentScene],
  );

  const handleMonsterActorAnimationEnd = useCallback(
    (event: ReactAnimationEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget) return;
      if (battle.cue !== 'monster-approach' && battle.cue !== 'monster-attack') return;
      completeCurrentScene();
    },
    [battle.cue, completeCurrentScene],
  );

  const handleGroundAnimationEnd = useCallback(
    (event: ReactAnimationEvent<HTMLDivElement>) => {
      if (event.target !== event.currentTarget || battle.cue !== 'hero-advance') return;
      const nextRequiredNormalHits = rollRequiredNormalHits();
      completeCurrentScene(nextRequiredNormalHits);
    },
    [battle.cue, completeCurrentScene],
  );

  const currentHeroMotion = heroMotion(battle.cue);
  const currentMonsterMotion = monsterMotion(battle.cue);
  const hero = cartethyiaBattlePack.hero[currentHeroMotion];
  const monster = cartethyiaBattlePack.monster[currentMonsterMotion];
  const heroOnce = heroAnimationRunsOnce(battle.cue);
  const monsterOnce = monsterAnimationRunsOnce(battle.cue);
  const heroCompletesScene = heroSpriteCompletesScene(battle.cue);
  const monsterCompletesScene = monsterSpriteCompletesScene(battle.cue);
  const heroFinalFrame = reducedMotion && heroOnce;
  const monsterFinalFrame = reducedMotion && monsterOnce;
  const pausedClassName = sceneMotionPlaying ? '' : ' cartethyia-battle__motion--paused';
  const rootClassName = compact
    ? 'cartethyia-battle cartethyia-battle--compact'
    : 'cartethyia-battle';
  const combat = cartethyiaBattlePack.combat;
  const arenaStyle: BattleArenaStyle = {
    '--cartethyia-hero-start-x': `${geometry.heroStartX}px`,
    '--cartethyia-hero-encounter-x': `${geometry.heroEncounterX}px`,
    '--cartethyia-monster-encounter-x': `${geometry.monsterEncounterX}px`,
    '--cartethyia-monster-spawn-x': `${geometry.monsterSpawnX}px`,
    '--cartethyia-monster-lunge-x': `${geometry.monsterLungeX}px`,
    '--cartethyia-hero-approach-duration': `${combat.heroApproachDurationMs}ms`,
    '--cartethyia-hero-advance-duration': `${combat.heroAdvanceDurationMs}ms`,
    '--cartethyia-monster-approach-duration': `${combat.monsterApproachDurationMs}ms`,
    '--cartethyia-monster-attack-duration': `${combat.monsterAttackDurationMs}ms`,
  };

  return (
    <div
      className={rootClassName}
      data-composer-mode="cartethyia-battle"
      data-battle-cue={battle.cue}
      data-encounter-id={battle.encounterId}
      data-normal-hits={battle.normalHitsTaken}
      data-required-normal-hits={battle.requiredNormalHits}
      aria-hidden="true"
    >
      <div ref={arenaRef} className="cartethyia-battle__arena" style={arenaStyle}>
        <div className="cartethyia-battle__ground-viewport">
          <div
            key={`ground-${battle.epoch}`}
            className={`cartethyia-battle__ground-track${pausedClassName}`}
            onAnimationEnd={handleGroundAnimationEnd}
          >
            <img
              src={cartethyiaBattlePack.groundPlatformUrl}
              alt=""
              draggable={false}
              className="cartethyia-battle__ground"
            />
            <img
              src={cartethyiaBattlePack.groundPlatformUrl}
              alt=""
              draggable={false}
              className="cartethyia-battle__ground"
            />
          </div>
        </div>
        <div
          key={`hero-actor-${battle.epoch}`}
          className={`cartethyia-battle__actor cartethyia-battle__hero-actor${pausedClassName}`}
          onAnimationEnd={handleHeroActorAnimationEnd}
        >
          <SpriteAnimator
            animation={hero}
            enabled={motionEnabled}
            playing={animationPlaying}
            once={heroOnce}
            finalFrame={heroFinalFrame}
            className="cartethyia-battle__hero"
            onAnimationEnd={heroCompletesScene ? handleHeroSpriteAnimationEnd : undefined}
          />
        </div>
        <div
          key={`monster-actor-${battle.encounterId}-${battle.epoch}`}
          className={`cartethyia-battle__actor cartethyia-battle__monster-actor${pausedClassName}`}
          onAnimationEnd={handleMonsterActorAnimationEnd}
        >
          <SpriteAnimator
            animation={monster}
            enabled={motionEnabled}
            playing={animationPlaying}
            once={monsterOnce}
            finalFrame={monsterFinalFrame}
            className="cartethyia-battle__monster"
            onAnimationEnd={monsterCompletesScene ? handleMonsterSpriteAnimationEnd : undefined}
          />
        </div>
      </div>
    </div>
  );
}
