/**
 * 项目经验包的宿主无关读取模型。
 * 这里只负责结构化解析和选择计划，不读取文件、不执行工具，也不授予权限。
 */

export type ExperienceModuleKind = 'role' | 'rule' | 'knowledge' | 'process' | 'tool' | 'output';
export type ExperienceModuleStatus = 'pending' | 'ready';
export type ExperienceRequirementKind = 'environment' | 'intent' | 'authorization' | 'evidence';
export type ExperienceConditionState = 'satisfied' | 'unsatisfied' | 'unknown';

export type ExperienceModule = {
  id: string;
  kind: ExperienceModuleKind;
  name: string;
  summary: string;
  status: ExperienceModuleStatus;
  requires: string[];
};

export type ExperienceRequirement = {
  id: string;
  kind: ExperienceRequirementKind;
  description: string;
};

export type ExperienceWorkflowNode = {
  id: string;
  name: string;
  defaultEnabled: boolean;
  skippable: boolean;
  when: string | null;
  after: string[];
  requires: string[];
  modules: string[];
  optionalModules: string[];
  requirements: string[];
  effects?: string[];
};

export type ExperienceWorkflow = {
  id: string;
  name?: string;
  nodes: ExperienceWorkflowNode[];
};

export type ExperiencePack = {
  id: string;
  version: string;
  protocolVersion: string;
  modules: ExperienceModule[];
  requirements: ExperienceRequirement[];
  workflows: ExperienceWorkflow[];
};

/** Routing rule projected from routing.json. Kept separate from the pack so the
 * renderer can render a light index without loading module正文. */
export type ExperienceRoutingRule = {
  workflowId: string;
  intents: string[];
  exclusions: string[];
};

export type ExperienceRouting = {
  defaultMode: 'auto';
  explicitSelection: 'exclusive';
  ambiguousMatch: 'ask-user';
  noMatch: 'ask-user';
  switchWorkflow: 'explicit-only';
  rules: ExperienceRoutingRule[];
};

export type ExperienceModuleContent = {
  id: string;
  kind: ExperienceModuleKind;
  name: string;
  summary: string;
  sha256: string;
  bytes: number;
  text: string;
};

/** Main-owned正文 snapshot carried only across the local dispatch boundary. */
export type ExperienceInputContext = {
  version: 1;
  packId: string;
  packVersion: string;
  workflowId: string;
  mode: 'auto' | 'explicit';
  planDigest: string;
  modules: ExperienceModuleContent[];
};

export type ExperienceSelectionOverride = {
  workflowId: string;
  ignoredNodeIds: string[];
  ignoredModuleIds: string[];
};

export type ExperienceSelection = {
  mode: 'auto' | 'explicit';
  workflowId: string | null;
  overrides: ExperienceSelectionOverride[];
};

/** Selection snapshot accepted from the composer. It contains no正文 or host data. */
export type ExperienceSelectionSnapshot = {
  version: 1;
  packId: string;
  mode: 'auto' | 'explicit';
  workflowId: string | null;
  ignoredNodeIds: string[];
  ignoredModuleIds: string[];
  conditions?: Record<string, ExperienceConditionState>;
};

const EXPERIENCE_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const EXPERIENCE_MAX_SELECTION_IDS = 1024;
const EXPERIENCE_MAX_CONDITIONS = 128;
const EXPERIENCE_SELECTION_KEYS = new Set([
  'version',
  'packId',
  'mode',
  'workflowId',
  'ignoredNodeIds',
  'ignoredModuleIds',
  'conditions',
]);

/**
 * Narrow the renderer/device-link payload at the host boundary.  Selection is
 * intentionally metadata-only: it may name a pack/workflow/module, but it can
 * never carry experience正文 or host capabilities.
 */
export function isExperienceSelectionSnapshot(value: unknown): value is ExperienceSelectionSnapshot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).some((key) => !EXPERIENCE_SELECTION_KEYS.has(key))) return false;
  if (
    candidate.version !== 1 ||
    typeof candidate.packId !== 'string' ||
    !isBoundedExperienceId(candidate.packId, 128) ||
    (candidate.mode !== 'auto' && candidate.mode !== 'explicit') ||
    (candidate.workflowId !== null && typeof candidate.workflowId !== 'string') ||
    !Array.isArray(candidate.ignoredNodeIds) ||
    !Array.isArray(candidate.ignoredModuleIds)
  ) return false;
  if (candidate.ignoredNodeIds.length > EXPERIENCE_MAX_SELECTION_IDS || candidate.ignoredModuleIds.length > EXPERIENCE_MAX_SELECTION_IDS) return false;
  if (!candidate.ignoredNodeIds.every((item) => isBoundedExperienceId(item, 256))) return false;
  if (!candidate.ignoredModuleIds.every((item) => isBoundedExperienceId(item, 256))) return false;
  if (candidate.mode === 'auto' && candidate.workflowId !== null) return false;
  if (candidate.mode === 'explicit' && candidate.workflowId !== null && !isBoundedExperienceId(candidate.workflowId, 256)) return false;
  if (candidate.conditions !== undefined) {
    if (!candidate.conditions || typeof candidate.conditions !== 'object' || Array.isArray(candidate.conditions)) return false;
    const conditions = Object.entries(candidate.conditions as Record<string, unknown>);
    if (conditions.length > EXPERIENCE_MAX_CONDITIONS) return false;
    for (const [id, state] of conditions) {
      if (!isBoundedExperienceId(id, 256)) return false;
      if (state !== 'satisfied' && state !== 'unsatisfied' && state !== 'unknown') return false;
    }
  }
  return true;
}

