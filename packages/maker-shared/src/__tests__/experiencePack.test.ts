import { describe, expect, it } from 'vitest';
import { resolveExperience, routeExperience, normalizeExperienceSelectionSnapshot, type ExperiencePack } from '../experiencePack.js';

const pack: ExperiencePack = {
  id: 'sausage', version: '0.1.0', protocolVersion: '0.1.0',
  modules: [
    { id: 'sausage.process.discussion', kind: 'process', name: '讨论', summary: '讨论', status: 'ready', requires: [] },
    { id: 'sausage.knowledge.project', kind: 'knowledge', name: '项目', summary: '项目', status: 'ready', requires: [] },
    { id: 'sausage.output.conclusion', kind: 'output', name: '结论', summary: '结论', status: 'pending', requires: [] },
  ],
  requirements: [{ id: 'sausage.requirement.decision-record-approved', kind: 'authorization', description: '允许记录' }],
  workflows: [{ id: 'sausage.workflow.discussion', name: '轻量讨论', nodes: [
    { id: 'analyze', name: '分析', defaultEnabled: true, skippable: false, when: null, after: [], requires: [], modules: ['sausage.process.discussion'], optionalModules: ['sausage.knowledge.project'], requirements: [] },
    { id: 'record', name: '记录', defaultEnabled: true, skippable: true, when: 'sausage.requirement.decision-record-approved', after: ['analyze'], requires: ['analyze'], modules: ['sausage.output.conclusion'], optionalModules: [], requirements: ['sausage.requirement.decision-record-approved'] },
  ] }],
};

