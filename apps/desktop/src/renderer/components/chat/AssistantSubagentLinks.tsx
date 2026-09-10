import { subagentDisplayTitle } from '@cindy/maker-shared/subagent-workspace';
import { useSidebarPanelReachable } from '@/features/cc-agent/embeddedSessionNavigation';
import { openSubagentsTab } from '@/features/right-sidebar/lib/openSubagentsTab';
import type { AssistantTurnSubagent } from '@/lib/assistantTurnSubagents';
import { SubagentAvatar } from './SubagentAvatar';

export function AssistantSubagentLinks({ sessionId, subagents }: { sessionId?: string; subagents?: readonly AssistantTurnSubagent[] }) {
  const reachable = useSidebarPanelReachable(sessionId);
  if (!sessionId || !reachable || !subagents?.length) return null;

  return <div data-assistant-subagents="true" className="mt-2 flex flex-wrap items-center gap-2">
    {subagents.map((subagent) => {
      const label = subagentDisplayTitle(subagent);
      const key = `${subagent.provider}:${subagent.parentToolUseId}`;
      const open = () => {
        const options = { focusRunId: subagent.parentToolUseId, focusProvider: subagent.provider };
        void openSubagentsTab(sessionId, options);
      };
      return <button key={key} type="button" onClick={open} className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-[var(--border-default)] px-2.5 py-1 text-13 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
        <SubagentAvatar source={subagent} size={16} />
        <span>{label}</span>
      </button>;
    })}
  </div>;
}
