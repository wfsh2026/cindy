import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isExperiencePackGetResult, type ExperienceSelectionSnapshot } from '@cindy/maker-shared/experience-pack';
import type { InstalledGhost } from '../../../shared/ghost';
import { ExperiencePackService } from '../experiencePackService';
import { createExperiencePackFixture } from './experiencePackFixture';

let root: string;
let ghost: InstalledGhost;
const selection: ExperienceSelectionSnapshot = { version: 1, packId: 'sausage', mode: 'explicit', workflowId: 'sausage.workflow.discussion', ignoredNodeIds: [], ignoredModuleIds: [] };

function serviceFor(owner = 'owner-a') {
  const storageRoot = path.join(root, owner);
  return new ExperiencePackService({ getGhosts: () => [ghost], getStorageRoot: () => storageRoot, getOwnerKey: () => owner, getPackageSha256: () => 'a'.repeat(64) });
}

beforeAll(async () => {
  const tempRoot = os.tmpdir();
  const prefix = path.join(tempRoot, 'cindy-experience-test-');
  root = await fs.mkdtemp(prefix);
  const zip = createExperiencePackFixture();
  const dir = path.join(root, 'sausage');
  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const file = path.resolve(dir, entry.name);
    const displacement = path.relative(dir, file);
    if (displacement.startsWith('..') || path.isAbsolute(displacement)) throw new Error('fixture escapes temporary root');
    const parent = path.dirname(file);
    await fs.mkdir(parent, { recursive: true });
    const bytes = await entry.async('nodebuffer');
    await fs.writeFile(file, bytes);
  }
  const manifestEntry = zip.file('ghost.json')!;
  const manifestText = await manifestEntry.async('string');
  const manifest = JSON.parse(manifestText);
  ghost = { dir, enabled: true, manifest } as InstalledGhost;
});

afterAll(async () => {
  if (!root) return;
  const tempRoot = os.tmpdir();
  const displacement = path.relative(tempRoot, root);
  if (displacement.startsWith('..') || path.isAbsolute(displacement) || !displacement.startsWith('cindy-experience-test-')) throw new Error('invalid cleanup root');
  await fs.rm(root, { recursive: true, force: true });
});

