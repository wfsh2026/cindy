import { createContext, useContext } from 'react';

import { getComposerModeDefinition } from './registry';
import type { ComposerModeHostProps, ComposerModeId, ComposerModeRenderProps } from './types';

const ComposerModeContext = createContext<ComposerModeId>('standard');

export function ComposerModeHost({ mode, children }: ComposerModeHostProps) {
  return <ComposerModeContext.Provider value={mode}>{children}</ComposerModeContext.Provider>;
}

export function ComposerModeSlot(props: ComposerModeRenderProps) {
  const mode = useContext(ComposerModeContext);
  const definition = getComposerModeDefinition(mode);
  if (!definition) return null;
  const ModeComponent = definition.component;
  const modeInstanceKey = `${definition.id}:${props.sessionId ?? 'draft'}`;
  return <ModeComponent key={modeInstanceKey} {...props} />;
}
