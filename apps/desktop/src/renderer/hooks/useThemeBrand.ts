import { useSyncExternalStore } from 'react';
import { themeService } from '@/themes/theme-service';

function subscribe(listener: () => void): () => void { return themeService.onDidChangeTheme(listener); }
function snapshot() { return themeService.getCurrentTheme(); }

export function useThemeBrand() {
  const theme = useSyncExternalStore(subscribe, snapshot, snapshot);
  return theme?.brand;
}
