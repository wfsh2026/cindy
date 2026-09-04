import type { CSSProperties } from 'react';

import { cn } from '@/lib/utils';
import type { CartethyiaSpriteAnimation } from './cartethyiaBattlePack';
import { cartethyiaBattlePack } from './cartethyiaBattlePack';

interface SpriteAnimatorProps {
  animation: CartethyiaSpriteAnimation;
  enabled: boolean;
  playing: boolean;
  once?: boolean;
  finalFrame?: boolean;
  className?: string;
  onAnimationEnd?: () => void;
}

type SpriteStyle = CSSProperties & {
  '--cartethyia-loop-travel': string;
  '--cartethyia-once-travel': string;
  '--cartethyia-duration': string;
  '--cartethyia-steps': number;
};

export function SpriteAnimator({
  animation,
  enabled,
  playing,
  once = false,
  finalFrame = false,
  className,
  onAnimationEnd,
}: SpriteAnimatorProps) {
  const displayWidth = cartethyiaBattlePack.displayWidth;
  const displayHeight = cartethyiaBattlePack.displayHeight;
  const stripWidth = displayWidth * animation.frameCount;
  const lastFrameOffset = displayWidth * (animation.frameCount - 1);
  const translate = finalFrame ? `translate3d(-${lastFrameOffset}px, 0, 0)` : undefined;
  const style: SpriteStyle = {
    width: `${stripWidth}px`,
    height: `${displayHeight}px`,
    transform: enabled ? undefined : translate,
    '--cartethyia-loop-travel': `-${stripWidth}px`,
    '--cartethyia-once-travel': `-${lastFrameOffset}px`,
    '--cartethyia-duration': `${animation.durationMs}ms`,
    '--cartethyia-steps': once ? Math.max(1, animation.frameCount - 1) : animation.frameCount,
  };

  return (
    <div
      className={cn('cartethyia-battle__sprite-window', className)}
      style={{ width: displayWidth, height: displayHeight }}
    >
      <img
        src={animation.url}
        alt=""
        draggable={false}
        className={cn(
          'cartethyia-battle__sprite-strip',
          enabled &&
            (once
              ? 'cartethyia-battle__sprite-strip--once'
              : 'cartethyia-battle__sprite-strip--loop'),
          enabled && !playing && 'cartethyia-battle__sprite-strip--paused',
        )}
        style={style}
        onAnimationEnd={onAnimationEnd}
      />
    </div>
  );
}
