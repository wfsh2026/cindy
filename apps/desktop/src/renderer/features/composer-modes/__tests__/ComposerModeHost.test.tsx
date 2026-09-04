// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';

import { ComposerModeHost, ComposerModeSlot } from '../ComposerModeHost';

function installAgentActivityApi(): void {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      platform: 'win32',
      agentIsland: {
        onSessionActivity: () => () => undefined,
      },
    },
  });
}

describe('ComposerModeHost', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'electronAPI');
  });

  it('standard 不挂载舞台，战斗模式通过 registry 插入舞台', () => {
    installAgentActivityApi();
    const view = render(
      <ComposerModeHost mode="standard">
        <ComposerModeSlot sessionId="session-1" active compact={false} stopGeneration={0} />
      </ComposerModeHost>,
    );

    expect(view.container.querySelector('[data-composer-mode]')).toBeNull();

    view.rerender(
      <ComposerModeHost mode="cartethyia-battle">
        <ComposerModeSlot sessionId="session-1" active compact={false} stopGeneration={0} />
      </ComposerModeHost>,
    );

    expect(view.container.querySelector('[data-composer-mode="cartethyia-battle"]')).not.toBeNull();
    const activeSprite = view.container.querySelector('.cartethyia-battle__sprite-strip');
    const pausedWhileActive = activeSprite?.classList.contains('cartethyia-battle__sprite-strip--paused');
    expect(pausedWhileActive).toBe(false);

    view.rerender(
      <ComposerModeHost mode="cartethyia-battle">
        <ComposerModeSlot sessionId="session-1" active={false} compact={false} stopGeneration={0} />
      </ComposerModeHost>,
    );

    const inactiveSprite = view.container.querySelector('.cartethyia-battle__sprite-strip');
    const pausedWhileInactive = inactiveSprite?.classList.contains('cartethyia-battle__sprite-strip--paused');
    expect(pausedWhileInactive).toBe(true);
  });
});