/** Return a bounded, de-duplicated selection snapshot or null for untrusted input. */
export function normalizeExperienceSelectionSnapshot(value: unknown): ExperienceSelectionSnapshot | null {
  if (!isExperienceSelectionSnapshot(value)) return null;
  const packId = value.packId.trim();
  const workflowId = value.mode === 'explicit' ? value.workflowId?.trim() ?? null : null;
  if (!isBoundedExperienceId(packId, 128)) return null;
  if (value.mode === 'explicit' && workflowId !== null && !isBoundedExperienceId(workflowId, 256)) return null;
  const ignoredNodeIds = [...new Set(value.ignoredNodeIds.map((item) => item.trim()))];
  const ignoredModuleIds = [...new Set(value.ignoredModuleIds.map((item) => item.trim()))];
  if (!ignoredNodeIds.every((item) => isBoundedExperienceId(item, 256))) return null;
  if (!ignoredModuleIds.every((item) => isBoundedExperienceId(item, 256))) return null;
  const conditions = value.conditions
    ? Object.fromEntries(Object.entries(value.conditions))
    : undefined;
  return {
    version: 1,
    packId,
    mode: value.mode,
    workflowId,
    ignoredNodeIds,
    ignoredModuleIds,
    ...(conditions && Object.keys(conditions).length > 0 ? { conditions } : {}),
  };
}

export type ExperienceModuleState = 'enabled' | 'ignored' | 'blocked' | 'unavailable';

export type ExperienceModulePlan = {
  id: string;
  state: ExperienceModuleState;
  reason: string | null;
};

export type ExperienceNodePlan = {
  id: string;
  state: 'enabled' | 'ignored' | 'blocked' | 'not-applicable' | 'waiting';
  modules: ExperienceModulePlan[];
  reasons: string[];
};

export type ExperienceContextPlan = {
  packId: string;
  packVersion: string;
  workflowId: string;
  mode: ExperienceSelection['mode'];
  nodes: ExperienceNodePlan[];
  moduleIds: string[];
};

export type ExperienceRouteResult =
  | { kind: 'matched'; workflowId: string; candidates: string[] }
  | { kind: 'ambiguous'; candidates: string[] }
  | { kind: 'no-match'; candidates: [] };

export type ExperienceContextSnapshot = {
  version: 1;
  sessionId: string;
  /** Composer client id that caused this freeze; absent in early snapshots. */
  clientId?: string;
  /** Hash of the input text + selection, used to avoid reusing another turn. */
  inputDigest?: string;
  /** Condition evidence used to build this frozen plan.  It is metadata only. */
  conditions?: Record<string, ExperienceConditionState>;
  packId: string;
  packVersion: string;
  workflowId: string;
  mode: ExperienceSelection['mode'];
  ignoredNodeIds: string[];
  ignoredModuleIds: string[];
  plan: ExperienceContextPlan;
  planDigest: string;
  modules: ExperienceModuleContent[];
  createdAt: string;
  updatedAt: string;
};

/** Small renderer-facing projection returned by the host registry. */
export type ExperiencePackSummary = {
  packId: string;
  packVersion: string;
  name: string;
  ghostId: string;
  enabled: boolean;
  status: 'ready' | 'invalid' | 'unsupported' | 'unavailable';
  reason?: string;
  workflows: Array<{ id: string; name: string; summary: string; status: 'ready' | 'pending' }>;
};

export type ExperiencePackDocument = {
  /** Pack-level modules required for every workflow; absent in legacy packages. */
  requiredModules?: string[];
  protocolVersion: string;
  id: string;
  version: string;
  name: string;
  status: 'draft' | 'ready';
  entries: {
    catalog: string;
    modules: string;
    requirements: string;
    routing: string;
  };
};

export type ExperienceCatalogWorkflow = {
  id: string;
  name: string;
  summary: string;
  path: string;
  status?: 'ready' | 'pending';
};

export type ExperienceModuleIndexEntry = ExperienceModule & {
  content: { path: string; sha256: string; bytes: number } | null;
  sources?: Array<{ path: string; section: string }>;
};

export type ExperienceWorkflowDocument = ExperienceWorkflow & {
  effects?: string[];
};

export type ExperiencePackIndex = {
  pack: ExperiencePackDocument;
  catalog: { workflows: ExperienceCatalogWorkflow[] };
  modules: ExperienceModuleIndexEntry[];
  requirements: ExperienceRequirement[];
  routing: ExperienceRouting;
  workflows: ExperienceWorkflowDocument[];
  status: ExperiencePackSummary['status'];
  reason?: string;
};

export type ExperienceResolveResult = {
  pack: ExperiencePackSummary;
  plan: ExperienceContextPlan | null;
  selection: ExperienceSelectionSnapshot;
  route: ExperienceRouteResult | null;
  requiresUserChoice: boolean;
  reason?: string;
};

/** Renderer/device-link task projection.  It intentionally omits module正文. */
export type ExperiencePackTaskMetadata = {
  version: 1;
  sessionId: string;
  clientId?: string;
  inputDigest?: string;
  packId: string;
  packVersion: string;
  workflowId: string;
  mode: 'auto' | 'explicit';
  ignoredNodeIds: string[];
  ignoredModuleIds: string[];
  conditions?: Record<string, ExperienceConditionState>;
  plan: ExperienceContextPlan;
  planDigest: string;
  createdAt: string;
  updatedAt: string;
};

export type ExperiencePackListResult = { packs: ExperiencePackSummary[] };
export type ExperiencePackGetResult = { index: ExperiencePackIndex | null };
export type ExperiencePackTaskResult = {
  selection: ExperienceSelectionSnapshot;
  plan: ExperienceContextPlan | null;
  requiresUserChoice: boolean;
  fallbackReason?: string;
};
export type ExperiencePackFallbackPayload = {
  sessionId: string;
  packId: string;
  reason: string;
};

