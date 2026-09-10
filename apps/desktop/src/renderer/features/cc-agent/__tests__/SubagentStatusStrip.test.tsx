// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentTaskUpdate, ChatMessage } from '@/hooks/useCCAgentChat';
import { SubagentStatusStrip } from '../SubagentStatusStrip';

const h = vi.hoisted(() => ({ open: vi.fn(async () => undefined) }));
vi.mock('@/features/right-sidebar/lib/openSubagentsTab', () => ({ openSubagentsTab: h.open }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, input?: { count: number }) => input ? `${input.count} running` : key }) }));
afterEach(cleanup);

describe('Subagent status strip', () => {
  it('groups Subagent statuses and opens a running child rather than a previously selected result', () => {
    const messages = [{ toolName: 'collab:spawn', toolUseId: 'spawn-1' }] as ChatMessage[];
    const updates = new Map<string, AgentTaskUpdate>([
      ['child', { provider: 'codex', taskId: 'child-1', parentToolUseId: 'spawn-1', status: 'running' }],
      ['bash', { provider: 'claude-code', taskId: 'bash-1', status: 'running', taskType: 'local_bash' }],
      ['ended', { provider: 'pi', taskId: 'ended-1', status: 'completed', taskType: 'pi_subagent' }],
    ]);
    render(<SubagentStatusStrip sessionId="parent-1" messages={messages} updates={updates} />);
    fireEvent.click(screen.getByRole('button', { name: '1 running · 1 rightSidebar.subagents.finished' }));
    expect(h.open).toHaveBeenCalledWith('parent-1', { focusRunId: 'spawn-1', focusProvider: 'codex' });
  });
});
