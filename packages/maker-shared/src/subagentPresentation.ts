/** Presentation only: native identities remain unchanged and are never used as headings. */
export interface SubagentPresentationSource {
  title?: string;
  description?: string;
  parentToolUseId?: string;
  logicalAgentId?: string;
  id?: string;
}

function identityHash(source: SubagentPresentationSource): number {
  const identity = source.parentToolUseId ?? source.logicalAgentId ?? source.id ?? source.title ?? '';
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    const code = identity.charCodeAt(index);
    hash = Math.imul(hash ^ code, 16777619);
  }
  return hash >>> 0;
}

const NAME_PREFIXES = [...'青星云清晓沐明墨松竹月雪晴林秋溪雨白南北山海花叶春夏冬晨晚朝落远'];
const NAME_SUFFIXES = [...'禾岚舟川泉棠宁竹鹿原溪林羽桐遥微安语歌桥庭露风杉帆榆岑澄兰枫萤澜'];

export function subagentWorkLabel(source: SubagentPresentationSource): string | undefined {
  for (const value of [source.title, source.description]) {
    const trimmed = value?.trim();
    if (!trimmed || /^\/root(?:\/|$)/.test(trimmed)) continue;
    const [line] = trimmed.split(/\r?\n/);
    const text = line.replace(/\s+/g, ' ');
    return text.length > 96 ? `${text.slice(0, 95)}…` : text;
  }
  return undefined;
}

/** A stable Chinese nickname; no storage, runtime renaming or model request is needed. */
export function subagentDisplayTitle(source: SubagentPresentationSource, _fallback?: string): string {
  const hash = identityHash(source);
  const prefix = NAME_PREFIXES[hash % NAME_PREFIXES.length];
  const remaining = Math.floor(hash / NAME_PREFIXES.length);
  const suffix = NAME_SUFFIXES[remaining % NAME_SUFFIXES.length];
  return `${prefix}${suffix}`;
}

export function subagentIdentityVariant(source: SubagentPresentationSource): number {
  const hash = identityHash(source);
  return hash % 4;
}
