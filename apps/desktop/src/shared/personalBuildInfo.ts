import metadata from '../../personal-build.json';

export interface PersonalBuildInfo {
  edition: 'personal';
  upstreamVersion: string;
  upstreamCommit: string;
  changeKeys: string[];
}

/** Personal identity is explicit and limited to this fork's Windows CN builds. */
export function resolvePersonalBuildInfo(platform: string, region: string | undefined): PersonalBuildInfo | undefined {
  if (platform !== 'win32' || region !== 'cn' || metadata.edition !== 'personal') return undefined;
  return { ...metadata, edition: 'personal' };
}

export interface OfficialUpdateSnapshot {
  scopeKey: string;
  upstreamVersion: string;
  latestVersion?: string;
  lastCheckedAt?: number;
  checkFailed: boolean;
  hasUpdate: boolean;
  lastAutoShownVersion?: string;
  ignoredVersion?: string;
  snoozedUntil?: number;
}

export type OfficialNoticeAction = 'shown' | 'snooze' | 'ignore';
export interface OfficialNoticeRequest {
  scopeKey: string;
  version: string;
  action: OfficialNoticeAction;
}
