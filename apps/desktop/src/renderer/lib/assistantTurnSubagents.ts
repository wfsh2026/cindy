import { isSubagentSpawnToolName } from '@cindy/maker-shared/agent-task';
import { isSubagentParentToolUseId } from '@cindy/maker-shared/message-render';
import type { SubagentProvider } from '@cindy/maker-shared/subagent-workspace';
import type { ChatMessage } from './makerChatStore';

export interface AssistantTurnSubagent {
  parentToolUseId: string;
  provider: SubagentProvider;
}

/** Reconstruct answer shortcuts from durable spawn calls, including after history reload. */
export function collectAssistantTurnSubagents(messages: readonly ChatMessage[], finalAnswerIds: ReadonlySet<string>): Map<string, readonly AssistantTurnSubagent[]> {
  const answers = new Map<string, readonly AssistantTurnSubagent[]>();
  let pending = new Map<string, AssistantTurnSubagent>();
  for (const message of messages) {
    const parentId = message.parentToolUseId;
    const internal = parentId ? isSubagentParentToolUseId(parentId) : false;
    if (internal) continue;
    if (message.role === 'user' && message.delivery !== 'steer' && !message.isSyntheticTrigger && message.systemCardType !== 'auto-resume') {
      pending = new Map();
      continue;
    }
    if (message.role === 'tool_use' && message.toolUseId) {
      const name = message.toolName ?? '';
      const spawn = isSubagentSpawnToolName(name);
      if (spawn) {
        const provider = name.startsWith('collab:') ? 'codex' : name === 'subagent' ? 'pi' : 'claude-code';
        const entry: AssistantTurnSubagent = { parentToolUseId: message.toolUseId, provider };
        const key = `${provider}:${message.toolUseId}`;
        pending.set(key, entry);
      }
    }
    if (message.role !== 'assistant' || !finalAnswerIds.has(message.clientId)) continue;
    if (pending.size > 0) {
      const entries = [...pending.values()];
      answers.set(message.clientId, entries);
    }
    // A sealed answer owns its preceding work; later answers must not inherit it.
    pending = new Map();
  }
  return answers;
}
