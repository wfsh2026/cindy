/** Native files are resolved from host-owned roots and DB-owned identities, never renderer paths. */
import path from 'node:path';
import { app } from 'electron';
import { NativeSubagentTranscriptReader } from '@cindy/maker-core';
import type { SubagentRunDetail, SubagentTranscriptEntry, SubagentTranscriptPageResponse } from '@cindy/maker-shared/subagent-workspace';
import { defaultClaudeConfigDirCandidates } from '../maker-orchestration/claudeTranscriptAnchors.js';
import { getDbClient } from './client/current.js';
import type { DbClient } from './client/DbClient.js';

const reader = new NativeSubagentTranscriptReader();
interface ReadOptions { cursor?: string; limit?: number }
interface MessageRow { rowid: number; role: string; content: string; tool_use_id: string | null; created_at: number }

function parseObject(raw: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw ?? '{}');
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  } catch { return {}; }
}

async function readClaudeMessagePage(run: SubagentRunDetail, options: ReadOptions, db: DbClient): Promise<SubagentTranscriptPageResponse> {
  const prefix = `db:${run.id}:`;
  const supplied = options.cursor?.startsWith(prefix) ? Number(options.cursor.slice(prefix.length)) : 0;
  const after = Number.isSafeInteger(supplied) && supplied >= 0 ? supplied : 0;
  const requestedLimit = Number.isFinite(options.limit) ? Math.floor(options.limit!) : 100;
  const positiveLimit = Math.max(1, requestedLimit);
  const limit = Math.min(100, positiveLimit);
  const parameters = [run.parentSessionId, run.parentToolUseId ?? run.logicalAgentId, after, limit + 1];
  const rows = await db.query<MessageRow>(
    `SELECT rowid, role, substr(content, 1, 8192) AS content, tool_use_id, created_at FROM messages
     WHERE session_id = ? AND rewind_at IS NULL
       AND CASE WHEN json_valid(agent_meta) THEN json_extract(agent_meta, '$.parentUuid') END = ? AND rowid > ?
       AND role IN ('assistant', 'tool_use', 'tool_result') ORDER BY rowid LIMIT ?`, parameters);
  const page = rows.slice(0, limit);
  const entries: SubagentTranscriptEntry[] = page.map((row) => {
    const value = parseObject(row.content);
    const text = typeof value.text === 'string' ? value.text : typeof value.content === 'string' ? value.content : row.content;
    const base = { id: `message:${row.rowid}`, sequence: row.rowid, occurredAt: row.created_at };
    if (row.role === 'assistant') return { ...base, role: 'subagent', content: text };
    const toolName = typeof value.toolName === 'string' ? value.toolName : undefined;
    const toolCallId = row.tool_use_id ?? undefined;
    const toolInputJson = JSON.stringify(value.input ?? {});
    return { ...base, role: 'tool', content: row.role === 'tool_use' ? toolName ?? '' : text, toolName, toolCallId, toolPhase: row.role === 'tool_use' ? 'start' : 'end', ...(row.role === 'tool_use' ? { toolInputJson } : {}), isError: value.isError === true };
  });
  const tail = `${prefix}${page.at(-1)?.rowid ?? after}`;
  return { supported: true, entries, tailCursor: tail, ...(rows.length > limit ? { nextCursor: tail } : {}), incomplete: true };
}

export async function readNativeSubagentTranscript(run: SubagentRunDetail, options: ReadOptions): Promise<SubagentTranscriptPageResponse> {
  if (run.provider === 'pi') return { supported: false, entries: [] };
  const db = getDbClient();
  const sessionArgs = [run.parentSessionId];
  const session = await db.queryOne<{ sdk_session_id: string | null; remote_host_id: string | null }>('SELECT sdk_session_id, remote_host_id FROM sessions WHERE id = ? AND status != \'deleted\'', sessionArgs);
  if (!session) return { supported: false, entries: [] };
  // SSH rows must never resolve a remote path on this computer. CC's mirrored messages remain readable.
  if (session.remote_host_id) return run.provider === 'claude-code' ? readClaudeMessagePage(run, options, db) : { supported: false, entries: [] };
  if (run.provider === 'claude-code' && options.cursor?.startsWith(`db:${run.id}:`)) return readClaudeMessagePage(run, options, db);
  const parentArgs = [run.parentSessionId, run.parentToolUseId ?? run.logicalAgentId];
  const parent = await db.queryOne<{ agent_meta: string | null; created_at: number }>(
    "SELECT agent_meta, created_at FROM messages WHERE session_id = ? AND tool_use_id = ? AND role = 'tool_use' AND rewind_at IS NULL ORDER BY created_at DESC LIMIT 1", parentArgs);
  const meta = parseObject(parent?.agent_meta ?? null);
  const parentSessionIds = [typeof meta.sdkSessionId === 'string' ? meta.sdkSessionId : '', session.sdk_session_id ?? ''].filter(Boolean);
  const userData = app.getPath('userData');
  const configDirs = defaultClaudeConfigDirCandidates();
  const managedClaudeHome = path.join(userData, 'claude-home');
  if (!configDirs.includes(managedClaudeHome)) configDirs.unshift(managedClaudeHome);
  const roots = run.provider === 'codex'
    ? [path.join(userData, 'codex-home', 'sessions'), path.join(userData, 'codex-home', 'archived_sessions')]
    : configDirs.map((directory) => path.join(directory, 'projects'));
  const childIds = [...run.providerRunIds, ...run.identityAliases, run.logicalAgentId];
  const input = { provider: run.provider, runId: run.id, childIds, parentSessionIds, roots, startedAt: parent?.created_at ?? run.startedAt, cursor: options.cursor, limit: options.limit };
  const result = await reader.read(input);
  if (run.provider === 'claude-code' && !options.cursor && result.incomplete && result.entries.length === 0) {
    const mirrored = await readClaudeMessagePage(run, options, db);
    if (mirrored.entries.length) return mirrored;
  }
  return result;
}
