import path from 'node:path';
import { app } from 'electron';
import { getActiveAppSession, dataOwnerStorageKey } from '../appSessionState';
import { atomicWriteFileSync, readAtomicFileSync } from '../utils/atomicWriteFile';
import { buildAssistantNamingContext, normalizeModIdentity, type ModIdentity } from '../../shared/modIdentity';
import { readActiveAppearance } from './appearance';
import { resolveThemeModNames } from '../../shared/themeModParts';

function identityPath(): string | null {
  const owner = getActiveAppSession();
  if (!owner.dataOwnerId) return null;
  const root = app.getPath('userData');
  const key = dataOwnerStorageKey(owner.dataOwnerId);
  return path.join(root, 'owners', key, 'personal-mods', 'identity.json');
}

export function readModIdentity(): ModIdentity {
  try {
    const file = identityPath();
    if (!file) return {};
    const raw = readAtomicFileSync(file);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return normalizeModIdentity(parsed);
  } catch { return {}; }
}

export function writeModIdentity(value: unknown): ModIdentity {
  const file = identityPath();
  if (!file) throw new Error('No active profile');
  const identity = normalizeModIdentity(value);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid identity');
  const input = value as ModIdentity;
  if (input.themeId !== undefined && !identity.themeId) throw new Error('Invalid theme identity');
  for (const key of ['appName', 'assistantName'] as const) {
    const name = input[key];
    if (name !== undefined && (typeof name !== 'string' || (name.trim() && !identity[key]))) throw new Error('Invalid name');
  }
  const raw = JSON.stringify(identity);
  atomicWriteFileSync(file, raw);
  return identity;
}

export function personalizedHostPrompt(host: string): string {
  const identity = resolvedModIdentity();
  const context = buildAssistantNamingContext(identity);
  return context ? `${host}\n\n${context}` : host;
}

export function resolvedModIdentity(): ModIdentity {
  const identity = readModIdentity();
  const active = readActiveAppearance();
  const theme = active ? { id: active.manifest.id, appDisplayName: active.manifest.identity?.appDisplayName, assistantName: active.manifest.identity?.assistantName } : undefined;
  const resolved = resolveThemeModNames(identity, theme, active?.options);
  return resolved;
}
