import { createContext, useContext } from 'react';

import { getComposerModeDefinition } from './registry';
import { usePersonalModPreferences } from './usePersonalModPreferences';
import { ModErrorBoundary } from './ModErrorBoundary';
import { useInstalledPersonalMod } from './useInstalledPersonalMod';
import type { ComposerModeHostProps, ComposerModeId, ComposerModeRenderProps } from './types';

const ComposerModeContext = createContext<ComposerModeId>('standard');

export function ComposerModeHost({ mode, children }: ComposerModeHostProps) {
  return <ComposerModeContext.Provider value={mode}>{children}</ComposerModeContext.Provider>;
}

export function ComposerModeSlot(props: ComposerModeRenderProps) {
  const mode = useContext(ComposerModeContext);
  const { enabled } = usePersonalModPreferences();
  const { mod } = useInstalledPersonalMod();
  const definition = getComposerModeDefinition(mode);
  if (!definition || !enabled || !mod) return null;
  const ModeComponent = definition.component;
  const modeInstanceKey = `${definition.id}:${mod.revision}:${props.sessionId ?? 'draft'}`;
  return <ModErrorBoundary key={modeInstanceKey}><ModeComponent {...props} /></ModErrorBoundary>;
}
