import { subagentIdentityVariant, type SubagentPresentationSource } from '@cindy/maker-shared/subagent-workspace';

/** The same quiet geometric identity appears in the conversation, list and reader. */
export function SubagentAvatar({ source, size = 18 }: { source: SubagentPresentationSource; size?: number }) {
  const variant = subagentIdentityVariant(source);
  const color = `var(--subagent-identity-${variant + 1})`;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ color }} className="shrink-0" aria-hidden="true" data-subagent-avatar={variant}>
    {[0, 60, 120, 180, 240, 300].map((angle) => <path key={angle} d="M12 1 15 5 12 9 9 5Z" transform={`rotate(${angle} 12 12)`} opacity="0.8" />)}
    <circle cx="12" cy="12" r="2.4" />
  </svg>;
}
