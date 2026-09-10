/** Read-only, bounded projection of native child transcripts. No Agent loop or credentials are read. */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { SubagentTranscriptEntry, SubagentTranscriptPageResponse } from '@cindy/maker-shared/subagent-workspace';

type RecordValue = Record<string, unknown>;
export interface NativeSubagentTranscriptRequest {
  provider: 'claude-code' | 'codex';
  runId: string;
  childIds: string[];
  parentSessionIds: string[];
  roots: string[];
  startedAt: number;
  cursor?: string;
  limit?: number;
}
interface Position { offset: number; block: number; skipping?: boolean }
interface FileSource { file: string; root: string; childId: string }
const MAX_READ_BYTES = 1024 * 1024;
const MAX_TEXT = 64 * 1024;
const SAFE_ID = /^[a-zA-Z0-9_-]{1,160}$/;

function record(value: unknown): RecordValue {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as RecordValue : {};
}
function string(value: unknown): string { return typeof value === 'string' ? value : ''; }
function textContent(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, MAX_TEXT);
  if (!Array.isArray(value)) return '';
  const texts = value.map((item) => {
    const block = record(item);
    return string(block.text);
  });
  const joined = texts.filter(Boolean).join('\n');
  return joined.slice(0, MAX_TEXT);
}
function serialize(value: unknown): string {
  const encoded = typeof value === 'string' ? value : JSON.stringify(value ?? {});
  return encoded.slice(0, MAX_TEXT);
}

/** Native system/developer instructions and private reasoning are deliberately not projected. */
export function projectNativeSubagentLine(raw: unknown, context: { provider: 'claude-code' | 'codex'; childId: string; offset: number; startedAt: number }): SubagentTranscriptEntry[] {
  const row = record(raw);
  const timestamp = Date.parse(string(row.timestamp));
  // Codex forks contain inherited history. Its original timestamps precede the child's launch.
  if (context.provider === 'codex' && (!Number.isFinite(timestamp) || timestamp < context.startedAt)) return [];
  const occurredAt = Number.isFinite(timestamp) ? timestamp : context.startedAt;
  const payload = context.provider === 'codex' ? record(row.payload) : record(row.message);
  const entries: SubagentTranscriptEntry[] = [];
  const append = (entry: Omit<SubagentTranscriptEntry, 'id' | 'sequence' | 'occurredAt' | 'childId'>): void => {
    const sequence = context.offset * 1000 + entries.length;
    entries.push({ ...entry, id: `${context.childId}:${context.offset}:${entries.length}`, sequence, occurredAt, childId: context.childId });
  };
  if (context.provider === 'codex') {
    if (row.type !== 'response_item') return [];
    if (payload.type === 'message' && (payload.role === 'assistant' || payload.role === 'user')) {
      const content = textContent(payload.content);
      if (content) append({ role: payload.role === 'user' ? 'parent' : 'subagent', content });
    } else if (payload.type === 'function_call' || payload.type === 'custom_tool_call') {
      const toolName = string(payload.name);
      const toolCallId = string(payload.call_id);
      const toolInputJson = serialize(payload.arguments ?? payload.input);
      append({ role: 'tool', content: toolName, toolName, toolCallId, toolInputJson, toolPhase: 'start' });
    } else if (payload.type === 'function_call_output' || payload.type === 'custom_tool_call_output') {
      const content = textContent(payload.output) || serialize(payload.output);
      const toolCallId = string(payload.call_id);
      append({ role: 'tool', content, toolCallId, toolPhase: 'end', isError: payload.is_error === true });
    }
    return entries;
  }
  if (row.type !== 'assistant' && row.type !== 'user') return [];
  const content = payload.content;
  if (typeof content === 'string') {
    const bounded = content.slice(0, MAX_TEXT);
    append({ role: row.type === 'user' ? 'parent' : 'subagent', content: bounded });
    return entries;
  }
  if (!Array.isArray(content)) return [];
  for (const rawBlock of content) {
    const block = record(rawBlock);
    if (block.type === 'text') {
      const text = string(block.text).slice(0, MAX_TEXT);
      if (text) append({ role: row.type === 'user' ? 'parent' : 'subagent', content: text });
    } else if (block.type === 'tool_use') {
      const toolName = string(block.name);
      const toolCallId = string(block.id);
      const toolInputJson = serialize(block.input);
      append({ role: 'tool', content: toolName, toolName, toolCallId, toolInputJson, toolPhase: 'start' });
    } else if (block.type === 'tool_result') {
      const text = textContent(block.content);
      const toolCallId = string(block.tool_use_id);
      append({ role: 'tool', content: text, toolCallId, toolPhase: 'end', isError: block.is_error === true });
    }
  }
  return entries;
}