const EXPERIENCE_PACK_STATUSES = new Set(['ready', 'invalid', 'unsupported', 'unavailable']);
const EXPERIENCE_NODE_STATES = new Set(['enabled', 'ignored', 'blocked', 'not-applicable', 'waiting']);
const EXPERIENCE_MODULE_STATES = new Set(['enabled', 'ignored', 'blocked', 'unavailable']);

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedText(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength && !/[\u0000-\u001f\u007f]/.test(value);
}

function isOptionalText(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || isBoundedText(value, maxLength);
}

function isExperienceHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
}

function isExperienceDate(value: unknown): value is string {
  return isBoundedText(value, 64) && Number.isFinite(Date.parse(value));
}

function isExperienceStringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => isBoundedText(item, maxLength));
}

function isExperienceConditions(value: unknown): value is Record<string, ExperienceConditionState> {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > EXPERIENCE_MAX_CONDITIONS) return false;
  return entries.every(([id, state]) => isBoundedExperienceId(id, 256) && (state === 'satisfied' || state === 'unsatisfied' || state === 'unknown'));
}

function isExperienceModuleContent(value: unknown): value is ExperienceModuleContent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return hasOnlyKeys(item, ['id', 'kind', 'name', 'summary', 'sha256', 'bytes', 'text']) &&
    isBoundedExperienceId(item.id, 256) && isExperienceModuleKindValue(item.kind) &&
    isBoundedText(item.name, 512) && isBoundedText(item.summary, 4096) && isExperienceHash(item.sha256) &&
    Number.isSafeInteger(item.bytes) && (item.bytes as number) > 0 && (item.bytes as number) <= 512 * 1024 &&
    typeof item.text === 'string' && new TextEncoder().encode(item.text).byteLength === item.bytes;
}

function isExperienceModuleKindValue(value: unknown): value is ExperienceModuleKind {
  return value === 'role' || value === 'rule' || value === 'knowledge' || value === 'process' || value === 'tool' || value === 'output';
}

function isExperiencePlan(value: unknown): value is ExperienceContextPlan {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const plan = value as Record<string, unknown>;
  if (!hasOnlyKeys(plan, ['packId', 'packVersion', 'workflowId', 'mode', 'nodes', 'moduleIds']) ||
    !isBoundedExperienceId(plan.packId, 128) || !isBoundedText(plan.packVersion, 128) ||
    !isBoundedExperienceId(plan.workflowId, 256) || (plan.mode !== 'auto' && plan.mode !== 'explicit') ||
    !Array.isArray(plan.nodes) || plan.nodes.length > 1024 || !isExperienceStringArray(plan.moduleIds, 2048, 256)) return false;
  return plan.nodes.every((rawNode) => {
    if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) return false;
    const node = rawNode as Record<string, unknown>;
    if (!hasOnlyKeys(node, ['id', 'state', 'modules', 'reasons']) || !isBoundedExperienceId(node.id, 256) ||
      typeof node.state !== 'string' || !EXPERIENCE_NODE_STATES.has(node.state) || !Array.isArray(node.modules) ||
      node.modules.length > 2048 || !isExperienceStringArray(node.reasons, 64, 2048)) return false;
    return node.modules.every((rawModule) => {
      if (!rawModule || typeof rawModule !== 'object' || Array.isArray(rawModule)) return false;
      const module = rawModule as Record<string, unknown>;
      return hasOnlyKeys(module, ['id', 'state', 'reason']) && isBoundedExperienceId(module.id, 256) &&
        typeof module.state === 'string' && EXPERIENCE_MODULE_STATES.has(module.state) &&
        (module.reason === null || isBoundedText(module.reason, 2048));
    });
  });
}

function isExperiencePackDocument(value: unknown): value is ExperiencePackDocument {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const pack = value as Record<string, unknown>;
  if (!hasOnlyKeys(pack, ['protocolVersion', 'id', 'version', 'name', 'status', 'entries', 'requiredModules']) ||
    (pack.requiredModules !== undefined && !isExperienceStringArray(pack.requiredModules, 256, 256)) ||
    pack.protocolVersion !== '0.1.0' || !isBoundedExperienceId(pack.id, 128) || !isBoundedText(pack.version, 128) ||
    !isBoundedText(pack.name, 512) || (pack.status !== 'draft' && pack.status !== 'ready') ||
    !pack.entries || typeof pack.entries !== 'object' || Array.isArray(pack.entries)) return false;
  const entries = pack.entries as Record<string, unknown>;
  return hasOnlyKeys(entries, ['catalog', 'modules', 'requirements', 'routing']) &&
    Object.values(entries).every((item) => isSafeExperienceRelativePath(item));
}

function isSafeExperienceRelativePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 256 || value.includes('\\') || value.includes(':') || value.includes('%') || value.includes('?') || value.includes('#') || /[\u0000-\u001f]/.test(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !/[ .]$/.test(segment));
}

function isExperienceCatalog(value: unknown, packId: string): value is { workflows: ExperienceCatalogWorkflow[] } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const catalog = value as Record<string, unknown>;
  if (!hasOnlyKeys(catalog, ['workflows']) || !Array.isArray(catalog.workflows) || catalog.workflows.length === 0 || catalog.workflows.length > 128) return false;
  const seen = new Set<string>();
  return catalog.workflows.every((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const workflow = raw as Record<string, unknown>;
    if (!hasOnlyKeys(workflow, ['id', 'name', 'summary', 'path', 'status']) || !isBoundedExperienceId(workflow.id, 256) || !workflow.id.startsWith(`${packId}.workflow.`) ||
      !isBoundedText(workflow.name, 512) || !isBoundedText(workflow.summary, 4096) || !isSafeExperienceRelativePath(workflow.path) ||
      (workflow.status !== undefined && workflow.status !== 'ready' && workflow.status !== 'pending') || seen.has(workflow.id)) return false;
    seen.add(workflow.id);
    return true;
  });
}

