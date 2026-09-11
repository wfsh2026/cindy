import { builtinBattleMod } from './builtinBattleMod';
import { useInstalledPersonalMod } from './useInstalledPersonalMod';
import { usePersonalModPreferences } from './usePersonalModPreferences';

/** Bundled artwork is public and stays available independently of account storage. */
export function useAvailablePersonalMod() {
  const installed = useInstalledPersonalMod();
  const { source } = usePersonalModPreferences();
  const builtin = source === 'builtin' || installed.mod === null;
  const mod = builtin ? builtinBattleMod : installed.mod!;
  return { ...installed, mod, builtin };
}
