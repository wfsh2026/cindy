import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyOfficialNoticeAction, getOfficialUpdateSnapshot, normalizeOfficialNoticeState, officialUpdateScopeKey, recordOfficialUpdateCheck } from '../officialUpdateNotice';

vi.mock('../../../personal-build.json', () => ({ default: {
  edition: 'personal', upstreamVersion: '0.1.72', upstreamCommit: 'a'.repeat(40), changeKeys: ['officialNotices'],
} }));

const harness = vi.hoisted(() => ({ state: { records: {} } as ReturnType<typeof normalizeOfficialNoticeState>, beta: false, canary: false, version: '0.1.80' }));
vi.mock('electron', () => ({ app: { getPath: () => 'unused', getVersion: () => harness.version } }));
vi.mock('../canaryFlagStore', () => ({ read: () => harness.canary }));
vi.mock('../updateChannelStore', () => ({ isBetaChannelEnabled: () => harness.beta }));
vi.mock('../maker-host/logger-adapter', () => ({ desktopMakerLogger: { child: () => ({ info: vi.fn(), warn: vi.fn() }) } }));
vi.mock('../maker-host/override-settings-file', () => ({
  createOverrideSettingsFile: () => ({
    invalidateIfChanged: () => {},
    read: () => harness.state,
    updateAtomic: async (update: (state: { value: typeof harness.state }) => typeof harness.state) => {
      harness.state = update({ value: harness.state });
      return harness.state;
    },
  }),
}));

const originalPlatform = process.platform;
const originalArch = process.arch;
beforeEach(() => {
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
  Object.defineProperty(process, 'arch', { value: 'x64', configurable: true });
  vi.stubEnv('VITE_CINDY_AUTH_REGION', 'cn');
  harness.state = { records: {} };
  harness.beta = false;
  harness.canary = false;
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  Object.defineProperty(process, 'platform', { value: originalPlatform });
  Object.defineProperty(process, 'arch', { value: originalArch });
});

describe('official update notice state', () => {
  it('compares against the official baseline even when the personal version is higher', async () => {
    const scope = officialUpdateScopeKey();
    await recordOfficialUpdateCheck('0.1.73', scope);
    const snapshot = getOfficialUpdateSnapshot();
    expect(snapshot).toMatchObject({ upstreamVersion: '0.1.72', latestVersion: '0.1.73', hasUpdate: true, checkFailed: false });
    harness.version = '0.1.99';
    const repackaged = getOfficialUpdateSnapshot();
    expect(repackaged?.upstreamVersion).toBe('0.1.72');
    expect(repackaged?.hasUpdate).toBe(true);
  });

  it('keeps cached version and successful check time on network failure', async () => {
    const scope = officialUpdateScopeKey();
    await recordOfficialUpdateCheck('0.1.73', scope);
    const before = getOfficialUpdateSnapshot();
    await recordOfficialUpdateCheck(null, scope);
    const after = getOfficialUpdateSnapshot();
    expect(after).toMatchObject({ latestVersion: '0.1.73', hasUpdate: true, checkFailed: true, lastCheckedAt: before?.lastCheckedAt });
  });

  it('claims automatic display once and keeps ignoring distinct from syncing', async () => {
    const scopeKey = officialUpdateScopeKey();
    await recordOfficialUpdateCheck('0.1.73', scopeKey);
    const request = { scopeKey, version: '0.1.73', action: 'shown' as const };
    const first = await applyOfficialNoticeAction(request);
    const second = await applyOfficialNoticeAction(request);
    const ignore = { ...request, action: 'ignore' as const };
    await applyOfficialNoticeAction(ignore);
    const ignored = getOfficialUpdateSnapshot();
    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(ignored).toMatchObject({ hasUpdate: true, ignoredVersion: '0.1.73', upstreamVersion: '0.1.72' });
    await recordOfficialUpdateCheck('0.1.74', scopeKey);
    const nextRequest = { ...request, version: '0.1.74' };
    const nextAccepted = await applyOfficialNoticeAction(nextRequest);
    expect(nextAccepted).toBe(true);
  });

  it('snoozes for one day without losing the persistent update entrance', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(100_000);
    const scopeKey = officialUpdateScopeKey();
    await recordOfficialUpdateCheck('0.1.73', scopeKey);
    const request = { scopeKey, version: '0.1.73', action: 'snooze' as const };
    await applyOfficialNoticeAction(request);
    const claim = { ...request, action: 'shown' as const };
    const tooEarly = await applyOfficialNoticeAction(claim);
    const snoozed = getOfficialUpdateSnapshot();
    expect(tooEarly).toBe(false);
    expect(snoozed?.hasUpdate).toBe(true);
    vi.setSystemTime(100_000 + 24 * 60 * 60 * 1000);
    const nextDay = await applyOfficialNoticeAction(claim);
    expect(nextDay).toBe(true);
  });

  it('isolates channels and rejects late results or actions from the previous channel', async () => {
    const oldScope = officialUpdateScopeKey();
    await recordOfficialUpdateCheck('0.1.73', oldScope);
    harness.beta = true;
    await recordOfficialUpdateCheck('0.1.74', oldScope);
    const switched = getOfficialUpdateSnapshot();
    const oldAction = { scopeKey: oldScope, version: '0.1.73', action: 'ignore' as const };
    const accepted = await applyOfficialNoticeAction(oldAction);
    expect(switched?.latestVersion).toBeUndefined();
    expect(accepted).toBe(false);
    const betaScope = officialUpdateScopeKey();
    await recordOfficialUpdateCheck('0.1.74-beta', betaScope);
    const beta = getOfficialUpdateSnapshot();
    expect(beta?.hasUpdate).toBe(true);
    harness.beta = false;
    const restored = getOfficialUpdateSnapshot();
    expect(restored?.latestVersion).toBe('0.1.73');
  });

  it('does not activate the personal flow on other builds or accept malformed cache values', () => {
    vi.stubEnv('VITE_CINDY_AUTH_REGION', 'global');
    const snapshot = getOfficialUpdateSnapshot();
    expect(snapshot).toBeUndefined();
    const raw = { records: { 'cn:win32-x64:release': { latestVersion: 'bad', snoozedUntil: -1 }, '../other': { latestVersion: '9.9.9' } } };
    const normalized = normalizeOfficialNoticeState(raw);
    expect(normalized).toEqual({ records: { 'cn:win32-x64:release': {} } });
  });
});
