import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { routeExperience, type ExperienceSelectionSnapshot } from '@cindy/maker-shared/experience-pack';
import { validateGhostManifest, type InstalledGhost } from '../../../shared/ghost';
import { ExperiencePackService } from '../experiencePackService';
import { GhostManager } from '../GhostManager';
import { createExperiencePackFixture, FIXTURE_RESOURCES } from './experiencePackFixture';

let root: string;
let service: ExperiencePackService;
let archive: JSZip;

beforeAll(async () => {
  const temporary = os.tmpdir();
  const prefix = path.join(temporary, 'cindy-experience-migration-');
  root = await fs.mkdtemp(prefix);
  const fixture = createExperiencePackFixture();
  const fixtureBytes = await fixture.generateAsync({ type: 'nodebuffer' });
  const artifact = path.join(root, 'fixture.cindy');
  await fs.writeFile(artifact, fixtureBytes);
  const registry = path.join(root, 'registry');
  const manager = new GhostManager({ getRootDir: () => registry });
  const inspection = await manager.inspect(artifact);
  expect(inspection).toMatchObject({ manifest: { id: 'sausage', version: '0.2.0', node: { entry: 'runtime/resources.cjs' } } });
  const bytes = await fs.readFile(artifact);
  archive = await JSZip.loadAsync(bytes);
  const dir = path.join(root, 'pack');
  for (const entry of Object.values(archive.files)) {
    if (entry.dir || !entry.name.startsWith('experience/')) continue;
    const target = path.resolve(dir, entry.name);
    const relative = path.relative(dir, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid fixture path');
    const parent = path.dirname(target);
    await fs.mkdir(parent, { recursive: true });
    const content = await entry.async('nodebuffer');
    await fs.writeFile(target, content);
  }
  const manifestEntry = archive.file('ghost.json')!;
  const manifestBody = await manifestEntry.async('string');
  const manifest = JSON.parse(manifestBody);
  const validation = validateGhostManifest(manifest);
  expect(validation.ok).toBe(true);
  const ghost = { dir, enabled: true, manifest } as InstalledGhost;
  const storage = path.join(root, 'state');
  service = new ExperiencePackService({ getGhosts: () => [ghost], getStorageRoot: () => storage, getOwnerKey: () => 'migration-owner', getPackageSha256: () => 'b'.repeat(64) });
});

afterAll(async () => {
  if (!root) return;
  const temporary = os.tmpdir();
  const relative = path.relative(temporary, root);
  if (!relative.startsWith('cindy-experience-migration-') || path.isAbsolute(relative)) throw new Error('Invalid cleanup root');
  await fs.rm(root, { recursive: true, force: true });
});

function selectionFor(slug: string): ExperienceSelectionSnapshot {
  return { version: 1, packId: 'sausage', mode: 'explicit', workflowId: `sausage.workflow.${slug}`, ignoredNodeIds: [], ignoredModuleIds: [] };
}

describe('synthetic multi-workflow package distribution', () => {
  it('loads every workflow with mandatory base rules and without pending module stubs', async () => {
    const index = await service.get('sausage');
    expect(index?.status).toBe('ready');
    expect(index?.catalog.workflows).toHaveLength(9);
    expect(index?.modules).toHaveLength(55);
    for (const entry of index!.catalog.workflows) {
      const slug = entry.id.slice('sausage.workflow.'.length);
      const selection = selectionFor(slug);
      const request = { sessionId: `migration-${slug}`, clientId: slug, text: '按选定工作流处理', selection };
      const result = await service.freezeTask(request);
      expect(result.fallbackReason, slug).toBeUndefined();
      expect(result.context?.workflowId).toBe(entry.id);
      expect(result.context?.modules[0].id).toBe('sausage.rule.conversation');
      const loaded = result.context!.modules;
      expect(loaded.length).toBeGreaterThan(3);
      const others = loaded.filter((module) => module.id.startsWith('sausage.process.dev-'));
      if (slug !== 'dev') expect(others).toHaveLength(0);
      const base = loaded[0].text;
      expect(base).toContain('【任务状态】');
      expect(base).not.toContain('原样复制本轮');
      expect(base).not.toContain('必须原样引用');
    }
  });

  it('preserves explicit exceptions without dropping the base or changing workflows', async () => {
    const selection = selectionFor('dev');
    selection.ignoredNodeIds = ['refine'];
    const request = { sessionId: 'ignore-dev', text: '生成行为树', selection };
    const result = await service.freezeTask(request);
    expect(result.context?.workflowId).toBe('sausage.workflow.dev');
    const ids = result.context!.modules.map((module) => module.id);
    expect(ids).not.toContain('sausage.process.dev-refine');
    expect(ids).toContain('sausage.rule.conversation');
    expect(ids).not.toContain('sausage.process.generate');
  });

  it('lets users omit an optional source tool without disabling the workflow', async () => {
    const selection = selectionFor('dev');
    selection.ignoredModuleIds = ['sausage.tool.codegen'];
    const request = { sessionId: 'ignore-codegen', text: '执行开发', selection };
    const result = await service.freezeTask(request);
    expect(result.fallbackReason).toBeUndefined();
    const ids = result.context!.modules.map((module) => module.id);
    expect(ids).not.toContain('sausage.tool.codegen');
    expect(ids).toContain('sausage.process.dev-build');
    expect(ids).toContain('sausage.rule.conversation');
  });

  it.each([
    ['先分析这个 Bug 为什么出现，不修改代码', 'discussion'],
    ['请修复这个 Bug', 'quick-change'],
    ['迁移其他工作流过来', 'dev'],
    ['没有问题，执行这个方案', 'dev'],
    ['搭建 RoleAI 行为树', 'behavior-tree'],
    ['实现 Unity UGUI 背包界面', 'unity-ugui-ui'],
    ['对当前分支做代码审核', 'code-review-doc'],
    ['切换分支', 'project-ops'],
    ['维护知识库的链接索引', 'knowledge'],
    ['需要评估重大决策', 'major-decision'],
  ])('routes %s using light metadata to %s', async (text, slug) => {
    const index = await service.get('sausage');
    const result = routeExperience({ text, routing: index!.routing });
    expect(result).toMatchObject({ kind: 'matched', workflowId: `sausage.workflow.${slug}` });
  });

  it('asks on ambiguity or unrelated new input, but retains real follow-ups', async () => {
    const explicit = selectionFor('dev');
    const selection: ExperienceSelectionSnapshot = { ...explicit, mode: 'auto', workflowId: null };
    const first = { sessionId: 'auto-migration', clientId: 'first', text: '实现新功能', selection };
    const frozen = await service.freezeTask(first);
    expect(frozen.context?.workflowId).toBe(explicit.workflowId);
    const follow = await service.resolve({ sessionId: first.sessionId, text: '继续', selection });
    expect(follow.plan?.workflowId).toBe(explicit.workflowId);
    const unrelated = await service.resolve({ sessionId: first.sessionId, text: '今天天气很好', selection });
    expect(unrelated.requiresUserChoice).toBe(true);
    const mixed = await service.resolve({ text: '代码审核和切换分支', selection });
    expect(mixed.requiresUserChoice).toBe(true);
  });

  it('round-trips synthetic source and references without global skills or executable installers', async () => {
    const resources = Object.entries(FIXTURE_RESOURCES);
    for (const [file, expected] of resources) {
      const entry = archive.file(file);
      expect(entry).not.toBeNull();
      const content = await entry!.async('string');
      expect(content).toBe(expected);
    }
    const names = Object.keys(archive.files);
    expect(names.some((name) => name.endsWith('/SKILL.md'))).toBe(false);
    expect(names.some((name) => name.endsWith('.exe'))).toBe(false);
  });
});
