import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import type { AppearanceAssetKey, AppearanceModManifest, AppearanceSelection } from '../../shared/appearanceMod';
import { atomicWriteFileSync, readAtomicFileSync } from '../utils/atomicWriteFile';
import { getLocalThemesDir } from '../local-themes/loader';
import { readAppearanceManifest, readAppearanceImage } from '../local-themes/appearancePacks';
import { normalizeThemeModOptions, THEME_ASSET_PART, themePartEnabled, type ThemeModOptions } from '../../shared/themeModParts';

function selectionPath(): string {
  const root = app.getPath('userData');
  return path.join(root, 'appearance-mod-selection.json');
}

export function writeAppearanceSelection(value: unknown): void {
  if (!value || typeof value !== 'object') throw new Error('Invalid theme selection');
  const input = value as AppearanceSelection;
  if (typeof input.familyId !== 'string' || input.familyId.length > 256 || /[\u0000-\u001f/\\]/.test(input.familyId) || !input.familyId || (input.type !== 'light' && input.type !== 'dark')) throw new Error('Invalid theme selection');
  const options = normalizeThemeModOptions(input.options);
  const selection = { familyId: input.familyId, type: input.type, ...(input.options ? { options } : {}) };
  const file = selectionPath();
  const raw = JSON.stringify(selection);
  if (readAtomicFileSync(file) !== raw) atomicWriteFileSync(file, raw);
}

function readSelection(): AppearanceSelection {
  const file = selectionPath();
  const raw = readAtomicFileSync(file);
  if (!raw) return { familyId: 'cartethyia', type: 'light' };
  const input = JSON.parse(raw) as AppearanceSelection;
  return input;
}

interface ActiveAppearance { root: string; manifest: AppearanceModManifest; type: 'light' | 'dark'; options: ThemeModOptions }

export function readActiveAppearance(): ActiveAppearance | null {
  try {
    const selection = readSelection();
    const options = normalizeThemeModOptions(selection.options);
    if (selection.type !== 'light' && selection.type !== 'dark') return null;
    if (selection.familyId === 'cartethyia') {
      const appRoot = app.getAppPath();
      const modsRoot = app.isPackaged ? path.join(process.resourcesPath, 'mods') : path.resolve(appRoot, '../../mods');
      const source = path.join(modsRoot, 'cartethyia-theme');
      const root = fs.realpathSync(source);
      const manifest = readAppearanceManifest(root);
      return { root, manifest, type: selection.type, options };
    }
    if (typeof selection.familyId !== 'string' || !selection.familyId.endsWith('-pack-local')) return null;
    const themes = getLocalThemesDir();
    const packs = path.join(themes, 'packs');
    const entries = fs.readdirSync(packs, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries.slice(0, 64)) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
      try {
        const folder = path.join(packs, entry.name);
        const root = fs.realpathSync(folder);
        const manifest = readAppearanceManifest(root);
        if (`${manifest.id}-pack-local` === selection.familyId) return { root, manifest, type: selection.type, options };
      } catch { /* A malformed neighbor cannot hide the selected Mod. */ }
    }
  } catch { /* Before bootstrap or after a source disappears, use official artwork. */ }
  return null;
}

export function activeAppearanceAsset(slot: AppearanceAssetKey): string | undefined {
  const active = readActiveAppearance();
  if (!active) return undefined;
  const part = THEME_ASSET_PART[slot];
  if (!themePartEnabled(active.options, part)) return undefined;
  const relative = active.manifest.assets?.[active.type]?.[slot];
  if (!relative) return undefined;
  try { return readAppearanceImage(active.root, relative); }
  catch { return undefined; }
}
