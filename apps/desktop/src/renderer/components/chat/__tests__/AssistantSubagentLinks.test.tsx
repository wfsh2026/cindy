// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { subagentDisplayTitle } from '@cindy/maker-shared/subagent-workspace';
import type { AssistantTurnSubagent } from '@/lib/assistantTurnSubagents';
import { AssistantSubagentLinks } from '../AssistantSubagentLinks';

const harness = vi.hoisted(() => ({ reachable: true, open: vi.fn() }));
vi.mock('@/features/right-sidebar/lib/openSubagentsTab', () => ({ openSubagentsTab: harness.open }));
vi.mock('@/features/cc-agent/embeddedSessionNavigation', () => ({ useSidebarPanelReachable: () => harness.reachable }));
afterEach(() => { cleanup(); harness.reachable = true; harness.open.mockClear(); });

describe('AssistantSubagentLinks', () => {
  it('shows Chinese names with avatars and opens the exact provider and run', () => {
    const subagents: AssistantTurnSubagent[] = [
      { parentToolUseId: 'toolu_cc', provider: 'claude-code' },
      { parentToolUseId: 'call_codex', provider: 'codex' },
      { parentToolUseId: 'call_pi', provider: 'pi' },
    ];
    const view = <AssistantSubagentLinks sessionId="session-one" subagents={subagents} />;
    const result = render(view);
    const buttons = result.getAllByRole('button');
    const avatars = result.container.querySelectorAll('[data-subagent-avatar]');
    expect(buttons).toHaveLength(3);
    expect(avatars).toHaveLength(3);
    for (const [index, subagent] of subagents.entries()) {
      const label = subagentDisplayTitle(subagent);
      expect(buttons[index].textContent).toBe(label);
      expect(label).toMatch(/^[\u4e00-\u9fff]{2}$/);
      fireEvent.click(buttons[index]);
      const options = { focusRunId: subagent.parentToolUseId, focusProvider: subagent.provider };
      expect(harness.open).toHaveBeenLastCalledWith('session-one', options);
    }
  });

  it('does not show empty rows or unreachable sidebar actions', () => {
    const empty = <AssistantSubagentLinks sessionId="session-one" />;
    const result = render(empty);
    expect(result.container.childElementCount).toBe(0);
    harness.reachable = false;
    const subagents: AssistantTurnSubagent[] = [{ parentToolUseId: 'call_one', provider: 'codex' }];
    const embedded = <AssistantSubagentLinks sessionId="session-one" subagents={subagents} />;
    result.rerender(embedded);
    expect(result.container.childElementCount).toBe(0);
    harness.reachable = true;
    const missingSession = <AssistantSubagentLinks subagents={subagents} />;
    result.rerender(missingSession);
    expect(result.container.childElementCount).toBe(0);
  });
});
