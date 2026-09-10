import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { SubagentAvatar } from '@/components/chat/SubagentAvatar';
import type { AgentTaskUpdate, ChatMessage } from '@/hooks/useCCAgentChat';
import { isSubagentSpawnToolName } from '@cindy/maker-shared/agent-task';
import { openSubagentsTab } from '@/features/right-sidebar/lib/openSubagentsTab';

export function SubagentStatusStrip({ sessionId, updates, messages }: { sessionId: string; updates: ReadonlyMap<string, AgentTaskUpdate>; messages: ChatMessage[] }) {
  const { t } = useTranslation();
  const subagents = useMemo(() => {
    const ids = new Set<string>();
    for (const message of messages) {
      const toolName = message.toolName ?? '';
      const spawn = isSubagentSpawnToolName(toolName);
      if (spawn && message.toolUseId) ids.add(message.toolUseId);
    }
    const active = new Map<string, AgentTaskUpdate>();
    for (const update of updates.values()) {
      const id = update.parentToolUseId ?? update.taskId;
      if (ids.has(id) || update.taskType === 'pi_subagent') active.set(id, update);
    }
    return [...active.values()];
  }, [messages, updates]);
  if (!subagents.length) return null;
  const running = subagents.filter((update) => update.status === 'running');
  const finishedCount = subagents.length - running.length;
  const runningLabel = running.length > 0 ? t('rightSidebar.subagents.runningCount', { count: running.length }) : '';
  const finishedLabel = finishedCount > 0 ? `${finishedCount} ${t('rightSidebar.subagents.finished')}` : '';
  const labels = [runningLabel, finishedLabel].filter(Boolean);
  const accessibleLabel = labels.join(' · ');
  const open = () => {
    const first = running[0] ?? subagents[0];
    const options = { focusRunId: first.parentToolUseId ?? first.taskId, focusProvider: first.provider };
    void openSubagentsTab(sessionId, options);
  };
  return <div className="mb-1 flex justify-start"><button type="button" onClick={open} aria-label={accessibleLabel} className="inline-flex h-7 items-center gap-2 rounded-full px-3 text-12 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
    <span className="inline-flex gap-0.5" aria-hidden="true">{subagents.slice(0, 3).map((update) => <SubagentAvatar key={update.parentToolUseId ?? update.taskId} source={{ parentToolUseId: update.parentToolUseId, id: update.taskId }} size={14} />)}</span>
    {runningLabel && <span>{runningLabel}</span>}
    {finishedLabel && <span>{finishedLabel}</span>}
  </button></div>;
}