function isExperienceModuleIndex(value: unknown, packId: string): value is ExperienceModuleIndexEntry[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 4096) return false;
  const seen = new Set<string>();
  return value.every((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const module = raw as Record<string, unknown>;
    if (!hasOnlyKeys(module, ['id', 'kind', 'name', 'summary', 'status', 'requires', 'content', 'sources']) ||
      !isBoundedExperienceId(module.id, 256) || !module.id.startsWith(`${packId}.`) || !isExperienceModuleKindValue(module.kind) ||
      !isBoundedText(module.name, 512) || !isBoundedText(module.summary, 4096) ||
      (module.status !== 'ready' && module.status !== 'pending') || !isExperienceStringArray(module.requires, 256, 256) ||
      new Set(module.requires).size !== module.requires.length || seen.has(module.id)) return false;
    if (module.content !== null) {
      if (!module.content || typeof module.content !== 'object' || Array.isArray(module.content)) return false;
      const content = module.content as Record<string, unknown>;
      if (!hasOnlyKeys(content, ['path', 'sha256', 'bytes']) || !isSafeExperienceRelativePath(content.path) || !isExperienceHash(content.sha256) || !Number.isSafeInteger(content.bytes) || (content.bytes as number) <= 0 || (content.bytes as number) > 512 * 1024) return false;
    } else if (module.status === 'ready') return false;
    if (!Array.isArray(module.sources) || module.sources.length === 0 || module.sources.length > 128 || !module.sources.every((source) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) return false;
      const item = source as Record<string, unknown>;
      return hasOnlyKeys(item, ['path', 'section']) && isSafeExperienceRelativePath(item.path) && isBoundedText(item.section, 512);
    })) return false;
    seen.add(module.id);
    return true;
  });
}

function isExperienceRequirements(value: unknown, packId: string): value is ExperienceRequirement[] {
  if (!Array.isArray(value) || value.length > 1024) return false;
  const seen = new Set<string>();
  return value.every((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const requirement = raw as Record<string, unknown>;
    if (!hasOnlyKeys(requirement, ['id', 'kind', 'description']) || !isBoundedExperienceId(requirement.id, 256) || !requirement.id.startsWith(`${packId}.requirement.`) ||
      !['environment', 'intent', 'authorization', 'evidence'].includes(String(requirement.kind)) || !isBoundedText(requirement.description, 4096) || seen.has(requirement.id)) return false;
    seen.add(requirement.id);
    return true;
  });
}

function isExperienceRouting(value: unknown, packId: string): value is ExperienceRouting {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const routing = value as Record<string, unknown>;
  if (!hasOnlyKeys(routing, ['defaultMode', 'explicitSelection', 'ambiguousMatch', 'noMatch', 'switchWorkflow', 'rules']) ||
    routing.defaultMode !== 'auto' || routing.explicitSelection !== 'exclusive' || routing.ambiguousMatch !== 'ask-user' || routing.noMatch !== 'ask-user' || routing.switchWorkflow !== 'explicit-only' ||
    !Array.isArray(routing.rules) || routing.rules.length === 0 || routing.rules.length > 128) return false;
  const seen = new Set<string>();
  return routing.rules.every((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const rule = raw as Record<string, unknown>;
    if (!hasOnlyKeys(rule, ['workflowId', 'intents', 'exclusions']) || !isBoundedExperienceId(rule.workflowId, 256) || !rule.workflowId.startsWith(`${packId}.workflow.`) ||
      !isExperienceStringArray(rule.intents, 128, 256) || rule.intents.length === 0 || rule.intents.some((item) => item.trim().length === 0) ||
      !isExperienceStringArray(rule.exclusions, 128, 256) || rule.exclusions.some((item) => item.trim().length === 0) ||
      new Set(rule.intents).size !== rule.intents.length || new Set(rule.exclusions).size !== rule.exclusions.length || seen.has(rule.workflowId)) return false;
    seen.add(rule.workflowId);
    return true;
  });
}

function isExperienceWorkflowDocument(value: unknown, packId: string): value is ExperienceWorkflowDocument[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 128) return false;
  const seenWorkflows = new Set<string>();
  return value.every((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const workflow = raw as Record<string, unknown>;
    if (!hasOnlyKeys(workflow, ['id', 'name', 'nodes', 'effects']) || !isBoundedExperienceId(workflow.id, 256) || !workflow.id.startsWith(`${packId}.workflow.`) ||
      !isOptionalText(workflow.name, 512) || !Array.isArray(workflow.nodes) || workflow.nodes.length === 0 || workflow.nodes.length > 1024 || seenWorkflows.has(workflow.id)) return false;
    const seenNodes = new Set<string>();
    const nodesValid = workflow.nodes.every((rawNode) => {
      if (!rawNode || typeof rawNode !== 'object' || Array.isArray(rawNode)) return false;
      const node = rawNode as Record<string, unknown>;
      if (!hasOnlyKeys(node, ['id', 'name', 'defaultEnabled', 'skippable', 'when', 'after', 'requires', 'modules', 'optionalModules', 'requirements', 'effects']) ||
        !isBoundedExperienceId(node.id, 128) || !isBoundedText(node.name, 512) || typeof node.defaultEnabled !== 'boolean' || typeof node.skippable !== 'boolean' ||
        (node.when !== null && !isBoundedExperienceId(node.when, 256)) || !isExperienceStringArray(node.after, 1024, 128) || !isExperienceStringArray(node.requires, 1024, 128) ||
        !isExperienceStringArray(node.modules, 256, 256) || !isExperienceStringArray(node.optionalModules, 256, 256) || !isExperienceStringArray(node.requirements, 256, 256) ||
        !Array.isArray(node.effects) || node.effects.length > 16 || !node.effects.every((effect) => typeof effect === 'string') || seenNodes.has(node.id)) return false;
      seenNodes.add(node.id);
      return true;
    });
    if (!nodesValid) return false;
    seenWorkflows.add(workflow.id);
    return true;
  });
}

