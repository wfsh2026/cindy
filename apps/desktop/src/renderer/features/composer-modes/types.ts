import type { ComponentType, ReactNode } from 'react';

export type ComposerModeId = 'standard' | 'cartethyia-battle';
export type PersonalModId = Exclude<ComposerModeId, 'standard'>;
export type ModDisplayOption = 'character' | 'battle' | 'ground' | 'damage' | 'effects' | 'idle';
export type ModDisplayOptions = Record<ModDisplayOption, boolean>;

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
  nameKey: string;
  descriptionKey: string;
  locationKey: string;
  options: readonly ModDisplayOption[];
  preview: ComponentType<{ onComplete: () => void; mod?: import('../../../shared/personalMod').InstalledPersonalMod }>;
}
