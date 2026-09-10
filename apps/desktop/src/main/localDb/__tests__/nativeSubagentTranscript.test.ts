import Database from 'better-sqlite3';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SubagentRunDetail } from '@cindy/maker-shared/subagent-workspace';
import { readNativeSubagentTranscript } from '../nativeSubagentTranscript.js';

const h = vi.hoisted(() => ({ read: vi.fn(), db: null as unknown }));
vi.mock('electron', () => ({ app: { getPath: () => '/managed-home' } }));
vi.mock('@cindy/maker-core', () => ({ NativeSubagentTranscriptReader: class { read = h.read; } }));
vi.mock('../../maker-orchestration/claudeTranscriptAnchors.js', () => ({ defaultClaudeConfigDirCandidates: () => ['/fallback-home'] }));
vi.mock('../client/current.js', () => ({ getDbClient: () => h.db }));

let db: Database.Database;
const run: SubagentRunDetail = {
  id: 'run-1', parentSessionId: 'parent-1', provider: 'claude-code', logicalAgentId: 'child-1', parentToolUseId: 'spawn-1',
  identityAliases: ['child-1'], providerRunIds: ['child-1'], status: 'completed', activity: [], startedAt: 100, updatedAt: 200,
  capabilities: { viewActivity: true, viewReturnedResult: true, viewFullTranscript: true, resume: false, steer: false, stop: false, parentContext: 'unknown' },
};

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`CREATE TABLE sessions (id TEXT, sdk_session_id TEXT, remote_host_id TEXT, status TEXT);
    CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT, tool_use_id TEXT, agent_meta TEXT, created_at INTEGER, rewind_at INTEGER);
    INSERT INTO sessions VALUES ('parent-1', 'sdk-parent', NULL, 'active');
    INSERT INTO messages VALUES ('parent-1', 'tool_use', '{}', 'spawn-1', '{"sdkSessionId":"original-sdk-parent"}', 100, NULL);`);
  h.db = {
    query: async (sql: string, args: unknown[]) => { const statement = db.prepare(sql); return statement.all(...args); },
    queryOne: async (sql: string, args: unknown[]) => { const statement = db.prepare(sql); return statement.get(...args); },
  };
  h.read.mockReset();
  h.read.mockResolvedValue({ supported: true, entries: [], incomplete: true });
});
afterEach(() => db.close());

describe('host native Subagent reader', () => {
  it('resolves native identities and roots from the owned task, including its original Claude session', async () => {
    await readNativeSubagentTranscript(run, {});
    const managedRoot = path.join('/managed-home', 'claude-home', 'projects');
    expect(h.read).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'claude-code', runId: 'run-1', parentSessionIds: ['original-sdk-parent', 'sdk-parent'],
      childIds: ['child-1', 'child-1', 'child-1'], roots: expect.arrayContaining([managedRoot]), startedAt: 100,
    }));
  });

  it('never reads this computer for an SSH Codex task', async () => {
    db.exec("UPDATE sessions SET remote_host_id = 'ssh-host'");
    const remote = { ...run, provider: 'codex' as const };
    const response = await readNativeSubagentTranscript(remote, {});
    expect(response).toEqual({ supported: false, entries: [] });
    expect(h.read).not.toHaveBeenCalled();
  });

  it('pages mirrored Claude records by parent and excludes other tasks, malformed metadata and rewound rows', async () => {
    db.exec(`UPDATE sessions SET remote_host_id = 'ssh-host';
      INSERT INTO messages VALUES ('parent-1', 'assistant', 'null', NULL, '{"parentUuid":"spawn-1"}', 110, NULL);
      INSERT INTO messages VALUES ('parent-1', 'assistant', '{"text":"second"}', NULL, '{"parentUuid":"spawn-1"}', 120, NULL);
      INSERT INTO messages VALUES ('parent-1', 'assistant', 'other child', NULL, '{"parentUuid":"spawn-2"}', 130, NULL);
      INSERT INTO messages VALUES ('parent-2', 'assistant', 'other task', NULL, '{"parentUuid":"spawn-1"}', 140, NULL);
      INSERT INTO messages VALUES ('parent-1', 'assistant', 'broken metadata', NULL, '{', 150, NULL);
      INSERT INTO messages VALUES ('parent-1', 'assistant', 'rewound', NULL, '{"parentUuid":"spawn-1"}', 160, 170);`);
    const first = await readNativeSubagentTranscript(run, { limit: 1 });
    const next = { limit: 1, cursor: first.nextCursor };
    const second = await readNativeSubagentTranscript(run, next);
    expect(first.entries[0]?.content).toBe('null');
    expect(second.entries[0]?.content).toBe('second');
    expect(second.nextCursor).toBeUndefined();
    expect(second.incomplete).toBe(true);
    expect(h.read).not.toHaveBeenCalled();
  });
});
