import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  buildExperienceContextText,
  isExperienceFollowUp,
  experiencePlanDigest,
  normalizeExperienceSelectionSnapshot,
  resolveExperience,
  routeExperience,
  type ExperienceCatalogWorkflow,
  type ExperienceContextPlan,
  type ExperienceContextSnapshot,
  type ExperienceInputContext,
  type ExperienceModule,
  type ExperienceModuleContent,
  type ExperienceModuleIndexEntry,
  type ExperiencePackDocument,
  type ExperiencePackIndex,
  type ExperiencePackSummary,
  type ExperienceRequirement,
  type ExperienceResolveResult,
  type ExperienceRouting,
  type ExperienceSelectionSnapshot,
  type ExperienceWorkflow,
  type ExperienceWorkflowDocument,
} from '@cindy/maker-shared/experience-pack';
import type { InstalledGhost } from '../../shared/ghost.js';
import { BoundedFileReadChangedError, BoundedFileReadUncertainError, readBoundedFileNoFollow } from '../utils/readBoundedFile.js';
import { resolveGhostContentPath } from './ghostContentTree.js';

const EXPERIENCE_PROTOCOL_VERSION = '0.1.0';
const PACK_ENTRY_MAX_BYTES = 256 * 1024;
const CATALOG_MAX_BYTES = 64 * 1024;
const MODULE_INDEX_MAX_BYTES = 256 * 1024;
const REQUIREMENTS_MAX_BYTES = 128 * 1024;
const ROUTING_MAX_BYTES = 128 * 1024;
const WORKFLOW_MAX_BYTES = 128 * 1024;
const MODULE_CONTENT_MAX_BYTES = 512 * 1024;
const CONTEXT_MAX_BYTES = 4 * 1024 * 1024;
const TASK_SNAPSHOT_MAX_BYTES = CONTEXT_MAX_BYTES + 512 * 1024;
const STATE_FILE_MAX_BYTES = 2 * 1024 * 1024;
const MAX_WORKFLOWS = 128;
const MAX_MODULES = 4096;
const MAX_REQUIREMENTS = 1024;
const MAX_ROUTING_RULES = 128;
const MAX_NODES = 1024;
const MAX_SOURCES = 128;
const MAX_DEPENDENCIES = 256;
const MAX_PHRASES = 128;
const MAX_STRING_ARRAY_ITEM = 256;

export type ExperiencePackRegistryEntry = {
  packId: string;
  version: string;
  ghostId: string;
  packageSha256: string;
  status: ExperiencePackSummary['status'];
  reason?: string;
  source: 'cindy';
  installedAt: string;
};

export interface ExperiencePackServiceLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
}

export interface ExperiencePackServiceOptions {
  /** Current owner-scoped installed plugin roster. */
  getGhosts: () => InstalledGhost[];
  /** Owner-scoped directory used for registry, overrides and task snapshots. */
  getStorageRoot: () => string;
  /** Optional generation key; async work is discarded after an owner switch. */
  getOwnerKey?: () => string;
  /** Immutable package hash from the Ghost approval receipt when available. */
  getPackageSha256?: (ghostId: string) => string | null;
  log?: ExperiencePackServiceLogger;
}

export type ExperienceResolveRequest = {
  text: string;
  selection: ExperienceSelectionSnapshot;
  sessionId?: string;
};

export type ExperienceFreezeRequest = {
  sessionId: string;
  clientId?: string;
  text: string;
  selection: ExperienceSelectionSnapshot;
};

export type ExperienceFreezeResult = {
  snapshot: ExperienceContextSnapshot | null;
  context: ExperienceInputContext | null;
  selection: ExperienceSelectionSnapshot;
  plan: ExperienceContextPlan | null;
  requiresUserChoice: boolean;
  fallbackReason?: string;
};

export type ExperienceOverride = {
  workflowId: string;
  ignoredNodeIds: string[];
  ignoredModuleIds: string[];
};

type LoadedPack = {
  ghost: InstalledGhost;
  index: ExperiencePackIndex;
  /** Full .cindy package hash from the approval receipt; null means unknown. */
  packageSha256: string | null;
  loadedAt: string;
};

type RegistryFile = { version: 1; entries: ExperiencePackRegistryEntry[] };
type OverrideFile = { version: 1; entries: ExperienceOverrideRecord[] };
type ExperienceOverrideRecord = ExperienceOverride & { packId: string };

class ExperiencePackError extends Error {
  constructor(
    readonly status: ExperiencePackSummary['status'],
    message: string,
  ) {
    super(message);
    this.name = 'ExperiencePackError';
  }
}

/**
 * Host-owned, read-only experience package reader.
 *
 * The service deliberately understands JSON indexes and Markdown bytes only.
 * It never imports, evaluates, or dispatches anything from an experience
 * package. Installed Ghosts remain the sole .cindy lifecycle and permission
 * boundary; this class only projects their optional experience contribution.
 */
export class ExperiencePackService {
  private readonly selectionWrites = new Map<string, Promise<void>>();
  private readonly cache = new Map<string, LoadedPack>();
  private readonly registry = new Map<string, ExperiencePackRegistryEntry>();
  private readonly overrides = new Map<string, ExperienceOverrideRecord>();
  private summaryCache: ExperiencePackSummary[] | null = null;
  private summaryRosterKey: string | null = null;
  private readonly duplicatePackIds = new Set<string>();
  private storageOwnerKey: string | null = null;
  private storageLoaded = false;
  private stateLoadPromise: Promise<void> | null = null;
  private stateLoadOwnerKey: string | null = null;

  constructor(private readonly options: ExperiencePackServiceOptions) {}

  async refresh(): Promise<ExperiencePackSummary[]> {
    const ownerKey = this.captureOwnerKey();
    this.resetForOwnerIfNeeded(ownerKey);
    await this.loadStateFiles();
    if (!this.isOwnerCurrent(ownerKey)) return [];
    this.cache.clear();
    this.duplicatePackIds.clear();
    const ghosts = this.options.getGhosts();
    const rosterKey = experienceRosterKey(ghosts, (ghostId) => this.safePackageHash(ghostId));
    const summaries: ExperiencePackSummary[] = [];
    const nextRegistry = new Map<string, ExperiencePackRegistryEntry>();
    const loadedOwners = new Map<string, string[]>();
    for (const ghost of ghosts) {
      if (!ghost.manifest.experiencePack) continue;
      const loaded = await this.loadPackForGhost(ghost);
      if (!this.isOwnerCurrent(ownerKey)) return [];
      if (loaded.ok) {
        const packId = loaded.value.index.pack.id;
        const owners = loadedOwners.get(packId) ?? [];
        owners.push(ghost.manifest.id);
        loadedOwners.set(packId, owners);
        if (owners.length === 1) this.cache.set(packId, loaded.value);
        else {
          this.cache.delete(packId);
          this.duplicatePackIds.add(packId);
        }
        const summary = this.summaryForLoaded(loaded.value);
        summaries.push(summary);
        if (owners.length === 1) {
          nextRegistry.set(summary.packId, this.registryEntryFor(loaded.value, summary.status));
        }
      } else {
        const summary = this.summaryForFailure(ghost, loaded.error);
        summaries.push(summary);
        nextRegistry.set(summary.packId, this.registryEntryForFailure(ghost, summary));
      }
    }
    if (!this.isOwnerCurrent(ownerKey)) return [];
    for (const packId of this.duplicatePackIds) {
      const owners = loadedOwners.get(packId) ?? [];
      const reason = `多个已启用插件声明了相同经验包 ID（${owners.join(', ')}）`;
      const first = summaries.find((summary) => summary.packId === packId);
      if (first) {
        first.status = 'invalid';
        first.reason = reason;
      }
      for (let index = summaries.length - 1; index >= 0; index -= 1) {
        if (summaries[index]?.packId === packId && summaries[index] !== first) summaries.splice(index, 1);
      }
      const entry = nextRegistry.get(packId);
      if (entry) nextRegistry.set(packId, { ...entry, status: 'invalid', reason });
    }
    this.registry.clear();
    for (const [packId, entry] of nextRegistry) this.registry.set(packId, entry);
    await this.persistRegistry(ownerKey);
    if (!this.isOwnerCurrent(ownerKey)) return [];
    summaries.sort((left, right) => left.name.localeCompare(right.name));
    this.summaryCache = summaries.map((summary) => ({
      ...summary,
      workflows: summary.workflows.map((workflow) => ({ ...workflow })),
    }));
    this.summaryRosterKey = rosterKey;
    return summaries;
  }

  async list(): Promise<ExperiencePackSummary[]> {
    const ownerKey = this.captureOwnerKey();
    this.resetForOwnerIfNeeded(ownerKey);
    await this.loadStateFiles();
    const ghosts = this.options.getGhosts();
    const rosterKey = experienceRosterKey(ghosts, (ghostId) => this.safePackageHash(ghostId));
    const stableHashes = ghosts
      .filter((ghost) => ghost.enabled && ghost.manifest.experiencePack)
      .every((ghost) => this.safePackageHash(ghost.manifest.id) !== null);
    if (stableHashes && this.summaryCache && this.summaryRosterKey === rosterKey && this.isOwnerCurrent(ownerKey)) {
      return this.summaryCache.map((summary) => ({
        ...summary,
        workflows: summary.workflows.map((workflow) => ({ ...workflow })),
      }));
    }
    return this.refresh();
  }

  async get(packId: string): Promise<ExperiencePackIndex | null> {
    const loaded = await this.ensureLoadedByPackId(packId);
    if (loaded) await this.readRequiredModules(loaded.index);
    return loaded?.index ?? null;
  }