export function isExperiencePackSummary(value: unknown): value is ExperiencePackSummary {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const summary = value as Record<string, unknown>;
  if (!hasOnlyKeys(summary, ['packId', 'packVersion', 'name', 'ghostId', 'enabled', 'status', 'reason', 'workflows']) ||
    !isBoundedExperienceId(summary.packId, 128) || !isBoundedText(summary.packVersion, 128) || !isBoundedText(summary.name, 512) || !isBoundedText(summary.ghostId, 256) ||
    typeof summary.enabled !== 'boolean' || typeof summary.status !== 'string' || !EXPERIENCE_PACK_STATUSES.has(summary.status) || !isOptionalText(summary.reason, 1024) ||
    !Array.isArray(summary.workflows) || summary.workflows.length > 128) return false;
  return summary.workflows.every((raw) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
    const workflow = raw as Record<string, unknown>;
    return hasOnlyKeys(workflow, ['id', 'name', 'summary', 'status']) && isBoundedExperienceId(workflow.id, 256) && isBoundedText(workflow.name, 512) && isBoundedText(workflow.summary, 4096) && (workflow.status === 'ready' || workflow.status === 'pending');
  });
}

export function isExperiencePackIndex(value: unknown): value is ExperiencePackIndex {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const index = value as Record<string, unknown>;
  return hasOnlyKeys(index, ['pack', 'catalog', 'modules', 'requirements', 'routing', 'workflows', 'status', 'reason']) &&
    isExperiencePackDocument(index.pack) && isExperienceCatalog(index.catalog, index.pack.id) && isExperienceModuleIndex(index.modules, index.pack.id) &&
    isExperienceRequirements(index.requirements, index.pack.id) && isExperienceRouting(index.routing, index.pack.id) && isExperienceWorkflowDocument(index.workflows, index.pack.id) &&
    typeof index.status === 'string' && EXPERIENCE_PACK_STATUSES.has(index.status) && isOptionalText(index.reason, 1024);
}

export function isExperiencePackTaskMetadata(value: unknown): value is ExperiencePackTaskMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const task = value as Record<string, unknown>;
  return hasOnlyKeys(task, ['version', 'sessionId', 'clientId', 'inputDigest', 'packId', 'packVersion', 'workflowId', 'mode', 'ignoredNodeIds', 'ignoredModuleIds', 'conditions', 'plan', 'planDigest', 'createdAt', 'updatedAt']) &&
    task.version === 1 && isBoundedText(task.sessionId, 256) && isOptionalText(task.clientId, 256) &&
    (task.inputDigest === undefined || isExperienceHash(task.inputDigest)) && isBoundedExperienceId(task.packId, 128) && isBoundedText(task.packVersion, 128) && isBoundedExperienceId(task.workflowId, 256) &&
    (task.mode === 'auto' || task.mode === 'explicit') && isExperienceStringArray(task.ignoredNodeIds, 512, 256) && isExperienceStringArray(task.ignoredModuleIds, 1024, 256) && isExperienceConditions(task.conditions) && isExperiencePlan(task.plan) &&
    task.plan.packId === task.packId && task.plan.packVersion === task.packVersion && task.plan.workflowId === task.workflowId && task.plan.mode === task.mode && isExperienceHash(task.planDigest) && isExperienceDate(task.createdAt) && isExperienceDate(task.updatedAt);
}

export function isExperienceContextPlan(value: unknown): value is ExperienceContextPlan {
  return isExperiencePlan(value);
}

export function isExperienceInputContext(value: unknown): value is ExperienceInputContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const context = value as Record<string, unknown>;
  return hasOnlyKeys(context, ['version', 'packId', 'packVersion', 'workflowId', 'mode', 'planDigest', 'modules']) && context.version === 1 && isBoundedExperienceId(context.packId, 128) && isBoundedText(context.packVersion, 128) && isBoundedExperienceId(context.workflowId, 256) && (context.mode === 'auto' || context.mode === 'explicit') && isExperienceHash(context.planDigest) && Array.isArray(context.modules) && context.modules.length <= 1024 && context.modules.every(isExperienceModuleContent);
}

export function isExperiencePackListResult(value: unknown): value is ExperiencePackListResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  const packs = result.packs;
  return hasOnlyKeys(result, ['packs']) && Array.isArray(packs) && packs.length <= 128 && packs.every(isExperiencePackSummary);
}

export function isExperiencePackResolveResult(value: unknown): value is ExperienceResolveResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (!hasOnlyKeys(result, ['pack', 'plan', 'selection', 'route', 'requiresUserChoice', 'reason']) || !isExperiencePackSummary(result.pack) || (result.plan !== null && !isExperiencePlan(result.plan)) || !isExperienceSelectionSnapshot(result.selection) || typeof result.requiresUserChoice !== 'boolean' || !isOptionalText(result.reason, 1024)) return false;
  if (result.route === null) return true;
  if (!result.route || typeof result.route !== 'object' || Array.isArray(result.route)) return false;
  const route = result.route as Record<string, unknown>;
  if (route.kind === 'matched') return hasOnlyKeys(route, ['kind', 'workflowId', 'candidates']) && isBoundedExperienceId(route.workflowId, 256) && isExperienceStringArray(route.candidates, 128, 256);
  if (route.kind === 'ambiguous') return hasOnlyKeys(route, ['kind', 'candidates']) && isExperienceStringArray(route.candidates, 128, 256);
  return route.kind === 'no-match' && hasOnlyKeys(route, ['kind', 'candidates']) && Array.isArray(route.candidates) && route.candidates.length === 0;
}

export function isExperiencePackTaskResult(value: unknown): value is ExperiencePackTaskResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return hasOnlyKeys(result, ['selection', 'plan', 'requiresUserChoice', 'fallbackReason']) && isExperienceSelectionSnapshot(result.selection) && (result.plan === null || isExperiencePlan(result.plan)) && typeof result.requiresUserChoice === 'boolean' && isOptionalText(result.fallbackReason, 1024);
}

