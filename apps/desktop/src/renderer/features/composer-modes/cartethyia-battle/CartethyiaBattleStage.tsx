import { type CSSProperties, useEffect, useReducer, useRef, useState } from 'react';

import { useDocumentVisible } from '@/hooks/useWindowVisible';
import { useReducedMotion } from '@/hooks/useReducedMotion';
import { useAgentIslandActivity } from '@/state/agentIslandActivity';
import type { ComposerModeRenderProps } from '../types';
import type { ModDisplayOptions } from '../types';
import { usePersonalModPreferences } from '../usePersonalModPreferences';
import { useInstalledPersonalMod } from '../useInstalledPersonalMod';
import type { InstalledPersonalMod } from '../../../../shared/personalMod';
import { calculateBattleSceneGeometry } from './battleSceneGeometry';
import { createCartethyiaBattleState, reduceCartethyiaBattleState, requiredNormalHitsForRandom } from './battleStateMachine';
import type { CartethyiaBattleCue, CartethyiaBattleEvent, CartethyiaBattleSignal } from './battleStateMachine';
import { resolveCartethyiaBattlePack, type CartethyiaHeroMotion, type CartethyiaMonsterMotion } from './cartethyiaBattlePack';
import { SpriteAnimator } from './SpriteAnimator';
import { useBattleSceneClock } from './useBattleSceneClock';
import './cartethyia-battle.css';

const SLEEP_DELAY_MS = 20_000;
const DEFAULT_ARENA_WIDTH = 460;
type BattleArenaStyle = CSSProperties & Record<`--cartethyia-${string}`, string>;

