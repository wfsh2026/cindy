// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SubagentReader } from '@/session/SubagentReader';
import type { SubagentRunDetail } from '@cindy/maker-shared/subagent-workspace';

vi.mock('@/session/SubagentAvatar', () => ({ SubagentAvatar: () => <span /> }));

const h = vi.hoisted(() => ({ current: true, copy: vi.fn(async () => undefined) }));
vi.mock('react-native', async () => {
  const React = await import('react');
  const Box = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  const Scroll = React.forwardRef((_props: { children?: React.ReactNode }, ref) => {
    React.useImperativeHandle(ref, () => ({ scrollToEnd: () => undefined }));
    return <div>{_props.children}</div>;
  });
  return {
    ActivityIndicator: () => <span>Loading</span>, Modal: Box, View: Box, ScrollView: Scroll,
    Pressable: ({ children, onPress }: { children?: React.ReactNode; onPress?: () => void }) => <button onClick={onPress}>{children}</button>,
    TextInput: ({ value, onChangeText }: { value: string; onChangeText: (text: string) => void }) => <input value={value} onChange={(event) => onChangeText(event.target.value)} />,
    StyleSheet: { create: (styles: unknown) => styles },
    AppState: { currentState: 'active', addEventListener: () => ({ remove: () => undefined }) },
  };
});
vi.mock('@/components/AppText', () => ({ Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span> }));
vi.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0 }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('expo-clipboard', () => ({ setStringAsync: h.copy }));
vi.mock('@/theme', () => ({ useTheme: () => ({ colors: {} }), useThemedStyles: () => ({}) }));
vi.mock('@/session/remoteSessionStore', () => ({ remoteSessionStore: {
  captureSessionMessageAuthority: () => ({}), isSessionMessageAuthorityCurrent: () => h.current,
} }));

const detail: SubagentRunDetail = {
  id: 'run-1', parentSessionId: 'parent-1', provider: 'codex', logicalAgentId: 'child-1', identityAliases: ['child-1'], providerRunIds: ['child-1'],
  status: 'completed', title: 'Inspect files', startedAt: 100, updatedAt: 200, activity: [], returnedResult: 'Final result',
  capabilities: { viewActivity: true, viewFullTranscript: true, viewReturnedResult: true, resume: false, steer: false, stop: false, parentContext: 'unknown' },
};
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  h.current = true;
  vi.stubGlobal('React', React);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

describe('mobile Subagent reader', () => {
  it('reads remote execution and quotes its returned result without sending', async () => {
    const entry = { id: 'e1', sequence: 1, role: 'subagent' as const, content: 'Execution content', occurredAt: 100 };
    const maker = {
      listSubagentRuns: vi.fn(async () => ({ supported: true, runs: [detail] })),
      getSubagentRunDetail: vi.fn(async () => ({ supported: true, run: detail })),
      getSubagentTranscript: vi.fn(async () => ({ supported: true, entries: [entry], tailCursor: 'tail' })),
    };
    const quote = vi.fn();
    const selection = { provider: 'codex' as const, runIdOrAlias: 'child-1' };
    await act(async () => root.render(<SubagentReader maker={maker} sessionId="parent-1" selection={selection} onClose={vi.fn()} onQuote={quote} />));
    expect(host.textContent).toContain('Final result');
    expect(host.textContent).not.toContain('Execution content');
    expect(host.querySelector('input')).toBeNull();
    expect(host.textContent).not.toContain('session.subagents.result');
    const buttons = Array.from(host.querySelectorAll('button'));
    const process = buttons.find((button) => button.textContent?.includes('session.subagents.elapsed'))!;
    act(() => process.click());
    expect(host.textContent).toContain('Execution content');
    expect(host.textContent).toContain('Final result');
    const updated = Array.from(host.querySelectorAll('button'));
    const quoteButton = updated.find((button) => button.textContent === 'session.subagents.quote')!;
    act(() => quoteButton.click());
    expect(quote).toHaveBeenCalledWith('Final result');
    expect(maker.getSubagentTranscript).toHaveBeenCalledWith({ sessionId: 'parent-1', provider: 'codex', runIdOrAlias: 'child-1', cursor: undefined, limit: 25 });
  });

  it('drops a detail response after the task ownership changes', async () => {
    const maker = {
      listSubagentRuns: vi.fn(async () => ({ supported: true, runs: [] })),
      getSubagentRunDetail: vi.fn(async () => { h.current = false; return { supported: true, run: detail }; }),
      getSubagentTranscript: vi.fn(async () => ({ supported: true, entries: [] })),
    };
    const selection = { provider: 'codex' as const, runIdOrAlias: 'child-1' };
    await act(async () => root.render(<SubagentReader maker={maker} sessionId="parent-1" selection={selection} onClose={vi.fn()} onQuote={vi.fn()} />));
    expect(host.textContent).not.toContain('Inspect files');
    expect(maker.getSubagentTranscript).not.toHaveBeenCalled();
  });
});
