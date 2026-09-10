import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import semver from 'semver';

/** Packaging verifies an explicit baseline; it never advances it to a newer tag. */
export function validatePersonalBuildInfo(desktopRoot, git = execFileSync) {
  const file = path.join(desktopRoot, 'personal-build.json');
  const source = fs.readFileSync(file, 'utf8');
  const info = JSON.parse(source);
  if (info.edition !== 'personal' || !semver.valid(info.upstreamVersion) || !/^[a-f0-9]{40}$/.test(info.upstreamCommit)) {
    throw new Error('Invalid personal build baseline');
  }
  if (!Array.isArray(info.changeKeys) || !info.changeKeys.every((key) => typeof key === 'string' && /^[a-zA-Z][a-zA-Z0-9]*$/.test(key))) {
    throw new Error('Invalid personal release notes');
  }
  const options = { cwd: desktopRoot, encoding: 'utf8' };
  const tagArgs = ['rev-parse', `v${info.upstreamVersion}^{commit}`];
  const tagOutput = git('git', tagArgs, options);
  const tagCommit = tagOutput.trim();
  if (tagCommit !== info.upstreamCommit) throw new Error('Official version does not match its recorded commit');
  const ancestorArgs = ['merge-base', '--is-ancestor', info.upstreamCommit, 'HEAD'];
  git('git', ancestorArgs, options);
  return info;
}