function heroMotion(cue: CartethyiaBattleCue): CartethyiaHeroMotion {
  if (cue === 'hero-approach' || cue === 'hero-return') return 'move';
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

export function CartethyiaBattleStage(props: ComposerModeRenderProps) {
  const { sessionId } = props;
  const activitySessionId = sessionId ?? '__cartethyia-composer-mode__';
  const activity = useAgentIslandActivity(activitySessionId);
  const { display } = usePersonalModPreferences();
  const { mod } = useInstalledPersonalMod();
  if (!mod) return null;
  return <CartethyiaBattleScene key={mod.revision} {...props} activity={activity} display={display} assets={mod.assets} />;
}

interface BattleSceneProps extends ComposerModeRenderProps {
  activity: { phase: CartethyiaBattleSignal['phase']; startedAtMs: number | null; currentActionSummary: string | null } | null | undefined;
  display: ModDisplayOptions;
  assets: InstalledPersonalMod['assets'];
  onComplete?: () => void;
}

const PREVIEW_ACTIVITY = { phase: 'running', startedAtMs: 1, currentActionSummary: null } as const;

export function CartethyiaBattlePreview({ onComplete }: { onComplete: () => void }) {
  const { display } = usePersonalModPreferences();
  const { mod } = useInstalledPersonalMod();
  if (!mod) return null;
  return <CartethyiaBattleScene key={mod.revision} sessionId={null} active compact={false} stopGeneration={0} activity={PREVIEW_ACTIVITY} display={display} assets={mod.assets} onComplete={onComplete} />;
}

function CartethyiaBattleScene({ active, compact, stopGeneration, activity, display, assets, onComplete }: BattleSceneProps) {
  const cartethyiaBattlePack = resolveCartethyiaBattlePack(assets);
  const documentVisible = useDocumentVisible();
  const reducedMotion = useReducedMotion();
  const [battle, dispatch] = useReducer(reduceCartethyiaBattleState, undefined, createCartethyiaBattleState);
  const arenaRef = useRef<HTMLDivElement>(null);
  const previousStopGenerationRef = useRef(stopGeneration);
  const [arenaWidth, setArenaWidth] = useState(DEFAULT_ARENA_WIDTH);
  const motionEnabled = !reducedMotion;
  const sceneVisible = display.idle || (battle.cue !== 'idle' && battle.cue !== 'sleep');
  const scenePlaying = active && documentVisible && sceneVisible;
  const waiting = battle.signal?.phase === 'needs-interaction' || battle.cue === 'waiting';
  const sceneMotionPlaying = scenePlaying && !waiting;
  const animationPlaying = sceneMotionPlaying && motionEnabled;
  const geometry = calculateBattleSceneGeometry(arenaWidth, compact);

  const finishPreview = () => {
    if (battle.cue === 'respawn-wait') onComplete?.();
  };
  useEffect(finishPreview, [battle.cue, onComplete]);

  const synchronizeActivity = () => {
    const signal: CartethyiaBattleSignal | null = activity ? {
      phase: activity.phase,
      turnKey: activity.startedAtMs,
      currentActionSummary: activity.currentActionSummary,
    } : null;
    let requiredNormalHits: number | undefined;
    if (signal?.phase === 'running') {
      const randomValue = Math.random();
      requiredNormalHits = requiredNormalHitsForRandom(randomValue);
    }
    const event: CartethyiaBattleEvent = { type: 'signal', signal, requiredNormalHits };
    dispatch(event);
  };
  useEffect(synchronizeActivity, [activity]);

  const synchronizeStop = () => {
    if (stopGeneration === previousStopGenerationRef.current) return;
    previousStopGenerationRef.current = stopGeneration;
    const event: CartethyiaBattleEvent = { type: 'stopped', generation: stopGeneration };
    dispatch(event);
  };
  useEffect(synchronizeStop, [stopGeneration]);

  const observeArena = () => {
    const arena = arenaRef.current;
    if (!arena) return;
    const updateWidth = (width: number) => {
      if (width <= 0) return;
      const updateCurrentWidth = (current: number) => {
        const difference = Math.abs(current - width);
        return difference < 1 ? current : width;
      };
      setArenaWidth(updateCurrentWidth);
    };
    const initialBounds = arena.getBoundingClientRect();
    updateWidth(initialBounds.width);
    if (typeof ResizeObserver === 'undefined') return;
    const handleResize = (entries: ResizeObserverEntry[]) => {
      const entry = entries[0];
      if (entry) updateWidth(entry.contentRect.width);
    };
    const observer = new ResizeObserver(handleResize);
    observer.observe(arena);
    const disconnectObserver = () => observer.disconnect();
    return disconnectObserver;
  };
  useEffect(observeArena, [sceneVisible]);

  const scheduleSleep = () => {
    if (!scenePlaying || battle.cue !== 'idle' || battle.signal) return;
    const epoch = battle.epoch;
    const completeSleep = () => {
      const event: CartethyiaBattleEvent = { type: 'sleep', epoch };
      dispatch(event);
    };
    const timeout = window.setTimeout(completeSleep, SLEEP_DELAY_MS);
    const cancelSleep = () => window.clearTimeout(timeout);
    return cancelSleep;
  };
  useEffect(scheduleSleep, [battle.cue, battle.epoch, battle.signal, scenePlaying]);

  const clockOptions = { cue: battle.cue, epoch: battle.epoch, playing: sceneMotionPlaying, reducedMotion, dispatch, hitKind: battle.hitKind };
  useBattleSceneClock(clockOptions);

  const impact = battle.impact;
  const currentImpact = impact?.epoch === battle.epoch;
  const heroHitAtContact = currentImpact && impact.target === 'hero';
  const monsterHitAtContact = currentImpact && impact.target === 'monster';
  const currentHeroMotion = heroHitAtContact ? 'hit' : heroMotion(battle.cue);
  const currentMonsterMotion = monsterHitAtContact ? 'hit' : monsterMotion(battle.cue);
  const hero = cartethyiaBattlePack.hero[currentHeroMotion];
  const monster = cartethyiaBattlePack.monster[currentMonsterMotion];
  const heroOnce = currentHeroMotion === 'attack' || currentHeroMotion === 'skill' || currentHeroMotion === 'hit' || currentHeroMotion === 'victory';
  const monsterOnce = currentMonsterMotion === 'hit' || currentMonsterMotion === 'death';
  const pausedClassName = sceneMotionPlaying ? '' : ' cartethyia-battle__motion--paused';
  const rootClassName = compact ? 'cartethyia-battle cartethyia-battle--compact' : 'cartethyia-battle';
  const combat = cartethyiaBattlePack.combat;
  const effects = cartethyiaBattlePack.effects;
  const impactX = impact?.target === 'hero' ? geometry.heroEncounterX + 58 : geometry.monsterEncounterX + 45;
  const damageOffset = impact && impact.epoch % 2 === 0 ? -6 : 6;
  const arenaStyle: BattleArenaStyle = {
    '--cartethyia-hero-start-x': `${geometry.heroStartX}px`,
    '--cartethyia-hero-encounter-x': `${geometry.heroEncounterX}px`,
    '--cartethyia-monster-encounter-x': `${geometry.monsterEncounterX}px`,
    '--cartethyia-monster-spawn-x': `${geometry.monsterSpawnX}px`,
    '--cartethyia-monster-lunge-x': `${geometry.monsterLungeX}px`,
    '--cartethyia-approach-duration': `${combat.approachDurationMs}ms`,
    '--cartethyia-hero-return-duration': `${combat.heroReturnDurationMs}ms`,
    '--cartethyia-monster-attack-duration': `${combat.monsterAttackDurationMs}ms`,
    '--cartethyia-monster-spawn-duration': `${combat.monsterSpawnDelayMs}ms`,
    '--cartethyia-ground-image': `url("${cartethyiaBattlePack.groundPlatformUrl}")`,
    '--cartethyia-impact-x': `${impactX}px`,
    '--cartethyia-damage-offset': `${damageOffset}px`,
    '--cartethyia-monster-effect-x': `${geometry.monsterEncounterX}px`,
  };
  const monsterVisible = battle.cue !== 'idle' && battle.cue !== 'sleep' && battle.cue !== 'waiting'
    && battle.cue !== 'hero-return' && battle.cue !== 'respawn-wait' && battle.cue !== 'victory';

  if (!sceneVisible) return null;

  return (
    <div className={rootClassName} data-composer-mode="cartethyia-battle" data-battle-cue={battle.cue}
      data-encounter-id={battle.encounterId} data-normal-hits={battle.normalHitsTaken}
      data-required-normal-hits={battle.requiredNormalHits}
      data-impact-target={impact?.epoch === battle.epoch ? impact.target : undefined} aria-hidden="true">
      <div ref={arenaRef} className="cartethyia-battle__arena" style={arenaStyle}>
        {display.ground && <div className="cartethyia-battle__ground" />}
        <div className={`cartethyia-battle__actor cartethyia-battle__hero-actor${pausedClassName}`}>
          <SpriteAnimator animation={hero} enabled={motionEnabled} playing={animationPlaying}
            once={heroOnce} finalFrame={reducedMotion && heroOnce} className="cartethyia-battle__hero" />
        </div>
        {monsterVisible && (
          <div className={`cartethyia-battle__actor cartethyia-battle__monster-actor${pausedClassName}`}>
            <SpriteAnimator animation={monster} enabled={motionEnabled} playing={animationPlaying}
              once={monsterOnce} finalFrame={reducedMotion && monsterOnce} className="cartethyia-battle__monster" />
          </div>
        )}
        {impact && (display.damage || display.effects) && (
          <div key={`impact-${impact.epoch}`} className={`cartethyia-battle__impact${pausedClassName}`}
            data-hit-kind={impact.kind} data-hit-target={impact.target}>
            {display.damage && <span className="cartethyia-battle__damage">−{impact.damage}</span>}
            {display.effects && <div className="cartethyia-battle__contact-effect">
              <SpriteAnimator animation={effects.impact} enabled={motionEnabled} playing={animationPlaying} once />
            </div>}
            {display.effects && impact.target === 'monster' && (
              <div className="cartethyia-battle__slash-effect">
                <SpriteAnimator animation={effects.arc} enabled={motionEnabled} playing={animationPlaying} once />
              </div>
            )}
            {display.effects && impact.kind === 'skill' && (
              <div className="cartethyia-battle__energy-effect">
                <SpriteAnimator animation={effects.energy} enabled={motionEnabled} playing={animationPlaying} once />
              </div>
            )}
          </div>
        )}
        {display.effects && battle.cue === 'monster-death' && (
          <div key={`shards-${battle.epoch}`} className={`cartethyia-battle__death-effect${pausedClassName}`}>
            <SpriteAnimator animation={effects.shard} enabled={motionEnabled} playing={animationPlaying} once />
          </div>
        )}
      </div>
    </div>
  );
}
