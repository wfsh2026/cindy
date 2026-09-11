import { CartethyiaBattleStage } from './cartethyia-battle';
import { CartethyiaBattlePreview } from './cartethyia-battle/CartethyiaBattleStage';
import type { ComposerModeDefinition, ComposerModeId } from './types';

export const composerModeDefinitions: readonly ComposerModeDefinition[] = [
  {
    id: 'cartethyia-battle',
    component: CartethyiaBattleStage,
    preview: CartethyiaBattlePreview,
    nameKey: 'settings.personalMods.cartethyiaName',
    descriptionKey: 'settings.personalMods.cartethyiaDescription',
    locationKey: 'settings.personalMods.aboveComposer',
    options: ['character', 'battle', 'ground', 'damage', 'effects', 'idle'],
  },
];

export function getComposerModeDefinition(mode: ComposerModeId): ComposerModeDefinition | null {
  const matchesMode = (definition: ComposerModeDefinition) => definition.id === mode;
  return composerModeDefinitions.find(matchesMode) ?? null;
}
