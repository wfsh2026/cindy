import { describe, expect, it } from 'vitest';
import { collectAssistantTurnSubagents } from '../assistantTurnSubagents';
import type { ChatMessage } from '../makerChatStore';
import { buildRenderItems, collectTurnFinalAssistantClientIds, groupWorkRuns, selectVisibleMessages } from '../../components/chat/MessageStream';

function user(clientId: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return { clientId, role: 'user', content: 'request', ...extra };
}

function answer(clientId: string): ChatMessage {
  return { clientId, role: 'assistant', content: 'Conclusion', turnCompleted: true };
}

function spawn(toolUseId: string, toolName = 'collab:spawn', extra: Partial<ChatMessage> = {}): ChatMessage {
  return { clientId: toolUseId, role: 'tool_use', content: '', toolName, toolUseId, ...extra };
}

function collect(messages: ChatMessage[]) {
  const visible = selectVisibleMessages(messages);
  const finals = collectTurnFinalAssistantClientIds(visible);
  return collectAssistantTurnSubagents(messages, finals);
}

describe('answer Subagent shortcuts', () => {
  it('restores all three providers from durable messages without live updates', () => {
    const messages = [user('u1'), spawn('toolu_cc', 'Agent'), spawn('call_codex'), spawn('call_pi', 'subagent'), answer('a1')];
    const serialized = JSON.stringify(messages);
    const restored = JSON.parse(serialized) as ChatMessage[];
    const links = collect(restored);
    const entries = links.get('a1');
    expect(entries).toEqual([
      { parentToolUseId: 'toolu_cc', provider: 'claude-code' },
      { parentToolUseId: 'call_codex', provider: 'codex' },
      { parentToolUseId: 'call_pi', provider: 'pi' },
    ]);
  });

  it('keeps each answer separate, including later answers without Subagents', () => {
    const messages = [user('u1'), spawn('call_one'), answer('a1'), user('u2'), answer('a2'), user('u3'), spawn('call_three'), answer('a3')];
    const links = collect(messages);
    const first = links.get('a1');
    const second = links.get('a2');
    const third = links.get('a3');
    expect(first).toEqual([{ parentToolUseId: 'call_one', provider: 'codex' }]);
    expect(second).toBeUndefined();
    expect(third).toEqual([{ parentToolUseId: 'call_three', provider: 'codex' }]);
  });

  it('does not inherit another sealed answer or an interrupted user turn', () => {
    const messages = [user('u1'), spawn('call_one'), answer('a1'), answer('followup'), user('u2'), spawn('call_interrupted'), user('u3'), answer('a3')];
    const links = collect(messages);
    const keys = [...links.keys()];
    expect(keys).toEqual(['a1']);
  });

  it('keeps work through steering and automatic continuation before the conclusion', () => {
    const messages = [user('u1'), spawn('call_one'), user('steer', { delivery: 'steer' }), user('trigger', { isSyntheticTrigger: true }), user('resume', { systemCardType: 'auto-resume' }), answer('a1')];
    const links = collect(messages);
    const entries = links.get('a1');
    expect(entries).toEqual([{ parentToolUseId: 'call_one', provider: 'codex' }]);
  });

  it('ignores child messages, nested spawns and ordinary tools; deduplicates spawn calls', () => {
    const child = { parentToolUseId: 'toolu_parent' };
    const messages = [user('u1'), spawn('toolu_parent', 'Task'), user('child-user', child), spawn('call_nested', 'Agent', child), spawn('toolu_parent', 'Task'), spawn('call_shell', 'Bash'), spawn('call_wait', 'collab:wait'), answer('a1')];
    const links = collect(messages);
    const entries = links.get('a1');
    expect(entries).toEqual([{ parentToolUseId: 'toolu_parent', provider: 'claude-code' }]);
  });

  it('handles partial history without inventing missing Subagents', () => {
    const messages = [spawn('call_loaded'), answer('a1'), user('u2'), answer('a2')];
    const links = collect(messages);
    const entries = links.get('a1');
    const later = links.get('a2');
    expect(entries).toEqual([{ parentToolUseId: 'call_loaded', provider: 'codex' }]);
    expect(later).toBeUndefined();
  });

  it('attaches shortcuts to the conclusion outside its collapsed work group', () => {
    const result: ChatMessage = { clientId: 'result', role: 'tool_result', toolUseId: 'toolu_one', content: 'Work completed' };
    const messages = [user('u1'), spawn('toolu_one', 'Agent'), result, answer('a1')];
    const links = collect(messages);
    const { items } = buildRenderItems(messages);
    const grouped = groupWorkRuns(items, false);
    const final = grouped.find((item) => item.type === 'message' && item.message.clientId === 'a1');
    const hasWork = grouped.some((item) => item.type === 'work_group');
    const entries = links.get('a1');
    expect(final).toBeDefined();
    expect(hasWork).toBe(true);
    expect(entries).toHaveLength(1);
  });
});
