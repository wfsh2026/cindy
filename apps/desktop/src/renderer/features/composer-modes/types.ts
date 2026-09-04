import type { ComponentType, ReactNode } from 'react';

export type ComposerModeId = 'standard' | 'cartethyia-battle';

export interface ComposerModeHostProps {
  mode: ComposerModeId;
  children: ReactNode;
}

export interface ComposerModeRenderProps {
  sessionId: string | null;
  active: boolean;
  compact: boolean;
  stopGeneration: number;
}

export interface ComposerModeDefinition {
  id: Exclude<ComposerModeId, 'standard'>;
  component: ComponentType<ComposerModeRenderProps>;
}
