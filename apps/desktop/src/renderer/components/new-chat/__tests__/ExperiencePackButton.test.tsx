// @vitest-environment jsdom
import React, { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExperienceSelectionSnapshot } from '@cindy/maker-shared/experience-pack';
import { ExperiencePackButton } from '../ExperiencePackButton';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key.split('.').at(-1) }) }));
vi.mock('@/components/ui/morph-popover', () => ({ MorphPopover: ({ trigger, children }: { trigger: React.ReactNode; children: React.ReactNode }) => <div>{trigger}{children}</div> }));
vi.mock('@/components/ui/tooltip', () => ({ Tip: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const summary = { packId: 'sausage', packVersion: '0.1.1', name: '香肠派对', enabled: true, status: 'ready', workflows: [{ id: 'sausage.workflow.discussion', name: '轻量讨论', summary: '讨论方案', status: 'ready' }] };
const index = { pack: { requiredModules: ['sausage.rule.conversation'] }, workflows: [{ id: 'sausage.workflow.discussion', name: '轻量讨论', nodes: [] }], modules: [] };
const getOverride = vi.fn();
const setOverride = vi.fn();
const onChange = vi.fn();
const getTask = vi.fn();

function Picker() {
  const [value, setValue] = useState<ExperienceSelectionSnapshot>();
  const change = (next?: ExperienceSelectionSnapshot) => {
    onChange(next);
    setValue(next);
  };
  return <ExperiencePackButton value={value} onChange={change} open />;
}

beforeEach(() => {
  vi.clearAllMocks();
  getTask.mockResolvedValue({ snapshot: null });
  const api = { experiencePacks: { list: vi.fn().mockResolvedValue({ packs: [summary] }), get: vi.fn().mockResolvedValue({ index }), resolve: vi.fn().mockResolvedValue({ plan: null }), onChanged: vi.fn(() => () => undefined), getOverride, setOverride, getTask } };
  Object.defineProperty(window, 'electronAPI', { configurable: true, value: api });
});
afterEach(cleanup);

describe('project experience modes', () => {
  it('shows host preparation details without restoring a workflow or changing selection', async () => {
    const value: ExperienceSelectionSnapshot = { version: 1, packId: 'sausage', mode: 'auto', workflowId: null, ignoredNodeIds: [], ignoredModuleIds: [] };
    const snapshot = { sessionId: 'active', packId: 'sausage', packVersion: '0.2.0', workflowId: 'sausage.workflow.discussion', planDigest: 'host-digest', plan: { moduleIds: ['sausage.rule.conversation'] } };
    getTask.mockResolvedValue({ snapshot });
    const element = <ExperiencePackButton sessionId="active" value={value} onChange={onChange} open />;
    const view = render(element);
    await screen.findByText('lastPrepared');
    const disclaimer = screen.getByText('preparedOnly');
    expect(disclaimer).not.toBeNull();
    expect(onChange).not.toHaveBeenCalled();
    const workflow = screen.queryByRole('option', { name: /轻量讨论/ });
    expect(workflow).toBeNull();
    getTask.mockResolvedValue({ snapshot: null });
    const next = <ExperiencePackButton sessionId="new-task" value={value} onChange={onChange} open />;
    view.rerender(next);
    await waitFor(() => {
      const old = screen.queryByText('host-digest');
      expect(old).toBeNull();
    });
  });

  it('keeps radio groups independent when two composers are mounted', async () => {
    const value: ExperienceSelectionSnapshot = { version: 1, packId: 'sausage', mode: 'auto', workflowId: null, ignoredNodeIds: [], ignoredModuleIds: [] };
    const element = <><ExperiencePackButton value={value} onChange={onChange} open /><ExperiencePackButton value={value} onChange={onChange} open /></>;
    render(element);
    const controls = await screen.findAllByRole('radio', { name: 'auto' });
    const first = controls[0] as HTMLInputElement;
    const second = controls[1] as HTMLInputElement;
    expect(first.name).not.toBe(second.name);
    expect(first.checked).toBe(true);
    expect(second.checked).toBe(true);
  });

  it('hides workflow options in automatic mode and shows them only after manual selection', async () => {
    render(<Picker />);
    const pack = await screen.findByRole('option', { name: /香肠派对/ });
    fireEvent.click(pack);
    await screen.findByText('baseEnabled');
    expect(screen.queryByRole('option', { name: /轻量讨论/ })).toBeNull();
    const manual = screen.getByRole('radio', { name: 'explicit' });
    const autoBefore = screen.getByRole('radio', { name: 'auto' }) as HTMLInputElement;
    expect(autoBefore.checked).toBe(true);
    expect(autoBefore.closest('label')?.className).toContain('border-[var(--text-primary)]');
    expect(manual.closest('label')?.className).toContain('border-[var(--border-default)]');
    fireEvent.click(manual);
    expect((manual as HTMLInputElement).checked).toBe(true);
    expect(autoBefore.checked).toBe(false);
    expect(manual.closest('label')?.className).toContain('bg-[var(--surface-chip)]');
    const workflow = await screen.findByRole('option', { name: /轻量讨论/ });
    expect(workflow.getAttribute('aria-selected')).toBe('false');
    const waiting = onChange.mock.calls.at(-1)?.[0];
    expect(waiting).toMatchObject({ mode: 'explicit', workflowId: null });
    fireEvent.click(workflow);
    const chosen = onChange.mock.calls.at(-1)?.[0];
    expect(chosen).toMatchObject({ mode: 'explicit', workflowId: 'sausage.workflow.discussion' });
    const automatic = screen.getByRole('radio', { name: 'auto' });
    fireEvent.click(automatic);
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /轻量讨论/ })).toBeNull();
    });
    expect(getOverride).not.toHaveBeenCalled();
    expect(setOverride).not.toHaveBeenCalled();
  });
});