export function isExperiencePackGetResult(value: unknown): value is ExperiencePackGetResult {
  return !!value && typeof value === 'object' && !Array.isArray(value) && hasOnlyKeys(value as Record<string, unknown>, ['index']) && ((value as Record<string, unknown>).index === null || isExperiencePackIndex((value as Record<string, unknown>).index));
}

export function isExperiencePackFallbackPayload(value: unknown): value is ExperiencePackFallbackPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return hasOnlyKeys(payload, ['sessionId', 'packId', 'reason']) && isBoundedText(payload.sessionId, 256) && (payload.packId === '' || isBoundedExperienceId(payload.packId, 128)) && isBoundedText(payload.reason, 1024);
}

export type ExperienceResolutionInput = {
  pack: ExperiencePack;
  selection: ExperienceSelection;
  conditions?: Readonly<Record<string, ExperienceConditionState>>;
};

export function resolveExperience(input: ExperienceResolutionInput): ExperienceContextPlan {
  const workflow = findWorkflow(input.pack.workflows, input.selection);
  const moduleMap = indexModules(input.pack.modules);
  const requirementMap = indexRequirements(input.pack.requirements);
  const override = findOverride(input.selection.overrides, workflow.id);
  const ignoredNodes = new Set(override?.ignoredNodeIds ?? []);
  const ignoredModules = new Set(override?.ignoredModuleIds ?? []);
  const conditions = input.conditions ?? {};
  const workflowNodes = new Map(workflow.nodes.map((node) => [node.id, node]));
  const nodeStates = new Map<string, ExperienceNodePlan>();
  const visitingNodes = new Set<string>();
  const ensureNodePlan = (nodeId: string): ExperienceNodePlan => {
    const existing = nodeStates.get(nodeId);
    if (existing) return existing;
    const node = workflowNodes.get(nodeId);
    if (!node) {
      return {
        id: nodeId,
        state: 'blocked',
        modules: [],
        reasons: [`前置节点 ${nodeId} 不存在`],
      };
    }
    if (visitingNodes.has(nodeId)) throw new Error(`experience workflow dependency cycle: ${nodeId}`);
    visitingNodes.add(nodeId);
    for (const predecessorId of unique([...node.after, ...node.requires])) ensureNodePlan(predecessorId);
    const plan = planNode({
      node,
      moduleMap,
      requirementMap,
      ignoredNodes,
      ignoredModules,
      conditions,
      nodeStates,
    });
    visitingNodes.delete(nodeId);
    nodeStates.set(nodeId, plan);
    return plan;
  };
  for (const node of workflow.nodes) {
    ensureNodePlan(node.id);
  }
  const nodePlans = workflow.nodes.map((node) => nodeStates.get(node.id) ?? ensureNodePlan(node.id));
  // `planNodeModules` expands `module.requires` and emits dependencies before
  // their consumer.  The runtime context must include that complete expanded
  // list, not only the modules written directly on a workflow node; otherwise
  // a ready dependency would be shown in the UI but never reach the model.
  const enabledModuleIds = nodePlans
    .filter((node) => node.state === 'enabled')
    .flatMap((node) => node.modules.filter((module) => module.state === 'enabled').map((module) => module.id));
  const moduleIds = unique(enabledModuleIds);
  return { packId: input.pack.id, packVersion: input.pack.version, workflowId: workflow.id, mode: input.selection.mode, nodes: nodePlans, moduleIds };
}

/**
 * Resolve the lightweight automatic router. Matching is intentionally
 * conservative: a rule must have at least one intent phrase present and no
 * exclusion phrase present. Zero or multiple matches stay user-visible so an
 * automatic choice can never silently select the wrong project workflow.
 */
export function routeExperience(input: {
  text: string;
  routing: ExperienceRouting;
}): ExperienceRouteResult {
  const text = normalizeRoutePhrase(input.text);
  const matches = input.routing.rules
    .filter((rule) => {
      const intents = rule.intents.map(normalizeRoutePhrase).filter((item) => item.length > 0);
      const exclusions = rule.exclusions.map(normalizeRoutePhrase).filter((item) => item.length > 0);
      const intentHit = intents.some((intent) => routePhraseMatches(text, intent));
      const excluded = exclusions.some((item) => routePhraseMatches(text, item));
      return intentHit && !excluded;
    })
    .map((rule) => rule.workflowId);
  const candidates = unique(matches);
  if (candidates.length === 1) {
    return { kind: 'matched', workflowId: candidates[0], candidates };
  }
  if (candidates.length > 1) return { kind: 'ambiguous', candidates };
  return { kind: 'no-match', candidates: [] };
}

function routePhraseMatches(text: string, phrase: string): boolean {
  let offset = text.indexOf(phrase);
  while (offset !== -1) {
    const before = offset > 0 ? text[offset - 1] : '';
    const after = text[offset + phrase.length] ?? '';
    const leftJoined = /^[a-z0-9]/.test(phrase) && /[a-z0-9]/.test(before);
    const rightJoined = /[a-z0-9]$/.test(phrase) && /[a-z0-9]/.test(after);
    if (!leftJoined && !rightJoined) return true;
    offset = text.indexOf(phrase, offset + 1);
  }
  return false;
}

/** Only recognizable follow-ups can inherit an automatic route. Unrelated
 * unmatched input must return to the user's workflow choice. */
export function isExperienceFollowUp(text: string): boolean {
  const normalized = normalizeRoutePhrase(text);
  return /^(继续|接着|好的|好[，。,！!\s]*$|没问题|没有问题|可以[，。,！!\s]*$|同意|按这个|按刚才|补充|还有|那么|这个|这里|上面|那就|continue\b|go on\b|yes\b|ok\b|also\b|what about\b|and\b)/.test(normalized);
}

