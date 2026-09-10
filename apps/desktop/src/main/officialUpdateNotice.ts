import { app } from 'electron';
import path from 'node:path';
import { resolveUpdateChannel } from '@cindy/maker-shared/update-channel';
import { resolvePersonalBuildInfo, type OfficialNoticeRequest, type OfficialUpdateSnapshot } from '../shared/personalBuildInfo';
import { compareAppUpdateVersions, parseAppUpdateVersion } from './updateVersionPolicy';
import { createOverrideSettingsFile } from './maker-host/override-settings-file';
import { desktopMakerLogger } from './maker-host/logger-adapter';
import { isBetaChannelEnabled } from './updateChannelStore';
import * as canaryFlagStore from './canaryFlagStore';

interface NoticeRecord {
  latestVersion?: string;
  lastCheckedAt?: number;
  lastAutoShownVersion?: string;
  ignoredVersion?: string;
  snoozedUntil?: number;
}
interface NoticeState { records: Record<string, NoticeRecord> }

export function normalizeOfficialNoticeState(raw: unknown): NoticeState {
  const records: Record<string, NoticeRecord> = {};
  if (!raw || typeof raw !== 'object') return { records };
  const input = (raw as NoticeState).records;
  if (!input || typeof input !== 'object') return { records };
  for (const [key, value] of Object.entries(input)) {
    if (!/^cn:win32-(x64|arm64):(release|beta|canary)$/.test(key) || !value || typeof value !== 'object') continue;
    const record: NoticeRecord = {};
    for (const field of ['latestVersion', 'lastAutoShownVersion', 'ignoredVersion'] as const) {
      const version = parseAppUpdateVersion(value[field]);
      if (version) record[field] = version;
    }
    for (const field of ['lastCheckedAt', 'snoozedUntil'] as const) {
      const timestamp = value[field];
      if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp >= 0) record[field] = timestamp;
    }
    records[key] = record;
  }
  return { records };
}

const log = desktopMakerLogger.child('official-update-notice');
const filePath = () => {
  const root = app.getPath('userData');
  return path.join(root, 'official-update-notices.json');
};
const storeOptions = { filePath, defaults: { records: {} }, normalize: normalizeOfficialNoticeState, log, label: 'official-update-notices', preserveUnreadableFile: true, maxBytes: 16384 };
const store = createOverrideSettingsFile<NoticeState>(storeOptions);
const failures = new Set<string>();
const volatileRecords = new Map<string, NoticeRecord>();

export function getPersonalUpdateBuildInfo() {
  return resolvePersonalBuildInfo(process.platform, import.meta.env.VITE_CINDY_AUTH_REGION);
}

export function officialUpdateScopeKey(): string {
  const canary = canaryFlagStore.read();
  const beta = isBetaChannelEnabled();
  const channel = resolveUpdateChannel(canary, beta);
  return `cn:${process.platform}-${process.arch}:${channel}`;
}

export function getOfficialUpdateSnapshot(): OfficialUpdateSnapshot | undefined {
  const info = getPersonalUpdateBuildInfo();
  if (!info) return undefined;
  store.invalidateIfChanged();
  const scopeKey = officialUpdateScopeKey();
  const state = store.read();
  const record = volatileRecords.get(scopeKey) ?? state.records[scopeKey] ?? {};
  const relation = compareAppUpdateVersions(record.latestVersion, info.upstreamVersion);
  const checkFailed = failures.has(scopeKey);
  return { ...record, scopeKey, upstreamVersion: info.upstreamVersion, hasUpdate: relation === 'newer', checkFailed };
}

/** A failed check preserves the last successful release and timestamp. */
export async function recordOfficialUpdateCheck(version: string | null, scopeKey: string): Promise<void> {
  const info = getPersonalUpdateBuildInfo();
  if (!info) return;
  const currentScope = officialUpdateScopeKey();
  if (scopeKey !== currentScope) return;
  const normalized = parseAppUpdateVersion(version);
  if (!normalized) { failures.add(scopeKey); return; }
  const now = Date.now();
  const update = (current: { value: NoticeState }): NoticeState => {
    const previous = current.value.records[scopeKey] ?? {};
    const changed = previous.latestVersion !== normalized;
    const record = { ...previous, latestVersion: normalized, lastCheckedAt: now, ...(changed ? { snoozedUntil: undefined } : {}) };
    return { records: { ...current.value.records, [scopeKey]: record } };
  };
  try {
    await store.updateAtomic(update);
    volatileRecords.delete(scopeKey);
  } catch {
    const state = store.read();
    const current = { value: state };
    const next = update(current);
    volatileRecords.set(scopeKey, next.records[scopeKey]);
    log.warn('Official update cache could not be saved; using this process result');
  }
  failures.delete(scopeKey);
}

/** Atomic claim prevents two windows or shared instances auto-opening the same notice. */
export async function applyOfficialNoticeAction(request: OfficialNoticeRequest): Promise<boolean> {
  const snapshot = getOfficialUpdateSnapshot();
  if (!snapshot?.hasUpdate || request.scopeKey !== snapshot.scopeKey || request.version !== snapshot.latestVersion) return false;
  const now = Date.now();
  let accepted = false;
  const update = (current: { value: NoticeState }): NoticeState => {
    const record = current.value.records[request.scopeKey];
    if (!record || record.latestVersion !== request.version) return current.value;
    if (request.action === 'shown' && (record.ignoredVersion === request.version || record.lastAutoShownVersion === request.version || (record.snoozedUntil ?? 0) > now)) return current.value;
    const next = { ...record };
    if (request.action === 'shown') next.lastAutoShownVersion = request.version;
    if (request.action === 'ignore') next.ignoredVersion = request.version;
    if (request.action === 'snooze') {
      next.snoozedUntil = now + 24 * 60 * 60 * 1000;
      next.lastAutoShownVersion = undefined;
      next.ignoredVersion = undefined;
    }
    accepted = true;
    return { records: { ...current.value.records, [request.scopeKey]: next } };
  };
  await store.updateAtomic(update);
  return accepted;
}
