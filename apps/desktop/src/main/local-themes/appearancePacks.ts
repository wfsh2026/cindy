import fs from 'node:fs';
import path from 'node:path';
import { nativeImage } from 'electron';
import { APPEARANCE_ASSET_KEYS, type AppearanceModManifest } from '../../shared/appearanceMod';
import type { LocalThemeWire, LocalThemeDiagnostic } from '../../shared/local-themes';
import { readBoundedFileNoFollowSync } from '../utils/readBoundedFile';
import { normalizeModIdentity } from '../../shared/modIdentity';

const lastGood = new Map<string, LocalThemeWire[]>();
const MAX_PACKS = 64;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

function readResource(root: string, relative: string, maxBytes: number): Buffer {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\\')) throw new Error('Use a relative resource path');
  const parts = relative.split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.includes(':'))) throw new Error('Invalid resource path');
  const file = path.join(root, relative);
  const options = { containWithin: root };
  const bytes = readBoundedFileNoFollowSync(file, maxBytes, options);
  if (!bytes) throw new Error(`Cannot read ${relative}`);
  return bytes;
}

function readJson(root: string, relative: string): unknown {
  const bytes = readResource(root, relative, 128 * 1024);
  const raw = bytes.toString('utf8');
  return JSON.parse(raw);
}

function requireText(value: unknown, limit: number): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > limit || /[\u0000-\u001f<>]/.test(value)) throw new Error('Invalid Mod text');
}

export function readAppearanceManifest(root: string): AppearanceModManifest {
  const raw = readJson(root, 'manifest.json') as AppearanceModManifest;
  if (!raw || raw.format !== 'cindy-personal-mod' || raw.schemaVersion !== 2 || raw.category !== 'theme' || raw.template !== 'appearance-v1' || raw.baseFamily !== 'cindy') throw new Error('Unsupported appearance Mod');
  requireText(raw.id, 64);
  requireText(raw.name, 80);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(raw.id) || !/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(raw.version)) throw new Error('Invalid Mod identity');
  for (const value of [raw.identity?.appDisplayName, raw.identity?.assistantName]) {
    if (value !== undefined) requireText(value, 40);
  }
  const identity = { appName: raw.identity?.appDisplayName, assistantName: raw.identity?.assistantName };
  const names = normalizeModIdentity(identity);
  if ((identity.appName && !names.appName) || (identity.assistantName && !names.assistantName)) throw new Error('Invalid Mod name');
  return raw;
}

function readColors(root: string, relative: string | undefined): Record<string, string> {
  if (relative === undefined) return {};
  const colors = readJson(root, relative);
  if (!colors || typeof colors !== 'object' || Array.isArray(colors)) throw new Error('Invalid colors');
  const entries = Object.entries(colors);
  if (entries.length > 1024) throw new Error('Too many colors');
  for (const [id, value] of entries) {
    if (!/^[a-z0-9-]+$/.test(id) || typeof value !== 'string' || value.length > 512 || /[;{}<>]|url\s*\(/i.test(value)) throw new Error(`Invalid color ${id}`);
  }
  return colors as Record<string, string>;
}

export function readAppearanceImage(root: string, relative: string): string {
  if (!/\.png$/i.test(relative)) throw new Error(`Use PNG for ${relative}`);
  const bytes = readResource(root, relative, MAX_IMAGE_BYTES);
  const signature = bytes.subarray(0, 8);
  const signatureHex = signature.toString('hex');
  if (bytes.length < 24 || signatureHex !== '89504e470d0a1a0a') throw new Error(`Invalid image ${relative}`);
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width * height > 8_000_000) throw new Error(`Image too large ${relative}`);
  const image = nativeImage.createFromBuffer(bytes);
  if (image.isEmpty()) throw new Error(`Invalid image ${relative}`);
  const size = image.getSize();
  if (size.width * size.height > 8_000_000) throw new Error(`Image too large ${relative}`);
  return image.toDataURL();
}

export function loadAppearancePack(root: string): LocalThemeWire[] {
  const manifest = readAppearanceManifest(root);
  const variants: LocalThemeWire[] = [];
  const images = new Map<string, string>();
  for (const type of ['light', 'dark'] as const) {
    const colors = readColors(root, manifest.colors?.[type]);
    const modAssets: LocalThemeWire['modAssets'] = {};
    for (const key of APPEARANCE_ASSET_KEYS) {
      const relative = manifest.assets?.[type]?.[key];
      if (!relative) continue;
      const src = images.get(relative) ?? readAppearanceImage(root, relative);
      images.set(relative, src);
      modAssets[key] = src;
    }
    const mod = { id: manifest.id, version: manifest.version, source: 'directory' as const, directory: path.basename(root), appDisplayName: manifest.identity?.appDisplayName, assistantName: manifest.identity?.assistantName };
    variants.push({ id: `${manifest.id}-${type}-pack-local`, family: `${manifest.id}-pack`, name: manifest.name, type, colors, mod, modAssets });
  }
  return variants;
}

export function loadAppearancePacks(themesRoot: string): { themes: LocalThemeWire[]; diagnostics: LocalThemeDiagnostic[]; disabledPacks: string[] } {
  const packsRoot = path.join(themesRoot, 'packs');
  const themes: LocalThemeWire[] = [];
  const diagnostics: LocalThemeDiagnostic[] = [];
  let disabledPacks: string[] = [];
  if (!fs.existsSync(packsRoot)) {
    for (const key of lastGood.keys()) { if (path.dirname(key) === packsRoot) lastGood.delete(key); }
    return { themes, diagnostics, disabledPacks };
  }
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(packsRoot, { withFileTypes: true }); }
  catch { return { themes, diagnostics: [{ file: 'packs', error: 'Cannot read Mod directory' }], disabledPacks }; }
  try {
    const disabledRoot = path.join(packsRoot, '.disabled');
    const disabledEntries = fs.readdirSync(disabledRoot, { withFileTypes: true });
    disabledPacks = disabledEntries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink()).map(entry => entry.name);
  } catch { /* No uninstalled source directories. */ }
  const folders = entries.filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith('.'));
  const visible = new Set(folders.map(entry => path.join(packsRoot, entry.name)));
  for (const key of lastGood.keys()) {
    if (path.dirname(key) === packsRoot && !visible.has(key)) lastGood.delete(key);
  }
  folders.sort((a, b) => a.name.localeCompare(b.name));
  const seenIds = new Set<string>();
  for (const entry of folders.slice(0, MAX_PACKS)) {
    const folder = path.join(packsRoot, entry.name);
    try {
      const root = fs.realpathSync(folder);
      const variants = loadAppearancePack(root);
      const id = variants[0].mod!.id;
      if (seenIds.has(id)) throw new Error(`Duplicate Mod id ${id}`);
      seenIds.add(id);
      lastGood.set(folder, variants);
      themes.push(...variants);
    } catch (error) {
      const previous = lastGood.get(folder);
      const id = previous?.[0].mod?.id;
      if (previous && id && !seenIds.has(id)) { seenIds.add(id); themes.push(...previous); }
      const message = error instanceof Error ? error.message : 'Cannot read Mod';
      diagnostics.push({ file: `packs/${entry.name}/manifest.json`, error: message });
    }
  }
  return { themes, diagnostics, disabledPacks };
}