function findWorkflow(workflows: ExperienceWorkflow[], selection: ExperienceSelection): ExperienceWorkflow {
  if (selection.mode === 'explicit') {
    const workflow = workflows.find((item) => item.id === selection.workflowId);
    if (!workflow) throw new Error(`experience workflow not found: ${selection.workflowId ?? '<empty>'}`);
    return workflow;
  }
  if (workflows.length !== 1) throw new Error('automatic experience routing must resolve before context planning');
  return workflows[0];
}

function indexModules(modules: ExperienceModule[]): Map<string, ExperienceModule> {
  return new Map(modules.map((module) => [module.id, module]));
}

function indexRequirements(requirements: ExperienceRequirement[]): Map<string, ExperienceRequirement> {
  return new Map(requirements.map((requirement) => [requirement.id, requirement]));
}

function findOverride(overrides: ExperienceSelectionOverride[], workflowId: string): ExperienceSelectionOverride | null {
  return overrides.find((item) => item.workflowId === workflowId) ?? null;
}

function planNode(input: {
  node: ExperienceWorkflowNode;
  moduleMap: Map<string, ExperienceModule>;
  requirementMap: Map<string, ExperienceRequirement>;
  ignoredNodes: Set<string>;
  ignoredModules: Set<string>;
  conditions: Readonly<Record<string, ExperienceConditionState>>;
  nodeStates: ReadonlyMap<string, ExperienceNodePlan>;
}): ExperienceNodePlan {
  const { node, moduleMap, requirementMap, ignoredNodes, ignoredModules, conditions, nodeStates } = input;
  if (ignoredNodes.has(node.id)) {
    return node.skippable
      ? { id: node.id, state: 'ignored', modules: [], reasons: ['用户已忽略此节点'] }
      : { id: node.id, state: 'blocked', modules: [], reasons: ['必需节点被用户忽略'] };
  }
  if (!node.defaultEnabled && node.skippable) {
    return { id: node.id, state: 'ignored', modules: [], reasons: ['节点默认未启用'] };
  }
  if (!node.defaultEnabled && !node.skippable) {
    return { id: node.id, state: 'blocked', modules: [], reasons: ['必需节点默认未启用'] };
  }
  if (node.when && conditions[node.when] === 'unsatisfied') return { id: node.id, state: 'not-applicable', modules: [], reasons: ['触发条件未满足'] };
  if (node.when && conditions[node.when] !== 'satisfied') return { id: node.id, state: 'waiting', modules: [], reasons: ['等待触发条件确认'] };
  const afterReasons: string[] = [];
  const requiresReasons: string[] = [];
  let requiredPredecessorBlocked = false;
  let waiting = false;
  // `after` only determines ordering. Once a predecessor reaches any terminal
  // state, including ignored/not-applicable/blocked, its successor may run.
  // `requires` is the separate success/evidence dependency.
  for (const predecessorId of unique(node.requires)) {
    const predecessor = nodeStates.get(predecessorId);
    if (predecessor?.state === 'enabled') continue;
    if (predecessor?.state === 'waiting') {
      waiting = true;
    } else {
      requiredPredecessorBlocked = true;
    }
    requiresReasons.push(`必需前置节点 ${predecessorId} 未满足`);
  }
  const plannedModules = planNodeModules({
    requiredIds: node.modules,
    optionalIds: node.optionalModules,
    moduleMap,
    ignoredModules,
  });
  const modulePlans = plannedModules.plans;
  const requirementReasons: string[] = [];
  let unsatisfiedRequirement = false;
  for (const requirementId of unique(node.requirements)) {
    const state = conditions[requirementId] ?? 'unknown';
    if (state === 'satisfied') continue;
    if (state === 'unknown') waiting = true;
    if (state === 'unsatisfied') unsatisfiedRequirement = true;
    requirementReasons.push(requirementReason(requirementId, requirementMap, conditions));
  }
  const reasons = [...afterReasons, ...requiresReasons, ...plannedModules.reasons, ...requirementReasons];
  const blocked = requiredPredecessorBlocked || plannedModules.requiredBlocked || unsatisfiedRequirement;
  const state = blocked ? 'blocked' : waiting ? 'waiting' : 'enabled';
  return { id: node.id, state, modules: modulePlans, reasons };
}

/**
 * Expand module.requires deterministically. Dependencies are emitted before
 * their consumer, deduplicated across a node, and never resurrect an ignored
 * module. Optional groups degrade to an explanatory ignored state; required
 * groups block the node when any dependency is unavailable.
 */
