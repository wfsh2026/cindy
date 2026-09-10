import { describe, expect, it } from 'vitest';
import { officialNoticeVersions, shouldAutoShowOfficialNotice } from '../officialNoticePresentation';
import type { OfficialUpdateSnapshot } from '../../../shared/personalBuildInfo';

describe('official notice presentation', () => {
  it('uses official baseline and SemVer order including beta releases', () => {
    const versions = ['0.1.72', '0.1.73-beta.2', '0.1.73-beta.10', '0.1.73', '0.1.74', 'broken'];
    const range = { baseline: '0.1.72', latest: '0.1.73' };
    const result = officialNoticeVersions(versions, range);
    expect(result).toEqual(['0.1.73', '0.1.73-beta.10', '0.1.73-beta.2']);
  });

  it('retains the latest release even if the notes index is unavailable', () => {
    const range = { baseline: '0.1.72', latest: '0.1.73' };
    const result = officialNoticeVersions(null, range);
    expect(result).toEqual(['0.1.73']);
  });

  it('suppresses repeated, ignored, snoozed and offline automatic popups', () => {
    const snapshot: OfficialUpdateSnapshot = { scopeKey: 'cn:win32-x64:release', upstreamVersion: '0.1.72', latestVersion: '0.1.73', hasUpdate: true, checkFailed: false };
    const first = shouldAutoShowOfficialNotice(snapshot, 100);
    expect(first).toBe(true);
    for (const extra of [{ lastAutoShownVersion: '0.1.73' }, { ignoredVersion: '0.1.73' }, { snoozedUntil: 200 }, { checkFailed: true }]) {
      const updated = { ...snapshot, ...extra };
      const result = shouldAutoShowOfficialNotice(updated, 100);
      expect(result).toBe(false);
    }
  });
});