function inside(root: string, file: string): boolean {
  const relative = path.relative(root, file);
  return relative !== '' && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** Instances belong to the host reader; discovery is cached without retaining transcript contents. */
export class NativeSubagentTranscriptReader {
  private readonly discoveries = new Map<string, { at: number; sources: FileSource[] }>();

  private async discover(input: NativeSubagentTranscriptRequest): Promise<FileSource[]> {
    const identity = [input.provider, input.roots, input.childIds, input.parentSessionIds];
    const key = JSON.stringify(identity);
    const previous = this.discoveries.get(key);
    const now = Date.now();
    if (previous && now - previous.at < (previous.sources.length ? 30_000 : 2_000)) return previous.sources;
    const ids = input.childIds.filter((id) => SAFE_ID.test(id));
    const parents = input.parentSessionIds.filter((id) => SAFE_ID.test(id));
    const sources: FileSource[] = [];
    let visited = 0;
    for (const suppliedRoot of input.roots) {
      const root = await fs.realpath(suppliedRoot).catch(() => null);
      if (!root) continue;
      const visit = async (directory: string, depth: number): Promise<void> => {
        if (depth > 6 || visited > 20_000 || sources.length >= 64) return;
        const children = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
        for (const entry of children) {
          if (++visited > 20_000) return;
          const file = path.join(directory, entry.name);
          if (entry.isSymbolicLink()) continue;
          if (entry.isDirectory()) {
            await visit(file, depth + 1);
            continue;
          }
          if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
          const childId = ids.find((id) => input.provider === 'codex'
            ? entry.name.startsWith('rollout-') && entry.name.endsWith(`-${id}.jsonl`)
            : entry.name === `agent-${id}.jsonl`);
          if (!childId) continue;
          if (input.provider === 'claude-code') {
            const parentDirectory = path.dirname(directory);
            const parentId = path.basename(parentDirectory);
            const directoryName = path.basename(directory);
            if (directoryName !== 'subagents' || !parents.includes(parentId)) continue;
          }
          sources.push({ file, root, childId });
        }
      };
      await visit(root, 0);
    }
    sources.sort((left, right) => left.childId.localeCompare(right.childId));
    // A relocated transcript may exist in more than one home. Never render it twice.
    const unique = sources.filter((source, index) => sources.findIndex((item) => item.childId === source.childId) === index);
    if (this.discoveries.size >= 128) this.discoveries.clear();
    this.discoveries.set(key, { at: now, sources: unique });
    return unique;
  }

  async read(input: NativeSubagentTranscriptRequest): Promise<SubagentTranscriptPageResponse> {
    const sources = await this.discover(input);
    if (!sources.length) return { supported: true, entries: [], incomplete: true };
    const positions: Record<string, Position> = Object.create(null);
    if (input.cursor && input.cursor.length <= 32_768) {
      try {
        const decoded = Buffer.from(input.cursor, 'base64url').toString('utf8');
        const value: unknown = JSON.parse(decoded);
        const parsed = record(value);
        if (parsed.runId === input.runId && parsed.provider === input.provider) {
          const supplied = record(parsed.positions);
          for (const source of sources) positions[source.childId] = record(supplied[source.childId]) as unknown as Position;
        }
      } catch { /* An obsolete cursor restarts from the beginning. */ }
    }
    const entries: SubagentTranscriptEntry[] = [];
    const requestedLimit = Number.isFinite(input.limit) ? Math.floor(input.limit!) : 100;
    const positiveLimit = Math.max(1, requestedLimit);
    const limit = Math.min(200, positiveLimit);
    let more = false;
    let incomplete = false;
    let remainingBytes = MAX_READ_BYTES;
    for (const source of sources) {
      if (entries.length >= limit || remainingBytes <= 0) { more = true; break; }
      const real = await fs.realpath(source.file).catch(() => null);
      if (!real || !inside(source.root, real)) { incomplete = true; continue; }
      const handle = await fs.open(real, 'r').catch(() => null);
      if (!handle) { incomplete = true; continue; }
      try {
        const stat = await handle.stat();
        if (!stat.isFile()) { incomplete = true; continue; }
        const saved = positions[source.childId];
        const offset = saved && Number.isSafeInteger(saved.offset) && saved.offset >= 0 && saved.offset <= stat.size ? saved.offset : 0;
        const block = offset === saved?.offset && Number.isSafeInteger(saved.block) && saved.block >= 0 && saved.block < MAX_READ_BYTES ? saved.block : 0;
        const bufferSize = Math.min(remainingBytes, stat.size - offset);
        const buffer = Buffer.alloc(bufferSize);
        const readOptions = { buffer, position: offset };
        const { bytesRead } = await handle.read(readOptions);
        remainingBytes -= bytesRead;
        let start = 0;
        const skipping = offset === saved?.offset && saved.skipping === true;
        let position: Position = { offset, block, ...(skipping ? { skipping: true } : {}) };
        for (let index = 0; index < bytesRead; index++) {
          if (buffer[index] !== 10) continue;
          const lineOffset = offset + start;
          const line = buffer.toString('utf8', start, index);
          const skipped = start === 0 && skipping;
          start = index + 1;
          let projected: SubagentTranscriptEntry[] = [];
          if (!skipped) {
            try {
              const parsed: unknown = JSON.parse(line);
              const context = { provider: input.provider, childId: source.childId, offset: lineOffset, startedAt: input.startedAt };
              projected = projectNativeSubagentLine(parsed, context);
              if (line.length > MAX_TEXT) incomplete = true;
            } catch { incomplete = true; }
          } else incomplete = true;
          const from = lineOffset === offset ? block : 0;
          const available = limit - entries.length;
          const batch = projected.slice(from, from + available);
          entries.push(...batch);
          if (projected.length - from > available) {
            position = { offset: lineOffset, block: from + available };
            more = true;
            break;
          }
          position = { offset: offset + start, block: 0 };
          if (entries.length >= limit) { more ||= position.offset < stat.size; break; }
        }
        if (start === 0 && bytesRead === MAX_READ_BYTES && offset + bytesRead < stat.size) {
          // Skip an oversized JSONL row in bounded chunks instead of allocating its whole body.
          position = { offset: offset + bytesRead, block: 0, skipping: true };
          incomplete = true;
          more = true;
        } else if (offset + bytesRead < stat.size) more = true;
        positions[source.childId] = position;
      } finally { await handle.close(); }
    }
    const cursorJson = JSON.stringify({ runId: input.runId, provider: input.provider, positions });
    const cursor = Buffer.from(cursorJson).toString('base64url');
    return { supported: true, entries, tailCursor: cursor, ...(more ? { nextCursor: cursor } : {}), ...(incomplete ? { incomplete: true } : {}) };
  }
}