function planNodeModules(input: {
  requiredIds: string[];
  optionalIds: string[];
  moduleMap: Map<string, ExperienceModule>;
  ignoredModules: Set<string>;
}): { plans: ExperienceModulePlan[]; reasons: string[]; requiredBlocked: boolean } {
  const plans: ExperienceModulePlan[] = [];
  const byId = new Map<string, ExperienceModulePlan>();
  const reasons: string[] = [];
  let requiredBlocked = false;
  const mergeGroup = (group: ExperienceModulePlan[], required: boolean): void => {
    for (const incoming of group) {
      const existing = byId.get(incoming.id);
      if (!existing) {
        const next = { ...incoming };
        byId.set(next.id, next);
        plans.push(next);
        continue;
      }
      if (existing.state === 'enabled' || incoming.state === 'enabled') {
        existing.state = 'enabled';
        existing.reason = null;
        continue;
      }
      if (required && incoming.state === 'blocked') {
        existing.state = 'blocked';
        existing.reason = incoming.reason;
      }
    }
  };
  const planGroup = (rootId: string, required: boolean): { ready: boolean; plans: ExperienceModulePlan[] } => {
    const groupPlans: ExperienceModulePlan[] = [];
    const groupById = new Map<string, ExperienceModulePlan>();
    const visiting = new Set<string>();
    const add = (id: string): boolean => {
      const existing = groupById.get(id);
      if (existing) return existing.state === 'enabled';
      if (visiting.has(id)) throw new Error(`experience module dependency cycle: ${id}`);
      visiting.add(id);
      const module = input.moduleMap.get(id);
      if (input.ignoredModules.has(id)) {
        const ignored: ExperienceModulePlan = {
          id,
          state: required ? 'blocked' : 'ignored',
          reason: required ? '必需模块或依赖被用户忽略' : '用户已忽略此可选内容',
        };
        groupById.set(id, ignored);
        groupPlans.push(ignored);
        visiting.delete(id);
        return false;
      }
      if (!module || module.status !== 'ready') {
        const unavailable: ExperienceModulePlan = {
          id,
          state: 'unavailable',
          reason: module ? '模块正文尚未迁移完成' : '模块索引中不存在',
        };
        groupById.set(id, unavailable);
        groupPlans.push(unavailable);
        visiting.delete(id);
        return false;
      }
      let dependenciesReady = true;
      for (const dependency of unique(module.requires)) {
        const dependencyReady = add(dependency);
        dependenciesReady = dependenciesReady && dependencyReady;
      }
      const plan: ExperienceModulePlan = dependenciesReady
        ? { id, state: 'enabled', reason: null }
        : {
            id,
            state: required ? 'blocked' : 'ignored',
            reason: required ? '必需依赖模块未就绪' : '依赖模块未就绪，已跳过可选内容',
          };
      groupById.set(id, plan);
      groupPlans.push(plan);
      visiting.delete(id);
      return dependenciesReady;
    };
    const ready = add(rootId);
    if (!required && !ready) {
      for (const plan of groupPlans) {
        if (plan.state !== 'enabled') continue;
        plan.state = 'ignored';
        plan.reason = '所属可选内容未就绪，未单独加载';
      }
    }
    return { ready, plans: groupPlans };
  };

  for (const id of unique(input.requiredIds)) {
    const group = planGroup(id, true);
    mergeGroup(group.plans, true);
    if (!group.ready) {
      requiredBlocked = true;
      reasons.push(`必需模块 ${id} 未就绪`);
    }
  }
  for (const id of unique(input.optionalIds)) {
    const group = planGroup(id, false);
    mergeGroup(group.plans, false);
    if (!group.ready) reasons.push(`可选模块 ${id} 未启用`);
  }
  return { plans, reasons, requiredBlocked };
}

function requirementReason(id: string, requirements: Map<string, ExperienceRequirement>, conditions: Readonly<Record<string, ExperienceConditionState>>): string {
  const requirement = requirements.get(id);
  const state = conditions[id] ?? 'unknown';
  return `${requirement?.description ?? id}（${state}）`;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function isBoundedExperienceId(value: unknown, maxLength: number): value is string {
  if (typeof value !== 'string') return false;
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= maxLength && EXPERIENCE_ID_PATTERN.test(normalized);
}

function normalizeRoutePhrase(value: string): string {
  return value.trim().toLocaleLowerCase();
}

/** Stable, host-independent serialization used for task auditing and tests. */
export function serializeExperiencePlan(plan: ExperienceContextPlan): string {
  return JSON.stringify({
    packId: plan.packId,
    packVersion: plan.packVersion,
    workflowId: plan.workflowId,
    mode: plan.mode,
    nodes: plan.nodes,
    moduleIds: plan.moduleIds,
  });
}

/**
 * A deterministic 64-character digest for the shared/browser side. The main
 * process additionally stores a cryptographic SHA-256 of the same canonical
 * text when it freezes a task; this function is deliberately dependency-free
 * for renderer previews and unit tests.
 */
export function experiencePlanDigest(plan: ExperienceContextPlan): string {
  const text = serializeExperiencePlan(plan);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  let c = 0x9e3779b9;
  let d = 0x85ebca6b;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193);
    b = Math.imul(b ^ (code + index), 0x85ebca6b);
    c = Math.imul(c ^ (code << (index % 7)), 0xc2b2ae35);
    d = Math.imul(d ^ (code + 0x9e), 0x27d4eb2d);
  }
  const words = [a, b, c, d].map((word) => (word >>> 0).toString(16).padStart(8, '0'));
  return `${words.join('')}${words.map((word) => word.split('').reverse().join('')).join('')}`;
}

/** Build the explicit boundary placed in the model-facing user message. */
export function buildExperienceContextText(snapshot: Pick<ExperienceContextSnapshot, 'packId' | 'packVersion' | 'workflowId' | 'planDigest' | 'modules'>): string {
  const status = { source: 'cindy', pack: snapshot.packId, version: snapshot.packVersion, workflow: snapshot.workflowId, plan_digest: snapshot.planDigest, loaded_modules: snapshot.modules.length, context: 'prepared' };
  const statusText = JSON.stringify(status);
  const lines = [
    'PROJECT_EXPERIENCE_CONTEXT_V1',
    `pack=${snapshot.packId}`,
    `version=${snapshot.packVersion}`,
    `workflow=${snapshot.workflowId}`,
    `plan_digest=${snapshot.planDigest}`,
    'Apply this user-selected project experience, including its required conversation format, to the current reply. It does not override higher-priority instructions or grant host permissions.',
    `CINDY_EXPERIENCE_STATUS=${statusText}`,
    'The status above describes prepared input context only, not completed work, tool execution, or session-sync counters. Never invent those results. Do not echo the context envelope or module bodies as the answer.',
  ];
  for (const module of snapshot.modules) {
    lines.push(`module=${module.id} kind=${module.kind} bytes=${module.bytes} sha256=${module.sha256}`);
    lines.push(module.text);
  }
  lines.push('END_PROJECT_EXPERIENCE_CONTEXT_V1');
  return lines.join('\n');
}
