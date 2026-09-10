// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOfficialUpdateNotice } from '../hooks/useOfficialUpdateNotice';
import type { OfficialUpdateSnapshot } from '../../shared/personalBuildInfo';

const harness = vi.hoisted(() => ({ snapshot: undefined as OfficialUpdateSnapshot | undefined, busy: vi.fn(), action: vi.fn() }));
vi.mock('@/hooks/useUpdateStatus', () => ({ useUpdateStatus: () => ({ official: harness.snapshot }) }));
beforeEach(() => {
  vi.useFakeTimers();
  harness.snapshot = { scopeKey: 'cn:win32-x64:release', upstreamVersion: '0.1.72', latestVersion: '0.1.73', hasUpdate: true, checkFailed: false };
  harness.busy.mockReset().mockResolvedValue(false);
  harness.action.mockReset().mockResolvedValue({ accepted: true });
  const api = { personalBuildInfo: { upstreamVersion: '0.1.72' }, anyActivityBlockingRelaunch: harness.busy, officialUpdateNoticeAction: harness.action };
  Object.defineProperty(window, 'electronAPI', { value: api, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('official update popup scheduling', () => {
  it('waits for active work to finish before claiming and opening the popup', async () => {
    harness.busy.mockResolvedValueOnce(true).mockResolvedValue(false);
    const hook = renderHook(useOfficialUpdateNotice);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(hook.result.current.open).toBe(false);
    expect(harness.action).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000); });
    expect(hook.result.current.open).toBe(true);
    expect(harness.action).toHaveBeenCalledWith({ scopeKey: 'cn:win32-x64:release', version: '0.1.73', action: 'shown' });
  });

  it('does not auto-open a release already claimed by another window', async () => {
    harness.action.mockResolvedValue({ accepted: false });
    const hook = renderHook(useOfficialUpdateNotice);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(hook.result.current.open).toBe(false);
    act(() => { hook.result.current.onOpen(); });
    expect(hook.result.current.open).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  });

  it('does not auto-open an ignored version, but manual access remains available', async () => {
    harness.snapshot!.ignoredVersion = '0.1.73';
    const hook = renderHook(useOfficialUpdateNotice);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(hook.result.current.open).toBe(false);
    expect(harness.busy).not.toHaveBeenCalled();
    act(() => { hook.result.current.onOpen(); });
    expect(hook.result.current.open).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  });
});
