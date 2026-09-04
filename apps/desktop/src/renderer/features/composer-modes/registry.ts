import { CartethyiaBattleStage } from './cartethyia-battle';
import type { ComposerModeDefinition, ComposerModeId } from './types';

const definitions: readonly ComposerModeDefinition[] = [
  {
    id: 'cartethyia-battle',
    component: CartethyiaBattleStage,
  },
];

export function getComposerModeDefinition(mode: ComposerModeId): ComposerModeDefinition | null {
  return definitions.find((definition) => definition.id === mode) ?? null;
}