  async getSelection(sessionId: string): Promise<ExperienceSelectionSnapshot | null> {
    const ownerKey = this.captureOwnerKey();
    const root = this.options.getStorageRoot();
    const selectionRoot = path.join(root, 'selections');
    const file = taskFilePath(selectionRoot, sessionId);
    await this.selectionWrites.get(file);
    const bytes = await readStateBytes(file, STATE_FILE_MAX_BYTES);
    if (!this.isOwnerCurrent(ownerKey)) return null;
    if (bytes !== null) {
      const text = decodeUtf8(bytes, 'experience selection');
      const saved = JSON.parse(text);
      if (saved.version !== 1 || saved.sessionId !== sessionId) throw new ExperiencePackError('invalid', '经验选择记录无效');
      if (saved.selection === null) return null;
      return normalizeSelection(saved.selection);
    }
    const request = { sessionId };
    const snapshot = await this.getTask(request);
    return snapshot ? selectionFromSnapshot(snapshot) : null;
  }

  async setSelection(request: { sessionId: string; selection: ExperienceSelectionSnapshot | null }): Promise<void> {
    const ownerKey = this.captureOwnerKey();
    const selection = request.selection === null ? null : normalizeSelection(request.selection);
    const root = this.options.getStorageRoot();
    const selectionRoot = path.join(root, 'selections');
    const file = taskFilePath(selectionRoot, request.sessionId);
    const previous = this.selectionWrites.get(file) ?? Promise.resolve();
    const write = previous.catch(() => undefined).then(async () => {
      if (!this.isOwnerCurrent(ownerKey)) return;
      const record = { version: 1, sessionId: request.sessionId, selection };
      await writeJsonAtomic(file, record);
    });
    this.selectionWrites.set(file, write);
    try {
      await write;
    } finally {
      if (this.selectionWrites.get(file) === write) this.selectionWrites.delete(file);
    }
  }

  private async readRequiredModules(index: ExperiencePackIndex): Promise<string[]> {
    const ids = new Set<string>();
    const visit = async (id: string): Promise<void> => {
      if (ids.has(id)) return;
      ids.add(id);
      const module = index.modules.find((item) => item.id === id);
      if (!module) throw new ExperiencePackError('invalid', '基础会话规范模块不存在');
      for (const dependency of module.requires) await visit(dependency);
      const request = { packId: index.pack.id, moduleId: id };
      await this.readContent(request);
    };
    for (const id of index.pack.requiredModules ?? []) await visit(id);
    return [...ids];
  }

  async resolve(request: ExperienceResolveRequest): Promise<ExperienceResolveResult> {
    const selection = normalizeSelection(request.selection);
    const loaded = await this.ensureLoadedByPackId(selection.packId);
    if (!loaded) {
      return {
        pack: this.unavailableSummary(selection.packId, '经验包未安装或当前不可用'),
        plan: null,
        selection,
        route: null,
        requiresUserChoice: false,
        reason: '经验包未安装或当前不可用',
      };
    }
    const index = loaded.index;
    if (index.status !== 'ready') {
      return {
        pack: this.summaryForLoaded(loaded),
        plan: null,
        selection,
        route: null,
        requiresUserChoice: false,
        reason: index.reason ?? '经验包校验未通过',
      };
    }
    let route = selection.mode === 'auto'
      ? routeExperience({ text: request.text, routing: index.routing })
      : null;
    const followsPrevious = isExperienceFollowUp(request.text);
    if (route?.kind === 'no-match' && request.sessionId && followsPrevious) {
      const taskRequest = { sessionId: request.sessionId };
      const previous = await this.getTask(taskRequest);
      if (previous?.packId === selection.packId && previous.mode === 'auto' && workflowStatus(index, previous.workflowId) === 'ready') {
        route = { kind: 'matched', workflowId: previous.workflowId, candidates: [previous.workflowId] };
      }
    }
    if (route && route.kind !== 'matched') {
      return {
        pack: this.summaryForLoaded(loaded),
        plan: null,
        selection,
        route,
        requiresUserChoice: true,
        reason: route.kind === 'ambiguous' ? '输入同时命中多个工作流' : '输入未命中可自动分配的工作流',
      };
    }
    const workflowId = selection.mode === 'explicit'
      ? selection.workflowId
      : route && route.kind === 'matched'
        ? route.workflowId
        : null;
    if (!workflowId) {
      return {
        pack: this.summaryForLoaded(loaded),
        plan: null,
        selection,
        route,
        requiresUserChoice: true,
        reason: '未能确定工作流',
      };
    }
    const selectedWorkflowStatus = workflowStatus(index, workflowId);
    if (selectedWorkflowStatus !== 'ready') {
      return {
        pack: this.summaryForLoaded(loaded),
        plan: null,
        selection,
        route,
        requiresUserChoice: false,
        reason: '所选工作流仍有未迁移的必需经验内容',
      };
    }
    const effectiveSelection = selection;
    const planningOverride: ExperienceOverride = {
      workflowId,
      ignoredNodeIds: effectiveSelection.ignoredNodeIds,
      ignoredModuleIds: effectiveSelection.ignoredModuleIds,
    };
    const sharedPack = toSharedPack(index);
    let plan: ExperienceContextPlan;
    try {
      const resolvedPlan = resolveExperience({
        pack: sharedPack,
        selection: {
          mode: 'explicit',
          workflowId,
          overrides: [planningOverride],
        },
        conditions: selection.conditions,
      });
      // The resolver receives an explicit workflow id after automatic routing,
      // but the frozen task still records how the user chose it.  Keep that
      // distinction visible to UI/audit consumers while retaining deterministic
      // workflow planning.
      const requiredModuleIds = await this.readRequiredModules(index);
      const ignoredRequired = requiredModuleIds.some((id) => selection.ignoredModuleIds.includes(id));
      if (ignoredRequired) throw new ExperiencePackError('invalid', '基础会话规范不可忽略');
      const moduleIds = [...new Set([...requiredModuleIds, ...resolvedPlan.moduleIds])];
      const baseModules = requiredModuleIds.map((id) => ({ id, state: 'enabled' as const, reason: null }));
      const baseNode = { id: 'experience-base', state: 'enabled' as const, modules: baseModules, reasons: [] };
      const nodes = requiredModuleIds.length ? [baseNode, ...resolvedPlan.nodes] : resolvedPlan.nodes;
      plan = { ...resolvedPlan, mode: selection.mode, nodes, moduleIds };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return {
        pack: this.summaryForLoaded(loaded),
        plan: null,
        selection: effectiveSelection,
        route,
        requiresUserChoice: false,
        reason,
      };
    }
    return {
      pack: this.summaryForLoaded(loaded),
      plan,
      selection: effectiveSelection,
      route,
      requiresUserChoice: false,
    };
  }

  async readContent(request: { packId: string; moduleId: string }): Promise<ExperienceModuleContent> {
    const loaded = await this.ensureLoadedByPackId(request.packId);
    if (!loaded) throw new ExperiencePackError('unavailable', '经验包未安装');
    if (loaded.index.status !== 'ready') {
      throw new ExperiencePackError(loaded.index.status, loaded.index.reason ?? '经验包不可用');
    }
    const module = loaded.index.modules.find((item) => item.id === request.moduleId);
    if (!module) throw new ExperiencePackError('unavailable', `模块不存在: ${request.moduleId}`);
    if (module.status !== 'ready' || module.content === null) {
      throw new ExperiencePackError('unavailable', `模块正文尚未迁移: ${request.moduleId}`);
    }
    const bytes = await readContainedBytes(loaded.ghost.dir, module.content.path, MODULE_CONTENT_MAX_BYTES);
    const digest = sha256(bytes);
    if (bytes.byteLength !== module.content.bytes || digest !== module.content.sha256) {
      throw new ExperiencePackError('invalid', `模块摘要不匹配: ${request.moduleId}`);
    }
    const text = decodeUtf8(bytes, `模块 ${request.moduleId}`);
    return {
      id: module.id,
      kind: module.kind,
      name: module.name,
      summary: module.summary,
      sha256: digest,
      bytes: bytes.byteLength,
      text,
    };
  }

  async getOverride(request: { packId: string; workflowId: string }): Promise<ExperienceOverride> {
    await this.loadStateFiles();
    return this.overrides.get(overrideKey(request.packId, request.workflowId)) ?? {
      workflowId: request.workflowId,
      ignoredNodeIds: [],
      ignoredModuleIds: [],
    };
  }

  async setOverride(request: {
    packId: string;
    workflowId: string;
    ignoredNodeIds: string[];
    ignoredModuleIds: string[];
  }): Promise<ExperienceOverride> {
    const ownerKey = this.captureOwnerKey();
    this.resetForOwnerIfNeeded(ownerKey);
    const loaded = await this.ensureLoadedByPackId(request.packId);
    if (!loaded) throw new ExperiencePackError('unavailable', '经验包未安装');
    if (!this.isOwnerCurrent(ownerKey)) throw new ExperiencePackError('unavailable', '经验包所属账号已切换');
    const workflow = loaded.index.workflows.find((item) => item.id === request.workflowId);
    if (!workflow) throw new ExperiencePackError('invalid', '工作流不存在');
    const ignoredNodeIds = uniqueStrings(request.ignoredNodeIds);
    const ignoredModuleIds = uniqueStrings(request.ignoredModuleIds);
    const nodeMap = new Map(workflow.nodes.map((node) => [node.id, node]));
    for (const nodeId of ignoredNodeIds) {
      const node = nodeMap.get(nodeId);
      if (!node) throw new ExperiencePackError('invalid', `节点不存在: ${nodeId}`);
      if (!node.skippable) throw new ExperiencePackError('invalid', `不可忽略必需节点: ${nodeId}`);
    }
    const reachable = reachableModuleIds(workflow, new Map(loaded.index.modules.map((item) => [item.id, item])));
    for (const moduleId of ignoredModuleIds) {
      if (!reachable.has(moduleId)) throw new ExperiencePackError('invalid', `模块不属于工作流: ${moduleId}`);
    }
    const record: ExperienceOverrideRecord = {
      packId: request.packId,
      workflowId: request.workflowId,
      ignoredNodeIds,
      ignoredModuleIds,
    };
    this.overrides.set(overrideKey(request.packId, request.workflowId), record);
    await this.persistOverrides(ownerKey);
    return {
      workflowId: record.workflowId,
      ignoredNodeIds: [...record.ignoredNodeIds],
      ignoredModuleIds: [...record.ignoredModuleIds],
    };
  }

