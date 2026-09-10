// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfficialUpdateNotice } from '../components/OfficialUpdateNotice';
import { OfficialUpdateBanner } from '../components/sidebar/OfficialUpdateBanner';
import type { OfficialUpdateSnapshot } from '../../shared/personalBuildInfo';

const harness = vi.hoisted(() => ({ notes: vi.fn(), index: vi.fn(), external: vi.fn(), clipboard: vi.fn(), action: vi.fn(), t: (key: string, options?: Record<string, unknown>) => options ? `${key}:${JSON.stringify(options)}` : key }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: harness.t, i18n: { language: 'en' } }) }));
vi.mock('@/hooks/useLocale', () => ({ useLocale: () => ({ effectiveLocale: 'en' }) }));
vi.mock('@/release-notes', () => ({ fetchReleaseNotes: harness.notes, fetchReleaseNotesIndex: harness.index }));
vi.mock('@/lib/toast', () => ({ toast: { success: vi.fn(), warning: vi.fn(), error: vi.fn() } }));
const snapshot: OfficialUpdateSnapshot = { scopeKey: 'cn:win32-x64:release', upstreamVersion: '0.1.72', latestVersion: '0.1.73', hasUpdate: true, checkFailed: false };
vi.mock('@/hooks/useUpdateStatus', () => ({ useUpdateStatus: () => ({ official: snapshot }) }));

beforeEach(() => {
  harness.notes.mockReset().mockResolvedValue(null);
  harness.index.mockReset().mockResolvedValue(['0.1.72', '0.1.73']);
  harness.action.mockReset().mockResolvedValue(true);
  harness.clipboard.mockReset().mockResolvedValue(undefined);
  vi.stubGlobal('IntersectionObserver', class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } });
  const api = { appVersion: '0.1.80', personalBuildInfo: { edition: 'personal', upstreamVersion: '0.1.72', upstreamCommit: 'a'.repeat(40), changeKeys: ['subagentLinks'] }, openExternal: harness.external };
  Object.defineProperty(window, 'electronAPI', { value: api, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: harness.clipboard }, configurable: true });
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('official update notice UI', () => {
  it('opens a persistent banner without requiring release notes to exist', () => {
    const open = vi.fn();
    const element = <OfficialUpdateBanner isCollapsed={false} onOpen={open} />;
    const view = render(element);
    const button = view.getByRole('button');
    fireEvent.click(button);
    expect(open).toHaveBeenCalledWith('0.1.73');
    expect(harness.notes).not.toHaveBeenCalled();
  });

  it('shows the three independent versions and recoverable missing-notes state', async () => {
    const element = <OfficialUpdateNotice open official={snapshot} onDismiss={vi.fn()} act={harness.action} />;
    const view = render(element);
    await waitFor(() => { expect(harness.notes).toHaveBeenCalledWith('0.1.73', 'en'); });
    const body = view.getByRole('alertdialog').textContent;
    expect(body).toContain('update.official.personalVersion:{"version":"0.1.80"}');
    expect(body).toContain('update.official.baseline:{"version":"0.1.72"}');
    expect(body).toContain('update.official.latest:{"version":"0.1.73"}');
    expect(body).toContain('update.official.notesPending');
    expect(body).not.toContain('Invalid Date');
    const copy = view.getByRole('button', { name: 'update.official.copy' });
    fireEvent.click(copy);
    await waitFor(() => { expect(harness.clipboard).toHaveBeenCalledOnce(); });
    const copied = harness.clipboard.mock.calls[0][0];
    expect(copied).toContain('0.1.72');
    expect(copied).toContain('0.1.73');
    expect(copied).toContain('0.1.80');
  });

  it('keeps personal release notes and their read marker separate from official notices', async () => {
    const element = <OfficialUpdateNotice open official={snapshot} onDismiss={vi.fn()} act={harness.action} />;
    const view = render(element);
    const personal = view.getByRole('button', { name: 'update.personal.unread' });
    fireEvent.click(personal);
    const body = view.getByRole('alertdialog').textContent;
    expect(body).toContain('update.personal.changes.subagentLinks.text');
    const marker = localStorage.getItem('cartethyia:personal-notes-read');
    const legacyMarker = localStorage.getItem('xdt-maker:lastReadVersion');
    expect(marker).toBe('0.1.80');
    expect(legacyMarker).toBeNull();
    expect(harness.action).not.toHaveBeenCalled();
    await waitFor(() => { expect(harness.notes).toHaveBeenCalled(); });
  });

  it('persists the selected reminder action before closing', async () => {
    const dismiss = vi.fn();
    const element = <OfficialUpdateNotice open official={snapshot} onDismiss={dismiss} act={harness.action} />;
    const view = render(element);
    const ignore = view.getByRole('button', { name: 'update.official.ignore' });
    fireEvent.click(ignore);
    await waitFor(() => { expect(dismiss).toHaveBeenCalledOnce(); });
    expect(harness.action).toHaveBeenCalledWith('ignore');
  });
});
