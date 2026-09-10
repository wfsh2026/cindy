import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NativeSubagentTranscriptReader, projectNativeSubagentLine, type NativeSubagentTranscriptRequest } from '../native-subagent-transcript.js';

describe('native Subagent transcript reading', () => {
  let root: string;
  let reader: NativeSubagentTranscriptReader;
  const startedAt = Date.parse('2026-09-08T00:00:00Z');
  const childId = 'child-1';
  let input: NativeSubagentTranscriptRequest;
  beforeEach(async () => {
    const temp = os.tmpdir();
    const prefix = path.join(temp, 'cindy-subagent-read-');
    root = await fs.mkdtemp(prefix);
    reader = new NativeSubagentTranscriptReader();
    input = { provider: 'codex', roots: [root], runId: 'run-1', childIds: [childId], parentSessionIds: ['parent'], startedAt };
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });
  const line = (payload: unknown, timestamp = '2026-09-08T00:00:01Z') => JSON.stringify({ type: 'response_item', timestamp, payload }) + '\n';
  const write = async (text: string, id = childId) => {
    const filename = path.join(root, `rollout-date-${id}.jsonl`);
    await fs.writeFile(filename, text);
    return filename;
  };
  it('reads only the selected child and excludes inherited history, instructions and private reasoning', async () => {
    const text = line({ type: 'message', role: 'assistant', content: [{ text: 'inherited' }] }, '2026-09-07T23:59:59Z')
      + line({ type: 'message', role: 'developer', content: [{ text: 'private instructions' }] })
      + line({ type: 'reasoning', encrypted_content: 'private' })
      + line({ type: 'message', role: 'assistant', content: [{ text: 'child output' }] });
    await write(text);
    const other = line({ type: 'message', role: 'assistant', content: [{ text: 'another child' }] });
    await write(other, 'other');
    const result = await reader.read(input);
    const contents = result.entries.map((entry) => entry.content);
    expect(contents).toEqual(['child output']);
  });
  it('pages within a Claude message without skipping sibling blocks, then tails appended output', async () => {
    const directory = path.join(root, 'project', 'parent', 'subagents');
    await fs.mkdir(directory, { recursive: true });
    const filename = path.join(directory, 'agent-child-1.jsonl');
    const record = { type: 'assistant', timestamp: '2026-09-08T00:00:01Z', message: { content: [{ type: 'text', text: 'first' }, { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'file.ts' } }] } };
    const text = JSON.stringify(record) + '\n';
    await fs.writeFile(filename, text);
    input = { ...input, provider: 'claude-code', limit: 1 };
    const first = await reader.read(input);
    expect(first.entries[0].content).toBe('first');
    const secondInput = { ...input, cursor: first.nextCursor };
    const second = await reader.read(secondInput);
    expect(second.entries[0].toolPhase).toBe('start');
    expect(second.nextCursor).toBeUndefined();
    const output = JSON.stringify({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file content' }] } }) + '\n';
    await fs.appendFile(filename, output);
    const thirdInput = { ...input, cursor: second.tailCursor };
    const third = await reader.read(thirdInput);
    expect(third.entries[0].content).toBe('file content');
    expect(third.entries[0].toolCallId).toBe('tool-1');
    expect(third.entries[0].toolPhase).toBe('end');
  });
  it('does not consume an incomplete UTF-8 row before the writer finishes it', async () => {
    const text = line({ type: 'message', role: 'assistant', content: [{ text: '正在检查' }] });
    const prefix = text.slice(0, -3);
    const file = await write(prefix);
    const first = await reader.read(input);
    expect(first.entries).toEqual([]);
    const suffix = text.slice(-3);
    await fs.appendFile(file, suffix);
    const nextInput = { ...input, cursor: first.tailCursor };
    const result = await reader.read(nextInput);
    expect(result.entries[0].content).toBe('正在检查');
  });
  it('requires a matching Claude parent directory even when the child id matches', async () => {
    const directory = path.join(root, 'project', 'different-parent', 'subagents');
    await fs.mkdir(directory, { recursive: true });
    const filename = path.join(directory, 'agent-child-1.jsonl');
    const text = JSON.stringify({ type: 'assistant', message: { content: 'wrong parent' } }) + '\n';
    await fs.writeFile(filename, text);
    const request = { ...input, provider: 'claude-code' as const };
    const result = await reader.read(request);
    expect(result.entries).toEqual([]);
    expect(result.incomplete).toBe(true);
  });
  it('retains call identity and custom-tool input/output without treating output as instructions', () => {
    const context = { provider: 'codex' as const, childId, offset: 10, startedAt };
    const raw = { type: 'response_item', timestamp: '2026-09-08T00:00:01Z', payload: { type: 'custom_tool_call', call_id: 'call-1', name: 'apply_patch', input: 'patch body' } };
    const entries = projectNativeSubagentLine(raw, context);
    expect(entries[0]).toMatchObject({ toolName: 'apply_patch', toolCallId: 'call-1', toolInputJson: 'patch body', toolPhase: 'start' });
  });

  it('skips oversized rows in bounded pages and resumes with the next complete message', async () => {
    const huge = 'x'.repeat(2 * 1024 * 1024);
    const oversized = line({ type: 'message', role: 'assistant', content: huge });
    const normal = line({ type: 'message', role: 'assistant', content: 'after oversized' });
    const text = oversized + normal;
    await write(text);
    const first = await reader.read(input);
    expect(first.incomplete).toBe(true);
    expect(first.entries).toEqual([]);
    const secondInput = { ...input, cursor: first.nextCursor };
    const second = await reader.read(secondInput);
    expect(second.nextCursor).not.toBe(first.nextCursor);
    const thirdInput = { ...input, cursor: second.nextCursor };
    const third = await reader.read(thirdInput);
    expect(third.entries[0]?.content).toBe('after oversized');
    expect(third.incomplete).toBe(true);
  });

  it('pages all selected children without re-emitting earlier children', async () => {
    const firstText = line({ type: 'message', role: 'assistant', content: 'first child' });
    const secondText = line({ type: 'message', role: 'assistant', content: 'second child' });
    await write(firstText);
    await write(secondText, 'child-2');
    const request = { ...input, childIds: ['child-1', 'child-2'], limit: 1 };
    const first = await reader.read(request);
    const next = { ...request, cursor: first.nextCursor };
    const second = await reader.read(next);
    expect(first.entries[0]?.childId).toBe('child-1');
    expect(second.entries[0]?.childId).toBe('child-2');
    expect(second.nextCursor).toBeUndefined();
  });

  it.each(['not-a-cursor', 'null', '{"provider":"codex","runId":"other","positions":{}}'])('restarts safely with invalid or foreign cursor %s', async (raw) => {
    const text = line({ type: 'message', role: 'assistant', content: 'visible' });
    await write(text);
    const cursor = Buffer.from(raw).toString('base64url');
    const request = { ...input, cursor };
    const result = await reader.read(request);
    expect(result.entries[0]?.content).toBe('visible');
  });

  it('restarts after a truncated file without carrying a stale block offset', async () => {
    const text = line({ type: 'message', role: 'assistant', content: 'old long answer' });
    await write(text);
    const first = await reader.read(input);
    const replacement = line({ type: 'message', role: 'assistant', content: 'new' });
    await write(replacement);
    const request = { ...input, cursor: first.tailCursor };
    const second = await reader.read(request);
    expect(second.entries[0]?.content).toBe('new');
  });
});