  async freezeTask(request: ExperienceFreezeRequest): Promise<ExperienceFreezeResult> {
    const ownerKey = this.captureOwnerKey();
    this.resetForOwnerIfNeeded(ownerKey);
    const selection = normalizeSelection(request.selection);
    const existing = await this.getTask({ sessionId: request.sessionId });
    const inputDigest = digestInput(request.text, selection);
    if (existing && existing.clientId === request.clientId && existing.inputDigest === inputDigest && await this.snapshotCanBeReused(existing, selection)) {
      const context = contextFromSnapshot(existing);
      return {
        snapshot: existing,
        context,
        selection: selectionFromSnapshot(existing),
        plan: existing.plan,
        requiresUserChoice: false,
      };
    }
    const resolveRequest = { text: request.text, selection, sessionId: request.sessionId };
    const resolved = await this.resolve(resolveRequest);
    if (resolved.requiresUserChoice || !resolved.plan) {
      return {
        snapshot: null,
        context: null,
        selection: resolved.selection,
        plan: null,
        requiresUserChoice: resolved.requiresUserChoice,
        ...(resolved.reason ? { fallbackReason: resolved.reason } : {}),
      };
    }
    const loaded = await this.ensureLoadedByPackId(selection.packId);
    if (!loaded || loaded.index.status !== 'ready') {
      return {
        snapshot: null,
        context: null,
        selection: resolved.selection,
        plan: resolved.plan,
        requiresUserChoice: false,
        fallbackReason: loaded?.index.reason ?? '经验包不可用',
      };
    }
    const workflow = loaded.index.workflows.find((item) => item.id === resolved.plan?.workflowId);
    const workflowNodes = new Map((workflow?.nodes ?? []).map((node) => [node.id, node]));
    const hasBlockedRequiredContent = resolved.plan.nodes.some((node) => {
      if (node.id === 'experience-base') return node.state !== 'enabled';
      const sourceNode = workflowNodes.get(node.id);
      if (!sourceNode) return true;
      if (sourceNode.skippable) return false;
      return node.state === 'blocked' || node.state === 'waiting';
    });
    if (hasBlockedRequiredContent) {
      return {
        snapshot: null,
        context: null,
        selection: resolved.selection,
        plan: resolved.plan,
        requiresUserChoice: false,
        fallbackReason: '经验工作流仍有未满足的必需节点或条件',
      };
    }
    const modules: ExperienceModuleContent[] = [];
    try {
      for (const moduleId of resolved.plan.moduleIds) {
        const content = await this.readContent({ packId: resolved.selection.packId, moduleId });
        modules.push(content);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.options.log?.warn('experience content unavailable; using native input', {
        packId: selection.packId,
        sessionId: request.sessionId,
        reason,
      });
      return {
        snapshot: null,
        context: null,
        selection: resolved.selection,
        plan: resolved.plan,
        requiresUserChoice: false,
        fallbackReason: reason,
      };
    }
    const planDigest = experiencePlanDigest(resolved.plan);
    const snapshot: ExperienceContextSnapshot = {
      version: 1,
      sessionId: request.sessionId,
      ...(request.clientId ? { clientId: request.clientId } : {}),
      inputDigest,
      packId: loaded.index.pack.id,
      packVersion: loaded.index.pack.version,
      workflowId: resolved.plan.workflowId,
      mode: selection.mode,
      ignoredNodeIds: resolved.selection.ignoredNodeIds,
      ignoredModuleIds: resolved.selection.ignoredModuleIds,
      ...(resolved.selection.conditions ? { conditions: resolved.selection.conditions } : {}),
      plan: resolved.plan,
      planDigest,
      modules,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const contextText = buildExperienceContextText(snapshot);
    if (Buffer.byteLength(contextText, 'utf8') > CONTEXT_MAX_BYTES) {
      return {
        snapshot: null,
        context: null,
        selection: resolved.selection,
        plan: resolved.plan,
        requiresUserChoice: false,
        fallbackReason: `经验上下文超过 ${CONTEXT_MAX_BYTES} 字节上限`,
      };
    }
    if (!this.isOwnerCurrent(ownerKey)) {
      return {
        snapshot: null,
        context: null,
        selection: resolved.selection,
        plan: resolved.plan,
        requiresUserChoice: false,
        fallbackReason: '经验包所属账号已切换，请重试',
      };
    }
    await this.writeTask(snapshot, ownerKey);
    return {
      snapshot,
      context: contextFromSnapshot(snapshot),
      selection: resolved.selection,
      plan: resolved.plan,
      requiresUserChoice: false,
    };
  }

  async prepareForInput(request: ExperienceFreezeRequest): Promise<ExperienceInputContext | null> {
    const result = await this.freezeTask(request);
    if (result.fallbackReason || result.requiresUserChoice) return null;
    return result.context;
  }

  /** Return the main-owned context for an already frozen task, if present. */
  async getTaskContext(request: { sessionId: string }): Promise<ExperienceInputContext | null> {
    const snapshot = await this.getTask(request);
    return snapshot ? contextFromSnapshot(snapshot) : null;
  }

  async getTask(request: { sessionId: string }): Promise<ExperienceContextSnapshot | null> {
    const ownerKey = this.captureOwnerKey();
    this.resetForOwnerIfNeeded(ownerKey);
    const file = taskFilePath(this.options.getStorageRoot(), request.sessionId);
    try {
      const bytes = await readStateBytes(file, TASK_SNAPSHOT_MAX_BYTES);
      if (bytes === null) return null;
      const raw = JSON.parse(decodeUtf8(bytes, '经验任务快照')) as unknown;
      if (!this.isOwnerCurrent(ownerKey)) return null;
      return parseSnapshot(raw, request.sessionId);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return null;
      this.options.log?.warn('experience task snapshot ignored', {
        sessionId: request.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  async deleteTask(request: { sessionId: string }): Promise<void> {
    const ownerKey = this.captureOwnerKey();
    this.resetForOwnerIfNeeded(ownerKey);
    if (!this.isOwnerCurrent(ownerKey)) return;
    const file = taskFilePath(this.options.getStorageRoot(), request.sessionId);
    await fs.promises.rm(file, { force: true }).catch(() => undefined);
  }

  /** Return a plain boundary block for callers that need to inspect the frozen payload. */
  contextText(context: ExperienceInputContext): string {
    const snapshot: ExperienceContextSnapshot = {
      version: 1,
      sessionId: '',
      packId: context.packId,
      packVersion: context.packVersion,
      workflowId: context.workflowId,
      mode: context.mode,
      ignoredNodeIds: [],
      ignoredModuleIds: [],
      plan: {
        packId: context.packId,
        packVersion: context.packVersion,
        workflowId: context.workflowId,
        mode: context.mode,
        nodes: [],
        moduleIds: context.modules.map((module) => module.id),
      },
      planDigest: context.planDigest,
      modules: context.modules,
      createdAt: '',
      updatedAt: '',
    };
    return buildExperienceContextText(snapshot);
  }

  private async ensureLoadedByPackId(packId: string): Promise<LoadedPack | null> {
    const ownerKey = this.captureOwnerKey();
    this.resetForOwnerIfNeeded(ownerKey);
    await this.loadStateFiles();
    if (!this.isOwnerCurrent(ownerKey)) return null;
    const ghosts = this.options.getGhosts();
    const rosterKey = experienceRosterKey(ghosts, (ghostId) => this.safePackageHash(ghostId));
    const cached = this.cache.get(packId);
    const stableHashes = ghosts
      .filter((ghost) => ghost.enabled && ghost.manifest.experiencePack)
      .every((ghost) => this.safePackageHash(ghost.manifest.id) !== null);
    if (
      cached &&
      !this.duplicatePackIds.has(packId) &&
      stableHashes &&
      this.summaryRosterKey === rosterKey &&
      this.isGhostStillInstalled(cached)
    ) return cached;
    let match: LoadedPack | null = null;
    for (const ghost of ghosts) {
      if (!ghost.manifest.experiencePack || !ghost.enabled) continue;
      const loaded = await this.loadPackForGhost(ghost);
      if (!loaded.ok) continue;
      if (loaded.value.index.pack.id !== packId) continue;
      if (match) {
        this.duplicatePackIds.add(packId);
        this.cache.delete(packId);
        this.options.log?.warn('duplicate experience pack id ignored', {
          packId,
          ghostIds: [match.ghost.manifest.id, loaded.value.ghost.manifest.id],
        });
        return null;
      }
      match = loaded.value;
    }
    if (!match) {
      this.cache.delete(packId);
      return null;
    }
    this.duplicatePackIds.delete(packId);
    this.cache.set(packId, match);
    return match;
  }

  /** Reuse only an identical queued input; later messages are resolved again. */
  private async snapshotCanBeReused(snapshot: ExperienceContextSnapshot, selection: ExperienceSelectionSnapshot): Promise<boolean> {
    if (snapshot.packId !== selection.packId || snapshot.mode !== selection.mode) return false;
    if (selection.mode === 'explicit' && snapshot.workflowId !== selection.workflowId) return false;
    const expected = selection;
    return arrayEqual(snapshot.ignoredNodeIds, expected.ignoredNodeIds) && arrayEqual(snapshot.ignoredModuleIds, expected.ignoredModuleIds) && conditionsEqual(snapshot.conditions, expected.conditions);
  }

  private async loadPackForGhost(
    ghost: InstalledGhost,
  ): Promise<{ ok: true; value: LoadedPack } | { ok: false; error: ExperiencePackError }> {
    if (!ghost.enabled) {
      return { ok: false, error: new ExperiencePackError('unavailable', '插件已停用') };
    }
    const declaration = ghost.manifest.experiencePack;
    if (!declaration) {
      return { ok: false, error: new ExperiencePackError('unavailable', '未声明经验包入口') };
    }
    try {
      const packRaw = await readJsonContained(ghost.dir, declaration.entry, PACK_ENTRY_MAX_BYTES);
      const pack = parsePackDocument(packRaw);
      const catalogRaw = await readJsonContained(ghost.dir, pack.entries.catalog, CATALOG_MAX_BYTES);
      const modulesRaw = await readJsonContained(ghost.dir, pack.entries.modules, MODULE_INDEX_MAX_BYTES);
      const requirementsRaw = await readJsonContained(ghost.dir, pack.entries.requirements, REQUIREMENTS_MAX_BYTES);
      const routingRaw = await readJsonContained(ghost.dir, pack.entries.routing, ROUTING_MAX_BYTES);
      const catalog = parseCatalog(catalogRaw, pack);
      const modules = parseModules(modulesRaw, pack);
      const requirements = parseRequirements(requirementsRaw, pack);
      const routing = parseRouting(routingRaw, pack);
      const workflows: ExperienceWorkflowDocument[] = [];
      for (const entry of catalog.workflows) {
        const raw = await readJsonContained(ghost.dir, entry.path, WORKFLOW_MAX_BYTES);
        workflows.push(parseWorkflow(raw, pack, entry));
      }
      validateCrossReferences({ pack, catalog, modules, requirements, routing, workflows });
      const status = modules.some((module) => module.status === 'ready' && module.content === null)
        ? 'invalid'
        : 'ready';
      const index: ExperiencePackIndex = {
        pack,
        catalog: { workflows: catalog.workflows },
        modules,
        requirements,
        routing,
        workflows,
        status,
        ...(status === 'invalid' ? { reason: '模块就绪元数据不完整' } : {}),
      };
      const packageSha256 = this.safePackageHash(ghost.manifest.id);
      return { ok: true, value: { ghost, index, packageSha256, loadedAt: new Date().toISOString() } };
    } catch (error) {
      const wrapped = error instanceof ExperiencePackError
        ? error
        : new ExperiencePackError('invalid', error instanceof Error ? error.message : String(error));
      return { ok: false, error: wrapped };
    }
  }

  private summaryForLoaded(loaded: LoadedPack): ExperiencePackSummary {
    const workflows = loaded.index.catalog.workflows.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      summary: workflow.summary,
      status: workflowStatus(loaded.index, workflow.id),
    }));
    return {
      packId: loaded.index.pack.id,
      packVersion: loaded.index.pack.version,
      name: loaded.index.pack.name,
      ghostId: loaded.ghost.manifest.id,
      enabled: loaded.ghost.enabled,
      status: loaded.ghost.enabled ? loaded.index.status : 'unavailable',
      ...(loaded.ghost.enabled && loaded.index.reason ? { reason: loaded.index.reason } :
        !loaded.ghost.enabled ? { reason: '插件已停用' } : {}),
      workflows,
    };
  }

  private summaryForFailure(ghost: InstalledGhost, error: ExperiencePackError): ExperiencePackSummary {
    const registryEntry = [...this.registry.values()].find((entry) => entry.ghostId === ghost.manifest.id);
    const packId = registryEntry?.packId ?? ghost.manifest.id;
    return {
      packId,
      packVersion: registryEntry?.version ?? 'unknown',
      name: ghost.manifest.name,
      ghostId: ghost.manifest.id,
      enabled: ghost.enabled,
      status: ghost.enabled ? error.status : 'unavailable',
      reason: ghost.enabled ? error.message : '插件已停用',
      workflows: [],
    };
  }

  private unavailableSummary(packId: string, reason: string): ExperiencePackSummary {
    return {
      packId,
      packVersion: 'unknown',
      name: packId,
      ghostId: packId,
      enabled: false,
      status: 'unavailable',
      reason,
      workflows: [],
    };
  }

  private registryEntryFor(loaded: LoadedPack, status: ExperiencePackSummary['status']): ExperiencePackRegistryEntry {
    return {
      packId: loaded.index.pack.id,
      version: loaded.index.pack.version,
      ghostId: loaded.ghost.manifest.id,
      packageSha256: loaded.packageSha256 ?? '',
      status,
      source: 'cindy',
      installedAt: this.registry.get(loaded.index.pack.id)?.installedAt ?? new Date().toISOString(),
    };
  }

  private registryEntryForFailure(ghost: InstalledGhost, summary: ExperiencePackSummary): ExperiencePackRegistryEntry {
    return {
      packId: summary.packId,
      version: summary.packVersion,
      ghostId: ghost.manifest.id,
      packageSha256: this.safePackageHash(ghost.manifest.id) ?? '',
      status: summary.status,
      ...(summary.reason ? { reason: summary.reason } : {}),
      source: 'cindy',
      installedAt: this.registry.get(summary.packId)?.installedAt ?? new Date().toISOString(),
    };
  }

  private async loadStateFiles(): Promise<void> {
    const ownerKey = this.captureOwnerKey();
    this.resetForOwnerIfNeeded(ownerKey);
    if (this.storageLoaded) return;
    if (this.stateLoadPromise && this.stateLoadOwnerKey === ownerKey) {
      await this.stateLoadPromise;
      return;
    }
    const storageRoot = this.options.getStorageRoot();
    const loadPromise = (async () => {
      const [registry, overrides] = await Promise.all([
        readExperienceStateFile(path.join(storageRoot, 'registry.json'), this.options.log),
        readExperienceStateFile(path.join(storageRoot, 'overrides.json'), this.options.log),
      ]);
      if (!this.isOwnerCurrent(ownerKey)) return;
      if (registry) {
        const raw = registry as Partial<RegistryFile>;
        if (raw.version === 1 && Array.isArray(raw.entries)) {
          for (const entry of raw.entries) {
            const normalized = normalizeRegistryEntry(entry);
            if (normalized) this.registry.set(normalized.packId, normalized);
          }
        } else {
          this.options.log?.warn('experience registry ignored: schema mismatch');
        }
      }
      if (overrides) {
        const raw = overrides as Partial<OverrideFile>;
        if (raw.version === 1 && Array.isArray(raw.entries)) {
          for (const entry of raw.entries) {
            const normalized = normalizeOverrideRecord(entry);
            if (normalized) this.overrides.set(overrideKey(normalized.packId, normalized.workflowId), normalized);
          }
        } else {
          this.options.log?.warn('experience overrides ignored: schema mismatch');
        }
      }
      this.storageLoaded = true;
    })();
    this.stateLoadPromise = loadPromise;
    this.stateLoadOwnerKey = ownerKey;
    try {
      await loadPromise;
    } finally {
      if (this.stateLoadPromise === loadPromise) {
        this.stateLoadPromise = null;
        this.stateLoadOwnerKey = null;
      }
    }
  }

  private async persistRegistry(ownerKey?: string): Promise<void> {
    const expectedOwnerKey = ownerKey ?? this.captureOwnerKey();
    if (!this.isOwnerCurrent(expectedOwnerKey)) return;
    const entries = [...this.registry.values()].sort((left, right) => left.packId.localeCompare(right.packId));
    const storageRoot = this.options.getStorageRoot();
    if (!this.isOwnerCurrent(expectedOwnerKey)) return;
    await writeJsonAtomic(path.join(storageRoot, 'registry.json'), { version: 1, entries });
    if (!this.isOwnerCurrent(expectedOwnerKey)) return;
  }

  private async persistOverrides(ownerKey?: string): Promise<void> {
    const expectedOwnerKey = ownerKey ?? this.captureOwnerKey();
    if (!this.isOwnerCurrent(expectedOwnerKey)) return;
    const entries = [...this.overrides.values()].sort((left, right) =>
      `${left.packId}.${left.workflowId}`.localeCompare(`${right.packId}.${right.workflowId}`),
    );
    const storageRoot = this.options.getStorageRoot();
    if (!this.isOwnerCurrent(expectedOwnerKey)) return;
    await writeJsonAtomic(path.join(storageRoot, 'overrides.json'), { version: 1, entries });
  }

  private async writeTask(snapshot: ExperienceContextSnapshot, ownerKey?: string): Promise<void> {
    const expectedOwnerKey = ownerKey ?? this.captureOwnerKey();
    if (!this.isOwnerCurrent(expectedOwnerKey)) return;
    const storageRoot = this.options.getStorageRoot();
    if (!this.isOwnerCurrent(expectedOwnerKey)) return;
    const file = taskFilePath(storageRoot, snapshot.sessionId);
    await writeJsonAtomic(file, snapshot);
  }

  private captureOwnerKey(): string {
    return this.options.getOwnerKey?.() ?? 'default';
  }

  private resetForOwnerIfNeeded(ownerKey: string): void {
    if (this.storageOwnerKey === ownerKey) return;
    this.storageOwnerKey = ownerKey;
    this.storageLoaded = false;
    this.stateLoadPromise = null;
    this.stateLoadOwnerKey = null;
    this.cache.clear();
    this.registry.clear();
    this.overrides.clear();
    this.summaryCache = null;
    this.summaryRosterKey = null;
  }

  private isOwnerCurrent(ownerKey: string): boolean {
    return this.captureOwnerKey() === ownerKey;
  }

  private safePackageHash(ghostId: string): string | null {
    try {
      return normalizePackageHash(this.options.getPackageSha256?.(ghostId));
    } catch (error) {
      this.options.log?.warn('experience package hash lookup failed', {
        ghostId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private isGhostStillInstalled(loaded: LoadedPack): boolean {
    const current = this.options.getGhosts().find((item) => {
      if (item.manifest.id !== loaded.ghost.manifest.id || !item.enabled) return false;
      return item.manifest.experiencePack?.entry === loaded.ghost.manifest.experiencePack?.entry;
    });
    if (!current) return false;
    if (current.manifest.version !== loaded.ghost.manifest.version) return false;
    const currentHash = this.safePackageHash(current.manifest.id);
    if (loaded.packageSha256 !== null) return currentHash === loaded.packageSha256;
    // Without immutable approval evidence we cannot know whether files changed
    // in place. Always reload so a stale index/content digest is never reused.
    return false;
  }
}

function normalizeSelection(value: ExperienceSelectionSnapshot): ExperienceSelectionSnapshot {
  const normalized = normalizeExperienceSelectionSnapshot(value);
  if (!normalized) throw new ExperiencePackError('invalid', '经验包选择内容不合格');
  return normalized;
}

function toSharedPack(index: ExperiencePackIndex) {
  const modules: ExperienceModule[] = index.modules.map((module) => ({
    id: module.id,
    kind: module.kind,
    name: module.name,
    summary: module.summary,
    status: module.status,
    requires: [...module.requires],
  }));
  const workflows: ExperienceWorkflow[] = index.workflows.map((workflow) => ({
    id: workflow.id,
    name: workflow.name,
    nodes: workflow.nodes,
  }));
  return {
    id: index.pack.id,
    version: index.pack.version,
    protocolVersion: index.pack.protocolVersion,
    modules,
    requirements: index.requirements,
    workflows,
  };
}

function parsePackDocument(raw: unknown): ExperiencePackDocument {
  if (!isRecord(raw) || raw.protocolVersion !== EXPERIENCE_PROTOCOL_VERSION) {
    throw new ExperiencePackError('unsupported', '经验包协议版本不受支持');
  }
  assertAllowedKeys(raw, ['protocolVersion', 'id', 'version', 'name', 'status', 'entries', '$schema', 'requiredModules'], 'pack.json');
  const requiredModules = raw.requiredModules ?? [];
  if (!boundedStringArray(requiredModules, MAX_DEPENDENCIES, 256) || hasDuplicates(requiredModules)) {
    throw new ExperiencePackError('invalid', '基础会话规范索引无效');
  }
  if (
    typeof raw.id !== 'string' ||
    typeof raw.version !== 'string' ||
    typeof raw.name !== 'string' ||
    (raw.status !== 'draft' && raw.status !== 'ready') ||
    !isRecord(raw.entries)
  ) {
    throw new ExperiencePackError('invalid', 'pack.json 字段不完整');
  }
  if (!isSimpleExperienceId(raw.id) || !isSemver(raw.version) || !boundedText(raw.name, 512)) {
    throw new ExperiencePackError('invalid', 'pack.json 标识或名称不合格');
  }
  const entries = raw.entries;
  const paths = ['catalog', 'modules', 'requirements', 'routing'];
  assertAllowedKeys(entries, paths, 'pack.entries');
  const parsedEntries: Record<string, string> = {};
  for (const key of paths) {
    const value = entries[key];
    if (typeof value !== 'string' || !isSafeExperiencePath(value)) {
      throw new ExperiencePackError('invalid', `pack.entries.${key} 路径不安全`);
    }
    parsedEntries[key] = value;
  }
  return {
    protocolVersion: EXPERIENCE_PROTOCOL_VERSION,
    id: raw.id,
    version: raw.version,
    name: raw.name,
    status: raw.status,
    requiredModules: requiredModules as string[],
    entries: parsedEntries as ExperiencePackDocument['entries'],
  };
}

function parseCatalog(raw: unknown, pack: ExperiencePackDocument): { workflows: ExperienceCatalogWorkflow[] } {
  if (!isRecord(raw) || raw.protocolVersion !== EXPERIENCE_PROTOCOL_VERSION || raw.packId !== pack.id || !Array.isArray(raw.workflows)) {
    throw new ExperiencePackError('invalid', 'catalog.json 字段不合格');
  }
  assertAllowedKeys(raw, ['protocolVersion', 'packId', 'workflows', '$schema'], 'catalog.json');
  if (raw.workflows.length === 0 || raw.workflows.length > MAX_WORKFLOWS) throw new ExperiencePackError('invalid', 'catalog 工作流数量超限');
  const workflows: ExperienceCatalogWorkflow[] = [];
  const seen = new Set<string>();
  const seenPaths = new Set<string>();
  for (const item of raw.workflows) {
    if (!isRecord(item)) throw new ExperiencePackError('invalid', 'catalog 工作流条目不合格');
    assertAllowedKeys(item, ['id', 'name', 'summary', 'path', 'status'], 'catalog.workflow');
    if (!isExperienceIdWithPrefix(item.id, `${pack.id}.workflow.`) || !boundedText(item.name, 512) || !boundedText(item.summary, 4096) || typeof item.path !== 'string' || !isSafeExperiencePath(item.path) || seen.has(item.id) || seenPaths.has(item.path)) {
      throw new ExperiencePackError('invalid', 'catalog 工作流条目不合格');
    }
    if (item.status !== undefined && item.status !== 'pending' && item.status !== 'ready') throw new ExperiencePackError('invalid', 'catalog 工作流状态不合格');
    seen.add(item.id);
    seenPaths.add(item.path);
    workflows.push({ id: item.id, name: item.name, summary: item.summary, path: item.path, ...(item.status === 'pending' || item.status === 'ready' ? { status: item.status } : {}) });
  }
  return { workflows };
}

function parseModules(raw: unknown, pack: ExperiencePackDocument): ExperienceModuleIndexEntry[] {
  if (!isRecord(raw) || raw.protocolVersion !== EXPERIENCE_PROTOCOL_VERSION || raw.packId !== pack.id || !Array.isArray(raw.items)) {
    throw new ExperiencePackError('invalid', 'modules/index.json 字段不合格');
  }
  assertAllowedKeys(raw, ['protocolVersion', 'packId', 'items', '$schema'], 'modules/index.json');
  if (raw.items.length === 0 || raw.items.length > MAX_MODULES) throw new ExperiencePackError('invalid', '模块数量超限');
  const modules: ExperienceModuleIndexEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw.items) {
    if (!isRecord(item)) throw new ExperiencePackError('invalid', '模块索引条目不合格');
    assertAllowedKeys(item, ['id', 'kind', 'name', 'summary', 'status', 'content', 'requires', 'sources'], 'modules.item');
    if (!isExperienceIdWithPrefix(item.id, `${pack.id}.`) || typeof item.kind !== 'string' || !boundedText(item.name, 512) || !boundedText(item.summary, 4096) || (item.status !== 'pending' && item.status !== 'ready') || !boundedStringArray(item.requires, MAX_DEPENDENCIES, 256) || hasDuplicates(item.requires) || seen.has(item.id)) {
      throw new ExperiencePackError('invalid', '模块索引条目不合格');
    }
    const kind = item.kind;
    if (!['role', 'rule', 'knowledge', 'process', 'tool', 'output'].includes(kind)) {
      throw new ExperiencePackError('invalid', `未知模块类型: ${kind}`);
    }
    const idParts = item.id.split('.');
    if (idParts[1] !== kind) throw new ExperiencePackError('invalid', `模块 ID 类型与 kind 不一致: ${item.id}`);
    const content = parseContentMetadata(item.content, item.status === 'ready');
    if (!Array.isArray(item.sources) || item.sources.length === 0 || item.sources.length > MAX_SOURCES) throw new ExperiencePackError('invalid', `模块来源不合格: ${item.id}`);
    const moduleId = item.id;
    const parseModuleSource = (source: unknown) => parseSource(source, moduleId);
    const sources = item.sources.map(parseModuleSource);
    modules.push({
      id: item.id,
      kind: kind as ExperienceModuleIndexEntry['kind'],
      name: item.name,
      summary: item.summary,
      status: item.status,
      requires: [...item.requires],
      content,
      sources,
    });
    seen.add(item.id);
  }
  return modules;
}

function parseContentMetadata(value: unknown, ready: boolean): ExperienceModuleIndexEntry['content'] {
  if (value === null && !ready) return null;
  if (!ready) throw new ExperiencePackError('invalid', 'pending 模块必须将 content 设为 null');
  if (!isRecord(value) || typeof value.path !== 'string' || !isSafeExperiencePath(value.path) || typeof value.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(value.sha256) || typeof value.bytes !== 'number' || !Number.isSafeInteger(value.bytes) || value.bytes <= 0 || value.bytes > MODULE_CONTENT_MAX_BYTES) {
    throw new ExperiencePackError('invalid', 'ready 模块缺少合法 content 摘要');
  }
  assertAllowedKeys(value, ['path', 'sha256', 'bytes'], 'module.content');
  return { path: value.path, sha256: value.sha256, bytes: value.bytes };
}

function parseRequirements(raw: unknown, pack: ExperiencePackDocument): ExperienceRequirement[] {
  if (!isRecord(raw) || raw.protocolVersion !== EXPERIENCE_PROTOCOL_VERSION || raw.packId !== pack.id || !Array.isArray(raw.items)) {
    throw new ExperiencePackError('invalid', 'requirements.json 字段不合格');
  }
  assertAllowedKeys(raw, ['protocolVersion', 'packId', 'items', '$schema'], 'requirements.json');
  if (raw.items.length > MAX_REQUIREMENTS) throw new ExperiencePackError('invalid', '需求数量超限');
  const seen = new Set<string>();
  return raw.items.map((item) => {
    if (!isRecord(item)) throw new ExperiencePackError('invalid', '需求条目不合格');
    assertAllowedKeys(item, ['id', 'kind', 'description'], 'requirements.item');
    if (!isExperienceIdWithPrefix(item.id, `${pack.id}.requirement.`) || typeof item.kind !== 'string' || !boundedText(item.description, 4096) || !['environment', 'intent', 'authorization', 'evidence'].includes(item.kind) || seen.has(item.id)) {
      throw new ExperiencePackError('invalid', '需求条目不合格');
    }
    seen.add(item.id);
    return { id: item.id, kind: item.kind as ExperienceRequirement['kind'], description: item.description };
  });
}

function parseRouting(raw: unknown, pack: ExperiencePackDocument): ExperienceRouting {
  if (!isRecord(raw) || raw.protocolVersion !== EXPERIENCE_PROTOCOL_VERSION || raw.packId !== pack.id || raw.defaultMode !== 'auto' || raw.explicitSelection !== 'exclusive' || raw.ambiguousMatch !== 'ask-user' || raw.noMatch !== 'ask-user' || raw.switchWorkflow !== 'explicit-only' || !Array.isArray(raw.rules)) {
    throw new ExperiencePackError('invalid', 'routing.json 字段不合格');
  }
  assertAllowedKeys(raw, ['protocolVersion', 'packId', 'defaultMode', 'explicitSelection', 'ambiguousMatch', 'noMatch', 'switchWorkflow', 'rules', '$schema'], 'routing.json');
  if (raw.rules.length === 0 || raw.rules.length > MAX_ROUTING_RULES) throw new ExperiencePackError('invalid', '路由规则数量超限');
  const seen = new Set<string>();
  const rules = raw.rules.map((rule) => {
    if (!isRecord(rule)) throw new ExperiencePackError('invalid', '路由规则不合格');
    assertAllowedKeys(rule, ['workflowId', 'intents', 'exclusions'], 'routing.rule');
    if (!isExperienceIdWithPrefix(rule.workflowId, `${pack.id}.workflow.`) || !boundedStringArray(rule.intents, MAX_PHRASES, MAX_STRING_ARRAY_ITEM) || rule.intents.length === 0 || !boundedStringArray(rule.exclusions, MAX_PHRASES, MAX_STRING_ARRAY_ITEM) || hasDuplicates(rule.intents) || hasDuplicates(rule.exclusions) || seen.has(rule.workflowId) || rule.intents.some((item) => item.trim().length === 0) || rule.exclusions.some((item) => item.trim().length === 0)) {
      throw new ExperiencePackError('invalid', '路由规则不合格');
    }
    seen.add(rule.workflowId);
    return {
      workflowId: rule.workflowId,
      intents: [...rule.intents],
      exclusions: [...rule.exclusions],
    };
  });
  return {
    defaultMode: 'auto',
    explicitSelection: 'exclusive',
    ambiguousMatch: 'ask-user',
    noMatch: 'ask-user',
    switchWorkflow: 'explicit-only',
    rules,
  };
}

function parseWorkflow(raw: unknown, pack: ExperiencePackDocument, catalogEntry: ExperienceCatalogWorkflow): ExperienceWorkflowDocument {
  if (!isRecord(raw) || raw.protocolVersion !== EXPERIENCE_PROTOCOL_VERSION || raw.packId !== pack.id || raw.id !== catalogEntry.id || !Array.isArray(raw.nodes)) {
    throw new ExperiencePackError('invalid', `工作流 ${catalogEntry.id} 字段不合格`);
  }
  assertAllowedKeys(raw, ['protocolVersion', 'packId', 'id', 'nodes', '$schema'], 'workflow');
  if (raw.nodes.length === 0 || raw.nodes.length > MAX_NODES) throw new ExperiencePackError('invalid', `工作流节点数量超限: ${catalogEntry.id}`);
  const seen = new Set<string>();
  const nodes = raw.nodes.map((node) => {
    if (!isRecord(node)) throw new ExperiencePackError('invalid', `工作流节点 ${catalogEntry.id} 字段不合格`);
    assertAllowedKeys(node, ['id', 'name', 'defaultEnabled', 'skippable', 'when', 'after', 'requires', 'modules', 'optionalModules', 'requirements', 'effects'], 'workflow.node');
    if (!isSimpleExperienceId(node.id) || !boundedText(node.name, 512) || typeof node.defaultEnabled !== 'boolean' || typeof node.skippable !== 'boolean' || (!node.skippable && !node.defaultEnabled) || (node.when !== null && !isExperienceId(node.when)) || !boundedStringArray(node.after, MAX_NODES, 128) || !boundedStringArray(node.requires, MAX_NODES, 128) || !boundedStringArray(node.modules, MAX_DEPENDENCIES, 256) || !boundedStringArray(node.optionalModules, MAX_DEPENDENCIES, 256) || !boundedStringArray(node.requirements, MAX_DEPENDENCIES, 256) || hasDuplicates(node.after) || hasDuplicates(node.requires) || hasDuplicates(node.modules) || hasDuplicates(node.optionalModules) || hasDuplicates(node.requirements) || !Array.isArray(node.effects) || node.effects.length === 0 || node.effects.length > 16 || !node.effects.every((effect) => isWorkflowEffect(effect)) || hasDuplicates(node.effects) || seen.has(node.id)) {
      throw new ExperiencePackError('invalid', `工作流节点 ${catalogEntry.id} 字段不合格`);
    }
    seen.add(node.id);
    return {
      id: node.id,
      name: node.name,
      defaultEnabled: node.defaultEnabled,
      skippable: node.skippable,
      when: node.when as string | null,
      after: node.after as string[],
      requires: node.requires as string[],
      modules: node.modules as string[],
      optionalModules: node.optionalModules as string[],
      requirements: node.requirements as string[],
      effects: [...node.effects] as string[],
    };
  });
  return { id: catalogEntry.id, name: catalogEntry.name, nodes };
}

function validateCrossReferences(input: {
  pack: ExperiencePackDocument;
  catalog: { workflows: ExperienceCatalogWorkflow[] };
  modules: ExperienceModuleIndexEntry[];
  requirements: ExperienceRequirement[];
  routing: ExperienceRouting;
  workflows: ExperienceWorkflowDocument[];
}): void {
  const moduleIds = new Set(input.modules.map((module) => module.id));
  for (const id of input.pack.requiredModules ?? []) {
    const module = input.modules.find((item) => item.id === id);
    if (!module || module.status !== 'ready' || !module.content) throw new ExperiencePackError('invalid', `基础会话规范不可用: ${id}`);
  }
  const requirementIds = new Set(input.requirements.map((requirement) => requirement.id));
  const workflowIds = new Set(input.workflows.map((workflow) => workflow.id));
  const catalogIds = new Set(input.catalog.workflows.map((workflow) => workflow.id));
  if (workflowIds.size !== input.catalog.workflows.length || workflowIds.size !== catalogIds.size || [...workflowIds].some((id) => !catalogIds.has(id))) throw new ExperiencePackError('invalid', 'catalog/workflow 数量不一致');
  if (input.pack.status === 'ready' && (input.modules.some((module) => module.status !== 'ready') || input.catalog.workflows.some((workflow) => workflow.status === 'pending'))) {
    throw new ExperiencePackError('invalid', 'ready 经验包不能包含 pending 内容');
  }
  const routedWorkflowIds = new Set(input.routing.rules.map((rule) => rule.workflowId));
  if (routedWorkflowIds.size !== input.routing.rules.length || routedWorkflowIds.size !== workflowIds.size || [...workflowIds].some((id) => !routedWorkflowIds.has(id))) throw new ExperiencePackError('invalid', '路由规则必须覆盖每个工作流且不得重复');
  for (const module of input.modules) {
    for (const dependency of module.requires) {
      if (!moduleIds.has(dependency)) throw new ExperiencePackError('invalid', `模块依赖不存在: ${dependency}`);
      if (dependency === module.id) throw new ExperiencePackError('invalid', `模块不能依赖自身: ${module.id}`);
    }
  }
  assertAcyclic(input.modules.map((module) => ({ id: module.id, edges: module.requires })));
  for (const rule of input.routing.rules) if (!workflowIds.has(rule.workflowId)) throw new ExperiencePackError('invalid', `路由工作流不存在: ${rule.workflowId}`);
  for (const workflow of input.workflows) {
    const nodeIds = new Set(workflow.nodes.map((node) => node.id));
    for (const node of workflow.nodes) {
      if (node.id === 'experience-base') throw new ExperiencePackError('invalid', 'experience-base 为宿主保留节点 ID');
      if (node.after.some((id) => node.requires.includes(id))) throw new ExperiencePackError('invalid', `节点同时声明 after 与 requires: ${workflow.id}.${node.id}`);
      for (const id of [...node.after, ...node.requires]) if (!nodeIds.has(id)) throw new ExperiencePackError('invalid', `节点依赖不存在: ${workflow.id}.${id}`);
      for (const id of [...node.modules, ...node.optionalModules]) if (!moduleIds.has(id)) throw new ExperiencePackError('invalid', `节点模块不存在: ${id}`);
      for (const id of node.requirements) if (!requirementIds.has(id)) throw new ExperiencePackError('invalid', `节点需求不存在: ${id}`);
      if (node.when !== null && !requirementIds.has(node.when)) throw new ExperiencePackError('invalid', `节点触发条件不存在: ${node.when}`);
    }
    assertAcyclic(workflow.nodes.map((node) => ({ id: node.id, edges: [...node.after, ...node.requires] })));
  }
}

function workflowStatus(index: ExperiencePackIndex, workflowId: string): 'ready' | 'pending' {
  const workflow = index.workflows.find((item) => item.id === workflowId);
  if (!workflow) return 'pending';
  const catalogEntry = index.catalog.workflows.find((item) => item.id === workflowId);
  if (catalogEntry?.status === 'pending') return 'pending';
  const moduleMap = new Map(index.modules.map((module) => [module.id, module]));
  const ids = new Set<string>();
  // Optional modules may be skipped when their正文 is not migrated yet. Only
  // required node modules (and their transitive dependencies) make a workflow
  // unavailable; this keeps a partially authored pack usable where possible.
  for (const node of workflow.nodes) {
    if (node.skippable) continue;
    for (const id of node.modules) ids.add(id);
  }
  const pendingDependencies = new Set<string>();
  const visit = (id: string) => {
    if (pendingDependencies.has(id)) return;
    pendingDependencies.add(id);
    const module = moduleMap.get(id);
    if (!module) return;
    for (const dependency of module.requires) visit(dependency);
  };
  for (const id of ids) visit(id);
  for (const id of pendingDependencies) {
    const module = moduleMap.get(id);
    if (!module || module.status !== 'ready' || module.content === null) return 'pending';
  }
  return 'ready';
}

function reachableModuleIds(workflow: ExperienceWorkflowDocument, modules: Map<string, ExperienceModuleIndexEntry>): Set<string> {
  const result = new Set<string>();
  const visit = (id: string) => {
    if (result.has(id)) return;
    result.add(id);
    const module = modules.get(id);
    if (!module) return;
    for (const dependency of module.requires) visit(dependency);
  };
  for (const node of workflow.nodes) for (const id of [...node.modules, ...node.optionalModules]) visit(id);
  return result;
}

function assertAcyclic(nodes: Array<{ id: string; edges: string[] }>): void {
  const graph = new Map(nodes.map((node) => [node.id, node.edges]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) throw new ExperiencePackError('invalid', `经验包依赖存在循环: ${id}`);
    visiting.add(id);
    for (const edge of graph.get(id) ?? []) visit(edge);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of graph.keys()) visit(id);
}

function selectionFromSnapshot(snapshot: ExperienceContextSnapshot): ExperienceSelectionSnapshot {
  return {
    version: 1,
    packId: snapshot.packId,
    mode: snapshot.mode,
    workflowId: snapshot.mode === 'explicit' ? snapshot.workflowId : null,
    ignoredNodeIds: [...snapshot.ignoredNodeIds],
    ignoredModuleIds: [...snapshot.ignoredModuleIds],
    ...(snapshot.conditions ? { conditions: { ...snapshot.conditions } } : {}),
  };
}

function conditionsEqual(left: Readonly<Record<string, string>> | undefined, right: Readonly<Record<string, string>> | undefined): boolean {
  const leftEntries = Object.entries(left ?? {}).sort(([a], [b]) => a.localeCompare(b));
  const rightEntries = Object.entries(right ?? {}).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(leftEntries) === JSON.stringify(rightEntries);
}

function contextFromSnapshot(snapshot: ExperienceContextSnapshot): ExperienceInputContext {
  return {
    version: 1,
    packId: snapshot.packId,
    packVersion: snapshot.packVersion,
    workflowId: snapshot.workflowId,
    mode: snapshot.mode,
    planDigest: snapshot.planDigest,
    modules: snapshot.modules,
  };
}

function parseSnapshot(value: unknown, expectedSessionId?: string): ExperienceContextSnapshot | null {
  if (
    !isRecord(value) ||
    Object.keys(value).some((key) => !['version', 'sessionId', 'clientId', 'inputDigest', 'conditions', 'packId', 'packVersion', 'workflowId', 'mode', 'ignoredNodeIds', 'ignoredModuleIds', 'plan', 'planDigest', 'modules', 'createdAt', 'updatedAt'].includes(key)) ||
    value.version !== 1 ||
    !boundedString(value.sessionId, 256) ||
    (expectedSessionId !== undefined && value.sessionId !== expectedSessionId) ||
    !boundedString(value.packId, 128) ||
    !boundedString(value.packVersion, 128) ||
    !boundedString(value.workflowId, 256) ||
    (value.mode !== 'auto' && value.mode !== 'explicit') ||
    !boundedStringArray(value.ignoredNodeIds, 512, 256) ||
    !boundedStringArray(value.ignoredModuleIds, 1024, 256) ||
    value.ignoredNodeIds.some((item) => !isExperienceId(item)) ||
    value.ignoredModuleIds.some((item) => !isExperienceId(item)) ||
    hasDuplicates(value.ignoredNodeIds) ||
    hasDuplicates(value.ignoredModuleIds) ||
    !isRecord(value.plan) ||
    typeof value.planDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(value.planDigest) ||
    !Array.isArray(value.modules) ||
    value.modules.length > 1024 ||
    !boundedString(value.createdAt, 64) ||
    !boundedString(value.updatedAt, 64) ||
    !Number.isFinite(Date.parse(value.createdAt)) ||
    !Number.isFinite(Date.parse(value.updatedAt))
  ) return null;
  const modules = value.modules.filter(isModuleContent);
  if (modules.length !== value.modules.length) return null;
  const plan = parseContextPlan(value.plan);
  if (!plan || plan.packId !== value.packId || plan.packVersion !== value.packVersion || plan.workflowId !== value.workflowId || plan.mode !== value.mode) return null;
  if (experiencePlanDigest(plan) !== value.planDigest) return null;
  if (value.clientId !== undefined && !boundedString(value.clientId, 256)) return null;
  if (value.inputDigest !== undefined && (typeof value.inputDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.inputDigest))) return null;
  if (value.conditions !== undefined && !validConditions(value.conditions)) return null;
  if (modules.some((module) => module.id.length > 256 || module.bytes > MODULE_CONTENT_MAX_BYTES || Buffer.byteLength(module.text, 'utf8') !== module.bytes || sha256(Buffer.from(module.text, 'utf8')) !== module.sha256)) return null;
  if (modules.some((module) => !module.id.startsWith(`${value.packId}.`) || module.id.split('.')[1] !== module.kind)) return null;
  if (hasDuplicates(modules.map((module) => module.id))) return null;
  const planModuleIds = plan.moduleIds;
  const contentModuleIds = modules.map((module) => module.id);
  if (hasDuplicates(planModuleIds) || planModuleIds.length !== contentModuleIds.length || planModuleIds.some((id, index) => id !== contentModuleIds[index])) return null;
  const enabledPlanModuleIds = plan.nodes
    .filter((node) => node.state === 'enabled')
    .flatMap((node) => node.modules.filter((module) => module.state === 'enabled').map((module) => module.id));
  const uniqueEnabledPlanModuleIds = uniqueStringsInOrder(enabledPlanModuleIds);
  if (uniqueEnabledPlanModuleIds.length !== planModuleIds.length || uniqueEnabledPlanModuleIds.some((id, index) => id !== planModuleIds[index])) return null;
  const totalModuleBytes = modules.reduce((total, module) => total + module.bytes, 0);
  if (totalModuleBytes > CONTEXT_MAX_BYTES) return null;
  const contextText = buildExperienceContextText({
    packId: value.packId,
    packVersion: value.packVersion,
    workflowId: value.workflowId,
    planDigest: value.planDigest,
    modules,
  });
  if (Buffer.byteLength(contextText, 'utf8') > CONTEXT_MAX_BYTES) return null;
  return {
    version: 1,
    sessionId: value.sessionId,
    ...(typeof value.clientId === 'string' ? { clientId: value.clientId } : {}),
    ...(typeof value.inputDigest === 'string' ? { inputDigest: value.inputDigest } : {}),
    ...(value.conditions !== undefined && validConditions(value.conditions) && Object.keys(value.conditions).length > 0 ? { conditions: value.conditions } : {}),
    packId: value.packId,
    packVersion: value.packVersion,
    workflowId: value.workflowId,
    mode: value.mode,
    ignoredNodeIds: value.ignoredNodeIds.filter((item): item is string => typeof item === 'string'),
    ignoredModuleIds: value.ignoredModuleIds.filter((item): item is string => typeof item === 'string'),
    plan,
    planDigest: value.planDigest,
    modules,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function isModuleContent(value: unknown): value is ExperienceModuleContent {
  return isRecord(value) && hasOnlyKeys(value, ['id', 'kind', 'name', 'summary', 'sha256', 'bytes', 'text']) && isExperienceId(value.id) && boundedString(value.name, 512) && boundedString(value.summary, 4096) && isExperienceModuleKind(value.kind) && typeof value.sha256 === 'string' && /^[a-f0-9]{64}$/.test(value.sha256) && typeof value.bytes === 'number' && Number.isSafeInteger(value.bytes) && value.bytes > 0 && value.bytes <= MODULE_CONTENT_MAX_BYTES && typeof value.text === 'string';
}

function isSource(value: unknown): value is { path: string; section: string } {
  return isRecord(value) && typeof value.path === 'string' && typeof value.section === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isExperienceModuleKind(value: unknown): value is ExperienceModule['kind'] {
  return value === 'role' || value === 'rule' || value === 'knowledge' || value === 'process' || value === 'tool' || value === 'output';
}

function isSimpleExperienceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]{0,127}$/.test(value);
}

function isExperienceId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/.test(value) && value.length <= 256;
}

function boundedString(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function boundedStringArray(value: unknown, maxItems: number, maxLength: number): value is string[] {
  return Array.isArray(value) && value.length <= maxItems && value.every((item) => boundedString(item, maxLength));
}

function validConditions(value: unknown): value is Record<string, 'satisfied' | 'unsatisfied' | 'unknown'> {
  if (value === undefined) return true;
  if (!isRecord(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > 128) return false;
  return entries.every(([id, state]) => isExperienceId(id) && (state === 'satisfied' || state === 'unsatisfied' || state === 'unknown'));
}

function boundedText(value: unknown, maxLength: number): value is string {
  return boundedString(value, maxLength) && !/[\u0000-\u001f\u007f]/.test(value);
}

function isSemver(value: unknown): value is string {
  return typeof value === 'string' && /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(value) && value.length <= 128;
}

function isExperienceIdWithPrefix(value: unknown, prefix: string): value is string {
  return isExperienceId(value) && value.startsWith(prefix) && value.length > prefix.length;
}

function hasDuplicates(value: readonly string[]): boolean {
  return new Set(value).size !== value.length;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: readonly string[], label: string): void {
  const allowedSet = new Set(allowed);
  const unknown = Object.keys(value).find((key) => !allowedSet.has(key));
  if (unknown) throw new ExperiencePackError('invalid', `${label} 含不允许的字段: ${unknown}`);
}

function isWorkflowEffect(value: unknown): value is string {
  return value === 'respond' || value === 'read-task-context' || value === 'read-project' || value === 'invoke-tool' || value === 'write-generated-assets' || value === 'write-project-code' || value === 'write-run-artifacts';
}

function parseSource(value: unknown, moduleId: string): { path: string; section: string } {
  if (!isRecord(value)) throw new ExperiencePackError('invalid', `模块来源不合格: ${moduleId}`);
  assertAllowedKeys(value, ['path', 'section'], 'module.source');
  if (typeof value.path !== 'string' || !isSafeExperiencePath(value.path) || !boundedText(value.section, 512)) throw new ExperiencePackError('invalid', `模块来源不合格: ${moduleId}`);
  return { path: value.path, section: value.section };
}

function parseContextPlan(value: Record<string, unknown>): ExperienceContextPlan | null {
  if (!hasOnlyKeys(value, ['packId', 'packVersion', 'workflowId', 'mode', 'nodes', 'moduleIds']) || !isExperienceId(value.packId) || !boundedString(value.packVersion, 128) || !isExperienceId(value.workflowId) || (value.mode !== 'auto' && value.mode !== 'explicit') || !Array.isArray(value.nodes) || value.nodes.length > 1024 || !boundedStringArray(value.moduleIds, 2048, 256) || value.moduleIds.some((id) => !isExperienceId(id)) || hasDuplicates(value.moduleIds)) return null;
  const nodes: ExperienceContextPlan['nodes'] = [];
  const seenNodeIds = new Set<string>();
  for (const rawNode of value.nodes) {
    if (!isRecord(rawNode) || !hasOnlyKeys(rawNode, ['id', 'state', 'modules', 'reasons']) || !isExperienceId(rawNode.id) || seenNodeIds.has(rawNode.id) || !['enabled', 'ignored', 'blocked', 'not-applicable', 'waiting'].includes(rawNode.state as string) || !Array.isArray(rawNode.modules) || rawNode.modules.length > 2048 || !boundedStringArray(rawNode.reasons, 64, 2048)) return null;
    seenNodeIds.add(rawNode.id);
    const modules: ExperienceContextPlan['nodes'][number]['modules'] = [];
    const seenModuleIds = new Set<string>();
    for (const rawModule of rawNode.modules) {
      if (!isRecord(rawModule) || !hasOnlyKeys(rawModule, ['id', 'state', 'reason']) || !isExperienceId(rawModule.id) || seenModuleIds.has(rawModule.id) || !['enabled', 'ignored', 'blocked', 'unavailable'].includes(rawModule.state as string) || (rawModule.reason !== null && !boundedString(rawModule.reason, 2048))) return null;
      seenModuleIds.add(rawModule.id);
      modules.push({ id: rawModule.id, state: rawModule.state as ExperienceContextPlan['nodes'][number]['modules'][number]['state'], reason: rawModule.reason as string | null });
    }
    nodes.push({ id: rawNode.id, state: rawNode.state as ExperienceContextPlan['nodes'][number]['state'], modules, reasons: rawNode.reasons as string[] });
  }
  const enabledModuleIds = nodes
    .filter((node) => node.state === 'enabled')
    .flatMap((node) => node.modules.filter((module) => module.state === 'enabled').map((module) => module.id));
  const uniqueEnabledModuleIds = uniqueStringsInOrder(enabledModuleIds);
  const moduleIds = value.moduleIds;
  const differsFromPlan = (id: string, index: number) => id !== moduleIds[index];
  if (uniqueEnabledModuleIds.length !== moduleIds.length || uniqueEnabledModuleIds.some(differsFromPlan)) return null;
  return { packId: value.packId, packVersion: value.packVersion, workflowId: value.workflowId, mode: value.mode, nodes, moduleIds: value.moduleIds };
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed);
  return Object.keys(value).every((key) => allowedSet.has(key));
}

function arrayOfStrings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.length > 0))];
}

function uniqueStringsInOrder(value: readonly string[]): string[] {
  return [...new Set(value)];
}

function arrayEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const leftSorted = [...left].sort();
  const rightSorted = [...right].sort();
  return leftSorted.every((item, index) => item === rightSorted[index]);
}

function overrideKey(packId: string, workflowId: string): string {
  return `${packId}\u0000${workflowId}`;
}

function normalizeOverrideRecord(value: unknown): ExperienceOverrideRecord | null {
  if (!isRecord(value) || typeof value.packId !== 'string' || typeof value.workflowId !== 'string') return null;
  return {
    packId: value.packId,
    workflowId: value.workflowId,
    ignoredNodeIds: uniqueStrings(value.ignoredNodeIds),
    ignoredModuleIds: uniqueStrings(value.ignoredModuleIds),
  };
}

function normalizeRegistryEntry(value: unknown): ExperiencePackRegistryEntry | null {
  if (!isRecord(value) || typeof value.packId !== 'string' || typeof value.version !== 'string' || typeof value.ghostId !== 'string' || typeof value.packageSha256 !== 'string' || (typeof value.status !== 'string' || !['ready', 'invalid', 'unsupported', 'unavailable'].includes(value.status)) || value.source !== 'cindy' || typeof value.installedAt !== 'string') return null;
  if (value.packageSha256 !== '' && !normalizePackageHash(value.packageSha256)) return null;
  return {
    packId: value.packId,
    version: value.version,
    ghostId: value.ghostId,
    packageSha256: value.packageSha256,
    status: value.status as ExperiencePackSummary['status'],
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
    source: 'cindy',
    installedAt: value.installedAt,
  };
}

function isSafeExperiencePath(value: string): boolean {
  if (!value || value.length > 256 || value.includes('\\') || value.includes(':') || value.includes('%') || value.includes('?') || value.includes('#') || /[\u0000-\u001f]/.test(value) || path.isAbsolute(value)) return false;
  const segments = value.split('/');
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && !/[ .]$/.test(segment));
}

