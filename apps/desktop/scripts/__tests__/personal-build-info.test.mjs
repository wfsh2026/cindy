import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validatePersonalBuildInfo } from '../personal-build-info.mjs';

const harness = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('node:fs', () => ({ default: { readFileSync: harness.read } }));
const commit = 'a'.repeat(40);
beforeEach(() => {
  const metadata = { edition: 'personal', upstreamVersion: '0.1.72', upstreamCommit: commit, changeKeys: ['subagentLinks'] };
  const source = JSON.stringify(metadata);
  harness.read.mockReturnValue(source);
});

describe('personal build baseline validation', () => {
  it('verifies the pinned tag and ancestry without advancing the baseline', () => {
    const git = vi.fn().mockReturnValue(`${commit}\n`);
    const result = validatePersonalBuildInfo('/desktop-fixture', git);
    expect(result.upstreamVersion).toBe('0.1.72');
    expect(git).toHaveBeenCalledWith('git', ['rev-parse', 'v0.1.72^{commit}'], { cwd: '/desktop-fixture', encoding: 'utf8' });
    expect(git).toHaveBeenCalledWith('git', ['merge-base', '--is-ancestor', commit, 'HEAD'], { cwd: '/desktop-fixture', encoding: 'utf8' });
  });

  it('rejects a mismatched tag or a baseline that has not been merged', () => {
    const mismatch = vi.fn().mockReturnValue('b'.repeat(40));
    const validateMismatch = () => validatePersonalBuildInfo('/desktop-fixture', mismatch);
    expect(validateMismatch).toThrow('does not match');
    const notMerged = vi.fn().mockReturnValueOnce(commit).mockImplementationOnce(() => { throw new Error('not an ancestor'); });
    const validateAncestry = () => validatePersonalBuildInfo('/desktop-fixture', notMerged);
    expect(validateAncestry).toThrow('not an ancestor');
  });
});
