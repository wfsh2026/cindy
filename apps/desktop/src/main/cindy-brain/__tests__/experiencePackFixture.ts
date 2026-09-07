import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import type { ExperienceModuleIndexEntry, ExperienceModuleKind, ExperienceWorkflowNode } from '@cindy/maker-shared/experience-pack';

// Entirely synthetic data: never reads or embeds a user's project knowledge or distribution.
export const FIXTURE_RESOURCES = {
  'runtime/resources.cjs': 'module.exports = { fixture: true };\n',
  'resources/example.rs': 'fn main() { println!("fixture"); }\n',
  'resources/example.go': 'package main\nfunc main() {}\n',
  'resources/reference.txt': 'Synthetic reference for package round-trip tests.\n',
};

const ROUTES: Record<string, string[]> = {
  discussion: ['方案讨论', '讨论方案', '分析这个 Bug'],
  'quick-change': ['修复这个 Bug'],
  dev: ['迁移其他工作流', '执行这个方案', '实现新功能'],
  'behavior-tree': ['行为树'],
  'unity-ugui-ui': ['Unity UGUI'],
  'code-review-doc': ['代码审核'],
  'project-ops': ['切换分支'],
  knowledge: ['知识库'],
  'major-decision': ['重大决策'],
};

function makeNode(id: string, modules: string[]): ExperienceWorkflowNode {
  return { id, name: id, modules, optionalModules: [], defaultEnabled: true, skippable: false,
    when: null, after: [], requires: [], requirements: [], effects: ['respond'] };
}

/** Builds a real archive with hashed synthetic content, multiple workflows and optional nodes. */
export function createExperiencePackFixture(): JSZip {
  const archive = new JSZip();
  const modules: ExperienceModuleIndexEntry[] = [];
  const addJson = (file: string, value: unknown) => {
    const json = JSON.stringify(value);
    archive.file(file, json);
  };
  const addModule = (kind: ExperienceModuleKind, slug: string) => {
    const id = `sausage.${kind}.${slug}`;
    const path = `experience/content/${kind}/${slug}.md`;
    const text = kind === 'rule' ? 'Synthetic private body marker: 每轮回复格式（必需） 【任务状态】\n' : `Synthetic module ${id}.\n`;
    const hash = createHash('sha256');
    hash.update(text);
    const sha256 = hash.digest('hex');
    const bytes = Buffer.byteLength(text);
    const content = { path, sha256, bytes };
    modules.push({ id, kind, name: slug, summary: `Fixture ${slug}`, status: 'ready', requires: [], content,
      sources: [{ path: 'resources/reference.txt', section: 'synthetic' }] });
    archive.file(path, text);
    return id;
  };
  const base = addModule('rule', 'conversation');
  const lead = addModule('role', 'lead');
  const project = addModule('knowledge', 'project');
  const output = addModule('output', 'summary');
  const refine = addModule('process', 'dev-refine');
  const build = addModule('process', 'dev-build');
  const codegen = addModule('tool', 'codegen');
  addModule('process', 'generate');
  addModule('knowledge', 'extra-one');
  addModule('knowledge', 'extra-two');
  const common = { protocolVersion: '0.1.0', packId: 'sausage' };
  const workflows = [];
  const rules = [];
  const routeEntries = Object.entries(ROUTES);
  for (const [slug, intents] of routeEntries) {
    const id = `sausage.workflow.${slug}`;
    const path = `experience/workflows/${slug}.json`;
    const required = [project, output];
    for (let index = 0; index < 5; index += 1) {
      const moduleSlug = `${slug}-${index}`;
      const moduleId = addModule('process', moduleSlug);
      required.push(moduleId);
    }
    const context = makeNode('context', [lead]);
    context.skippable = true;
    const main = makeNode('main', required);
    const nodes = [context, main];
    if (slug === 'dev') {
      const refineNode = makeNode('refine', [refine]);
      refineNode.skippable = true;
      const buildNode = makeNode('build', [build]);
      buildNode.optionalModules = [codegen];
      nodes.push(refineNode, buildNode);
    }
    addJson(path, { ...common, id, nodes });
    workflows.push({ id, path, name: slug, summary: `Synthetic ${slug}`, status: 'ready' });
    rules.push({ workflowId: id, intents, exclusions: [] });
  }
  const manifest = { schemaVersion: 2, id: 'sausage', name: 'Synthetic experience fixture', version: '0.2.0',
    kind: 'chip', entry: 'main.js', slots: ['node'], node: { entry: 'runtime/resources.cjs', protocol: 'json-rpc-stdio' },
    experiencePack: { entry: 'experience/pack.json' } };
  addJson('ghost.json', manifest);
  archive.file('main.js', '// synthetic fixture; never executed\n');
  addJson('experience/pack.json', { protocolVersion: common.protocolVersion, id: common.packId, version: manifest.version,
    name: 'Synthetic experience fixture', status: 'ready', requiredModules: [base], entries: {
      catalog: 'experience/catalog.json', modules: 'experience/modules.json',
      requirements: 'experience/requirements.json', routing: 'experience/routing.json' } });
  addJson('experience/catalog.json', { ...common, workflows });
  addJson('experience/modules.json', { ...common, items: modules });
  addJson('experience/requirements.json', { ...common, items: [] });
  addJson('experience/routing.json', { ...common, defaultMode: 'auto', explicitSelection: 'exclusive',
    ambiguousMatch: 'ask-user', noMatch: 'ask-user', switchWorkflow: 'explicit-only', rules });
  const resources = Object.entries(FIXTURE_RESOURCES);
  for (const [file, content] of resources) archive.file(file, content);
  return archive;
}