async function readJsonContained(root: string, relativePath: string, maxBytes: number): Promise<unknown> {
  const bytes = await readContainedBytes(root, relativePath, maxBytes);
  const text = decodeUtf8(bytes, relativePath);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new ExperiencePackError('invalid', `${relativePath} 不是合法 JSON`);
  }
}

async function readJsonFileOrNull(file: string): Promise<unknown | null> {
  try {
    const bytes = await readStateBytes(file, STATE_FILE_MAX_BYTES);
    if (bytes === null) return null;
    return JSON.parse(decodeUtf8(bytes, file)) as unknown;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    throw error;
  }
}

async function readExperienceStateFile(
  file: string,
  logger?: ExperiencePackServiceLogger,
): Promise<unknown | null> {
  try {
    return await readJsonFileOrNull(file);
  } catch (error) {
    logger?.warn('experience state file ignored', {
      file: path.basename(file),
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function readStateBytes(file: string, maxBytes: number): Promise<Buffer | null> {
  try {
    return await readBoundedFileNoFollow(file, maxBytes, { nonBlocking: true, verifyContentStability: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') return null;
    if (error instanceof BoundedFileReadChangedError || error instanceof BoundedFileReadUncertainError) throw error;
    throw error;
  }
}

async function readContainedBytes(root: string, relativePath: string, maxBytes: number): Promise<Buffer> {
  if (!isSafeExperiencePath(relativePath)) throw new ExperiencePackError('invalid', `不安全路径: ${relativePath}`);
  let realRoot: string;
  let resolvedFile: string;
  try {
    const rootStat = await fs.promises.lstat(root, { bigint: true });
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new ExperiencePackError('invalid', '经验包根目录不是普通目录');
    realRoot = await fs.promises.realpath(root);
    resolvedFile = await resolveGhostContentPath(realRoot, relativePath, { expect: 'file', label: 'experience pack' });
  } catch (error) {
    if (error instanceof ExperiencePackError) throw error;
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') throw new ExperiencePackError('unavailable', `${relativePath} 不存在或不在包内`);
    throw new ExperiencePackError('invalid', `${relativePath} 不是包内普通文件`);
  }
  try {
    const bytes = await readBoundedFileNoFollow(resolvedFile, maxBytes, { containWithin: realRoot, nonBlocking: true, verifyContentStability: true });
    if (bytes === null) throw new ExperiencePackError('invalid', `${relativePath} 不是稳定的包内普通文件或超过 ${maxBytes} 字节上限`);
    return bytes;
  } catch (error) {
    if (error instanceof ExperiencePackError) throw error;
    if (error instanceof BoundedFileReadChangedError || error instanceof BoundedFileReadUncertainError) throw new ExperiencePackError('invalid', `${relativePath} 读取期间发生变化`);
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR' || code === 'ELOOP') throw new ExperiencePackError('unavailable', `${relativePath} 不存在或不在包内`);
    throw new ExperiencePackError('invalid', `${relativePath} 读取失败`);
  }
}

function decodeUtf8(bytes: Buffer, label: string): string {
  try {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    return decoder.decode(bytes);
  } catch {
    throw new ExperiencePackError('invalid', `${label} 不是合法 UTF-8`);
  }
}

function sha256(bytes: Buffer): string {
  const hash = crypto.createHash('sha256');
  hash.update(bytes);
  return hash.digest('hex');
}

function digestInput(text: string, selection: ExperienceSelectionSnapshot): string {
  const canonical = JSON.stringify({ text, selection });
  return sha256(Buffer.from(canonical, 'utf8'));
}

function normalizePackageHash(value: unknown): string | null {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function experienceRosterKey(
  ghosts: readonly InstalledGhost[],
  getPackageSha256?: (ghostId: string) => string | null,
): string {
  const entries = ghosts
    .filter((ghost) => ghost.manifest.experiencePack)
    .map((ghost) => {
      let packageSha256: string | null = null;
      try {
        packageSha256 = normalizePackageHash(getPackageSha256?.(ghost.manifest.id));
      } catch {
        packageSha256 = null;
      }
      return [
        ghost.manifest.id,
        ghost.manifest.version,
        ghost.enabled,
        ghost.manifest.experiencePack?.entry ?? '',
        packageSha256 ?? '',
      ] as const;
    })
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  const directory = path.dirname(file);
  await fs.promises.mkdir(directory, { recursive: true });
  const temporary = `${file}.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`;
  const text = JSON.stringify(value, null, 2);
  try {
    await fs.promises.writeFile(temporary, text, 'utf8');
    await fs.promises.rename(temporary, file);
  } catch (error) {
    await fs.promises.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function taskFilePath(root: string, sessionId: string): string {
  const digest = sha256(Buffer.from(sessionId, 'utf8'));
  return path.join(root, 'tasks', `${digest}.json`);
}