describe('experience pack resolver', () => {
  it('retains a manual selection awaiting a workflow as valid composer metadata', () => {
    const pending = { version: 1, packId: 'sausage', mode: 'explicit', workflowId: null, ignoredNodeIds: [], ignoredModuleIds: [] };
    const normalized = normalizeExperienceSelectionSnapshot(pending);
    expect(normalized).toEqual(pending);
  });

  it('returns a frozen plan with ready and unavailable module states', () => {
    const plan = resolveExperience({ pack, selection: { mode: 'explicit', workflowId: 'sausage.workflow.discussion', overrides: [] }, conditions: { 'sausage.requirement.decision-record-approved': 'unsatisfied' } });
    expect(plan.packVersion).toBe('0.1.0');
    expect(plan.nodes[0].state).toBe('enabled');
    expect(plan.nodes[0].modules.map((module) => module.state)).toEqual(['enabled', 'enabled']);
    expect(plan.nodes[1].state).toBe('not-applicable');
  });

  it('does not restore an ignored optional module', () => {
    const plan = resolveExperience({ pack, selection: { mode: 'explicit', workflowId: 'sausage.workflow.discussion', overrides: [{ workflowId: 'sausage.workflow.discussion', ignoredNodeIds: [], ignoredModuleIds: ['sausage.knowledge.project'] }] } });
    expect(plan.nodes[0].modules[1]).toMatchObject({ id: 'sausage.knowledge.project', state: 'ignored' });
  });

  it('requires a resolved workflow for automatic mode', () => {
    const multiWorkflowPack = { ...pack, workflows: [...pack.workflows, { id: 'sausage.workflow.other', nodes: [] }] };
    const run = () => resolveExperience({ pack: multiWorkflowPack, selection: { mode: 'auto', workflowId: null, overrides: [] } });
    expect(run).toThrow(/automatic experience routing/);
  });

  it('treats after as ordering only while requires needs an enabled predecessor', () => {
    const afterOnly = resolveExperience({
      pack: {
        ...pack,
        modules: pack.modules.filter((module) => module.id !== 'sausage.output.conclusion'),
        workflows: [{ id: 'sausage.workflow.after', nodes: [
          { id: 'first', name: 'first', defaultEnabled: false, skippable: true, when: null, after: [], requires: [], modules: [], optionalModules: [], requirements: [] },
          { id: 'second', name: 'second', defaultEnabled: true, skippable: false, when: null, after: ['first'], requires: [], modules: [], optionalModules: [], requirements: [] },
        ] }],
      },
      selection: { mode: 'explicit', workflowId: 'sausage.workflow.after', overrides: [] },
    });
    expect(afterOnly.nodes[1].state).toBe('enabled');

    const requires = resolveExperience({
      pack: {
        ...pack,
        modules: pack.modules.filter((module) => module.id !== 'sausage.output.conclusion'),
        workflows: [{ id: 'sausage.workflow.requires', nodes: [
          { id: 'first', name: 'first', defaultEnabled: false, skippable: true, when: null, after: [], requires: [], modules: [], optionalModules: [], requirements: [] },
          { id: 'second', name: 'second', defaultEnabled: true, skippable: false, when: null, after: ['first'], requires: ['first'], modules: [], optionalModules: [], requirements: [] },
        ] }],
      },
      selection: { mode: 'explicit', workflowId: 'sausage.workflow.requires', overrides: [] },
    });
    expect(requires.nodes[1].state).toBe('blocked');
  });

  it('does not block a node when an optional dependency is pending', () => {
    const optionalPack: ExperiencePack = {
      ...pack,
      workflows: [{ id: 'sausage.workflow.optional', nodes: [{
        id: 'use', name: 'use', defaultEnabled: true, skippable: false, when: null, after: [], requires: [],
        modules: [], optionalModules: ['sausage.output.conclusion'], requirements: [],
      }] }],
    };
    const plan = resolveExperience({ pack: optionalPack, selection: { mode: 'explicit', workflowId: 'sausage.workflow.optional', overrides: [] } });
    expect(plan.nodes[0].state).toBe('enabled');
    expect(plan.moduleIds).toEqual([]);
    expect(plan.nodes[0].modules[0]).toMatchObject({ state: 'unavailable' });
  });

  it('blocks a required module whose dependency was ignored', () => {
    const requiredPack: ExperiencePack = {
      ...pack,
      modules: [
        ...pack.modules,
        { id: 'sausage.process.consumer', kind: 'process', name: 'consumer', summary: 'consumer', status: 'ready', requires: ['sausage.knowledge.project'] },
      ],
      workflows: [{ id: 'sausage.workflow.required', nodes: [{
        id: 'use', name: 'use', defaultEnabled: true, skippable: false, when: null, after: [], requires: [],
        modules: ['sausage.process.consumer'], optionalModules: [], requirements: [],
      }] }],
    };
    const plan = resolveExperience({ pack: requiredPack, selection: { mode: 'explicit', workflowId: 'sausage.workflow.required', overrides: [{ workflowId: 'sausage.workflow.required', ignoredNodeIds: [], ignoredModuleIds: ['sausage.knowledge.project'] }] } });
    expect(plan.nodes[0].state).toBe('blocked');
    expect(plan.nodes[0].modules.find((module) => module.id === 'sausage.knowledge.project')?.state).toBe('blocked');
  });

  it('routes only unique non-empty phrases and keeps ambiguous/no-match visible', () => {
    const routing = {
      defaultMode: 'auto' as const,
      explicitSelection: 'exclusive' as const,
      ambiguousMatch: 'ask-user' as const,
      noMatch: 'ask-user' as const,
      switchWorkflow: 'explicit-only' as const,
      rules: [
        { workflowId: 'sausage.workflow.discussion', intents: ['方案讨论', ''], exclusions: [] },
        { workflowId: 'sausage.workflow.behavior-tree', intents: ['行为树'], exclusions: [] },
      ],
    };
    expect(routeExperience({ text: '请做方案讨论', routing })).toMatchObject({ kind: 'matched', workflowId: 'sausage.workflow.discussion' });
    expect(routeExperience({ text: '方案讨论和行为树', routing })).toMatchObject({ kind: 'ambiguous' });
    expect(routeExperience({ text: '随便聊聊', routing })).toMatchObject({ kind: 'no-match' });
  });

  it('rejects selection payloads that contain正文 or malformed IDs', () => {
    expect(normalizeExperienceSelectionSnapshot({
      version: 1, packId: 'sausage', mode: 'auto', workflowId: null,
      ignoredNodeIds: [], ignoredModuleIds: [], text: 'secret',
    })).toBeNull();
    expect(normalizeExperienceSelectionSnapshot({
      version: 1, packId: 'sausage', mode: 'auto', workflowId: null,
      ignoredNodeIds: [''], ignoredModuleIds: [],
    })).toBeNull();
  });
});