describe('installed project experience', () => {
  it('loads the distributed package through the real reader and keeps base content out of the UI response', async () => {
    const service = serviceFor();
    const index = await service.get('sausage');
    const result = { index };
    const valid = isExperiencePackGetResult(result);
    expect(valid).toBe(true);
    expect(index?.pack.requiredModules).toEqual(['sausage.rule.conversation']);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('每轮回复格式（必需）');
  });

  it('persists current choices before sending, isolates new tasks and owners, and keeps an explicit clear after restart', async () => {
    const service = serviceFor();
    const request = { sessionId: 'persistent-task', selection };
    await service.setSelection(request);
    const restarted = serviceFor();
    const saved = await restarted.getSelection(request.sessionId);
    expect(saved).toEqual(selection);
    const newTask = await restarted.getSelection('new-task');
    expect(newTask).toBeNull();
    const otherOwner = serviceFor('owner-b');
    const foreign = await otherOwner.getSelection(request.sessionId);
    expect(foreign).toBeNull();
    const freeze = { ...request, text: '方案讨论', clientId: 'first' };
    await service.freezeTask(freeze);
    const clear = { sessionId: request.sessionId, selection: null };
    await service.setSelection(clear);
    const afterClear = serviceFor();
    const cleared = await afterClear.getSelection(request.sessionId);
    expect(cleared).toBeNull();
  });

  it('retains the latest of rapid selection and clear writes', async () => {
    const service = serviceFor();
    const choose = { sessionId: 'rapid-task', selection };
    const clear = { sessionId: choose.sessionId, selection: null };
    const writes = [service.setSelection(choose), service.setSelection(clear)];
    await Promise.all(writes);
    const saved = await service.getSelection(choose.sessionId);
    expect(saved).toBeNull();
  });

  it('always supplies base rules, restores a valid frozen snapshot and emits truthful host status', async () => {
    const service = serviceFor();
    const configured = { ...selection, ignoredNodeIds: ['context'], ignoredModuleIds: ['sausage.role.lead'] };
    const request = { sessionId: 'base-task', clientId: 'one', text: '讨论方案', selection: configured };
    const result = await service.freezeTask(request);
    expect(result.fallbackReason).toBeUndefined();
    expect(result.context?.modules[0].id).toBe('sausage.rule.conversation');
    const ids = result.context?.modules.map((module) => module.id);
    expect(ids).not.toContain('sausage.role.lead');
    const restarted = serviceFor();
    const taskRequest = { sessionId: request.sessionId };
    const restored = await restarted.getTask(taskRequest);
    expect(restored?.planDigest).toBe(result.context?.planDigest);
    const text = service.contextText(result.context!);
    expect(text).toContain('CINDY_EXPERIENCE_STATUS={"source":"cindy"');
    expect(text).toContain('每轮回复格式（必需）');
  });

  it('does not apply global ignore preferences to another task', async () => {
    const service = serviceFor();
    const override = { packId: selection.packId, workflowId: selection.workflowId!, ignoredNodeIds: ['context'], ignoredModuleIds: ['sausage.role.lead'] };
    await service.setOverride(override);
    const request = { text: '讨论方案', selection };
    const result = await service.resolve(request);
    expect(result.selection.ignoredNodeIds).toEqual([]);
    expect(result.plan?.moduleIds).toContain('sausage.role.lead');
  });

  it('keeps automatic follow-ups on the previous workflow but does not inherit it into new tasks', async () => {
    const service = serviceFor();
    const automatic: ExperienceSelectionSnapshot = { ...selection, mode: 'auto', workflowId: null };
    const first = { sessionId: 'auto-task', clientId: 'one', text: '方案讨论', selection: automatic };
    const frozen = await service.freezeTask(first);
    expect(frozen.context?.workflowId).toBe(selection.workflowId);
    const followup = { sessionId: first.sessionId, text: '这个方案还有什么需要注意？', selection: automatic };
    const continued = await service.resolve(followup);
    expect(continued.plan?.workflowId).toBe(selection.workflowId);
    const newRequest = { ...followup, sessionId: 'fresh-auto-task' };
    const fresh = await service.resolve(newRequest);
    expect(fresh.requiresUserChoice).toBe(true);
  });

  it('asks for a manual workflow without silently selecting the first one', async () => {
    const service = serviceFor();
    const unselected = { ...selection, workflowId: null };
    const request = { text: '方案讨论', selection: unselected };
    const result = await service.resolve(request);
    expect(result.requiresUserChoice).toBe(true);
    expect(result.plan).toBeNull();
  });

  it('rejects attempts to ignore the mandatory conversation rules', async () => {
    const service = serviceFor();
    const ignored = { ...selection, ignoredModuleIds: ['sausage.rule.conversation'] };
    const request = { text: '方案讨论', selection: ignored };
    const result = await service.resolve(request);
    expect(result.plan).toBeNull();
    expect(result.reason).toContain('基础会话规范不可忽略');
  });

  it('fails preparation and resolution if mandatory content is corrupted', async () => {
    const service = serviceFor();
    const file = path.join(ghost.dir, 'experience/content/rule/conversation.md');
    const original = await fs.readFile(file);
    try {
      await fs.writeFile(file, 'corrupted test content');
      const preparation = service.get('sausage');
      await expect(preparation).rejects.toThrow('模块摘要不匹配');
      const request = { text: '方案讨论', selection };
      const result = await service.resolve(request);
      expect(result.plan).toBeNull();
      expect(result.reason).toContain('模块摘要不匹配');
    } finally {
      await fs.writeFile(file, original);
    }
  });

  it('restores historical selection when no new preference record exists', async () => {
    const service = serviceFor();
    const request = { sessionId: 'historical-task', clientId: 'one', text: '方案讨论', selection };
    await service.freezeTask(request);
    const restarted = serviceFor();
    const restored = await restarted.getSelection(request.sessionId);
    expect(restored).toEqual(selection);
  });
});
