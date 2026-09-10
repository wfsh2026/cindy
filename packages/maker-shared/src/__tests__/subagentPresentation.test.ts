import { describe, expect, it } from 'vitest';
import { subagentDisplayTitle, subagentIdentityVariant, subagentWorkLabel } from '../subagentPresentation';

describe('Subagent presentation across readers', () => {
  it('keeps the Chinese name and glyph identical before and after durable identity resolution', () => {
    const card = { parentToolUseId: 'spawn-1', title: '/root/scout' };
    const record = { parentToolUseId: 'spawn-1', logicalAgentId: 'task-1', id: 'durable-1', title: 'English runtime title' };
    const expectedName = subagentDisplayTitle(card);
    const name = subagentDisplayTitle(record);
    const expectedVariant = subagentIdentityVariant(card);
    const variant = subagentIdentityVariant(record);
    expect(name).toMatch(/^[\u4e00-\u9fff]+$/);
    expect(name).toBe(expectedName);
    expect(variant).toBe(expectedVariant);
  });

  it('keeps the assignment distinct from the Chinese identity and omits internal paths', () => {
    const work = subagentWorkLabel({ title: '/root/subagent_ui_acceptance', description: '检查 Subagent 界面\n第二行' });
    const absent = subagentWorkLabel({ title: '/root/scout' });
    expect(work).toBe('检查 Subagent 界面');
    expect(absent).toBeUndefined();
  });
});
