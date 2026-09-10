import semver from 'semver';
import type { OfficialUpdateSnapshot } from '../../shared/personalBuildInfo';

export function officialNoticeVersions(index: string[] | null, range: { baseline: string; latest: string }): string[] {
  const versions = new Set<string>();
  if (!semver.valid(range.baseline) || !semver.valid(range.latest)) return [];
  for (const version of index ?? []) {
    if (!semver.valid(version)) continue;
    const afterBaseline = semver.compare(version, range.baseline) > 0;
    const beforeLatest = semver.compare(version, range.latest) <= 0;
    if (afterBaseline && beforeLatest) versions.add(version);
  }
  versions.add(range.latest);
  const ordered = [...versions];
  ordered.sort((left, right) => semver.compare(right, left));
  return ordered;
}

export function shouldAutoShowOfficialNotice(snapshot: OfficialUpdateSnapshot | undefined, now: number): boolean {
  return Boolean(snapshot?.hasUpdate && snapshot.latestVersion && !snapshot.checkFailed && snapshot.ignoredVersion !== snapshot.latestVersion && snapshot.lastAutoShownVersion !== snapshot.latestVersion && (snapshot.snoozedUntil ?? 0) <= now);
}
