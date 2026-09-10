import { useMemo, useState } from 'react';
import { useSubagentReadingPosition } from './useSubagentReadingPosition';
import { subagentDisplayTitle } from '@cindy/maker-shared/subagent-workspace';
import { SubagentAvatar } from '@/components/chat/SubagentAvatar';
import { insertPromptIntoComposer } from '@/lib/composerActionsBus';
import { useTranslation } from 'react-i18next';
import { AlertCircle, ChevronRight, LoaderCircle, SendHorizontal, Square } from 'lucide-react';
import type {
  SubagentChildRun,
  SubagentRunDetail,
  SubagentTranscriptEntry,
} from '@cindy/maker-shared/subagent-workspace';

import { AssistantMessage } from '@/components/chat/AssistantMessage';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer';
import { UserMessage } from '@/components/chat/UserMessage';
import { Spinner } from '@/components/ui/spinner';
import { Tip } from '@/components/ui/tooltip';
import {
  getComposerModifierShortcutLabel,
  getComposerSendShortcutLabel,
  resolveComposerEnterIntent,
  useComposerSendShortcutPreference,
} from '@/hooks/useComposerSendShortcutPreference';
import { cn } from '@/lib/utils';
import { ConversationStream } from './ConversationStream';
import {
  CenteredState,
  HeaderBack,
  SectionTitle,
  SubagentErrorNotice,
} from './SubagentChrome';
import {
  buildSubagentConversation,
  lastAssistantItemId,
} from './subagentConversation';
import {
  childStatusLabel,
  formatDuration,
  runTitle,
} from './subagentFormat';

export type SubagentControlIntent = 'steer' | 'follow_up' | 'resume';

export interface SubagentDetailViewProps {
  detail: SubagentRunDetail | null;
  loading: boolean;
  workdir: string;
  allowPrivilegedLinks: boolean;
  stopping: boolean;
  transcript: readonly SubagentTranscriptEntry[];
  transcriptLoading: boolean;
  transcriptIncomplete?: boolean;
  readerScope?: string;
  /** Non-null only when the eager paging loop stopped at its page bound. */
  transcriptCursor: string | null;
  onLoadMoreTranscript: () => void;
  onBack: () => void;
  onStop: (run: SubagentRunDetail, childId?: string) => void;
  onControl: (
    run: SubagentRunDetail,
    action: SubagentControlIntent,
    message: string,
    childId?: string,
  ) => Promise<boolean>;
}

function LegacyDetailView({
  detail,
  loading,
  workdir,
  allowPrivilegedLinks,
  onBack,
}: Pick<
  SubagentDetailViewProps,
  'detail' | 'loading' | 'workdir' | 'allowPrivilegedLinks' | 'onBack'
>) {
  const { t } = useTranslation();
  if (loading && !detail) {
    return (
      <CenteredState icon={LoaderCircle} spinning label={t('rightSidebar.subagents.loading')} />
    );
  }
  if (!detail) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <HeaderBack onBack={onBack} title={t('rightSidebar.subagents.notFound')} />
      </div>
    );
  }
  const title = runTitle(detail, t('rightSidebar.subagents.untitled'));
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-subagent-detail-mode="legacy">
      <HeaderBack onBack={onBack} title={title} source={detail} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-3">
        {detail.description ? (
          <section className="mt-5">
            <SectionTitle>{t('rightSidebar.subagents.assignment')}</SectionTitle>
            <p className="select-text whitespace-pre-wrap text-12 leading-5 text-[var(--text-secondary)]">
              {detail.description}
            </p>
          </section>
        ) : null}

        {detail.capabilities.viewReturnedResult && detail.returnedResult ? (
          <section className="mt-5">
            <SectionTitle>{t('rightSidebar.subagents.returnedResult')}</SectionTitle>
            <div className="text-13 leading-5 text-[var(--text-primary)]">
              <MarkdownRenderer
                workingDir={workdir}
                content={detail.returnedResult}
                allowPrivilegedLinks={allowPrivilegedLinks}
              />
            </div>
            {detail.returnedResultTruncated ? (
              <p className="mt-2 text-11 text-[var(--text-tertiary)]">
                {t('rightSidebar.subagents.resultTruncated')}
              </p>
            ) : null}
          </section>
        ) : detail.summary ? (
          <section className="mt-5">
            <SectionTitle>{t('rightSidebar.subagents.latestUpdate')}</SectionTitle>
            <p className="select-text whitespace-pre-wrap text-12 leading-5 text-[var(--text-secondary)]">
              {detail.summary}
            </p>
          </section>
        ) : null}

        {!detail.capabilities.viewFullTranscript ? (
          <p className="mt-5 rounded-xl bg-[var(--msg-code-block-bg)] px-3 py-2 text-11 leading-4 text-[var(--text-tertiary)]">
            {t('rightSidebar.subagents.transcriptUnavailable')}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function ChildOverviewCard({
  child,
  onOpen,
}: {
  child: SubagentChildRun;
  onOpen: () => void;
}) {
  const { t } = useTranslation();
  const statusLabel = childStatusLabel(child, t);
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-2.5 rounded-xl border border-[var(--border-default)] px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
    >
      <SubagentAvatar source={{ id: child.identityAliases?.at(-1) ?? child.id }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-13 font-medium leading-5 text-[var(--text-primary)]">
          {subagentDisplayTitle({ id: child.identityAliases?.at(-1) ?? child.id })}
        </span>
        {child.task ? (
          <span className="mt-0.5 block line-clamp-2 text-12 leading-4 text-[var(--text-secondary)]">
            {child.task}
          </span>
        ) : null}
        <span className="mt-1 block truncate text-11 leading-4 text-[var(--text-tertiary)]">
          {statusLabel}
        </span>
      </span>
    </button>
  );
}

function ChildChip({
  label,
  selected,
  onSelect,
}: {
  label: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'h-7 shrink-0 select-none rounded-full px-3 text-11 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]',
        selected
          ? 'bg-[var(--surface-chip)] text-[var(--text-primary)]'
          : 'text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)] hover:text-[var(--text-secondary)]',
      )}
    >
      {label}
    </button>
  );
}

function TranscriptDetailView({
  detail,
  loading,
  workdir,
  allowPrivilegedLinks,
  stopping,
  transcript,
  transcriptLoading,
  transcriptIncomplete,
  readerScope,
  transcriptCursor,
  onLoadMoreTranscript,
  onBack,
  onStop,
  onControl,
}: SubagentDetailViewProps) {
  const { t } = useTranslation();
  const { preference: sendShortcutPreference } = useComposerSendShortcutPreference();
  const [controlDrafts, setControlDrafts] = useState<Record<string, string>>({});
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  const [controlBusy, setControlBusy] = useState(false);
  const [controlError, setControlError] = useState(false);
  const [processExpanded, setProcessExpanded] = useState<boolean | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const children = detail?.children ?? [];
  const hasMultipleChildren = children.length > 1;
  const nativeChildIds = useMemo(() => {
    if (detail?.children?.length) return [];
    const ids = transcript.flatMap((entry) => entry.childId ? [entry.childId] : []);
    const unique = new Set(ids);
    return [...unique];
  }, [detail?.children, transcript]);
  const selectedNativeChildId = selectedChildId && nativeChildIds.includes(selectedChildId) ? selectedChildId : null;
  // The selection survives a resume, which renames the child underneath it: the
  // id held here is the generation the user clicked, and the detail now carries
  // the next one. Resolving on the current id alone returned undefined, which
  // this component reads as "no child selected" — so a parallel run went back to
  // showing every sibling's transcript under a chip the user had picked to
  // narrow it. Match the whole identity, not the latest label.
  const resolvedChild = selectedChildId
    ? children.find((child) => (
      child.id === selectedChildId || child.identityAliases?.includes(selectedChildId) === true
    ))
    : undefined;
  // A selection that resolves to nothing at all (an id from a run that is no
  // longer listed) falls back to exactly what no selection does, rather than to
  // "unfiltered": with one child that is still that child's own conversation,
  // and with several it is the overview.
  const selectedChild = resolvedChild ?? (hasMultipleChildren ? undefined : children[0]);
  // Every id this child has ever had. A resumed generation labels the same
  // conversation with a new `childId`, so matching on the current one alone
  // filtered the child's own earlier generations back out of the transcript the
  // Host had just gone to the trouble of reading across all of them — and a
  // resumed run auto-selects that child, so it was the default view.
  const selectedChildIds = useMemo(
    () => (selectedChild
      ? new Set([selectedChild.id, ...(selectedChild.identityAliases ?? [])])
      : selectedNativeChildId ? new Set([selectedNativeChildId]) : null),
    [selectedChild, selectedNativeChildId],
  );
  const visibleTranscript = useMemo(
    () => (selectedChildIds
      ? transcript.filter((entry) => !entry.childId || selectedChildIds.has(entry.childId))
      : transcript),
    [selectedChildIds, transcript],
  );
  const conversation = useMemo(
    () => buildSubagentConversation(visibleTranscript),
    [visibleTranscript],
  );

  const readingIdentity = `${readerScope ?? detail?.parentSessionId}:${detail?.id ?? 'loading'}:${selectedChildId ?? 'all'}`;
  const reading = useSubagentReadingPosition(readingIdentity, transcript);

  if (loading && !detail) {
    return (
      <CenteredState icon={LoaderCircle} spinning label={t('rightSidebar.subagents.loading')} />
    );
  }
  if (!detail) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <HeaderBack onBack={onBack} title={t('rightSidebar.subagents.notFound')} />
      </div>
    );
  }

  const rawError = selectedChild?.error
    ?? (detail.status === 'failed' && !detail.returnedResult ? detail.summary : undefined);
  const visibleResult = selectedChild
    ? selectedChild.output ?? ''
    : detail.returnedResult ?? (detail.status === 'failed' ? '' : detail.summary ?? '');
  const displayedRunStatus = selectedChild?.status ?? detail.status;
  const selectedChildActive = !selectedChild
    || selectedChild.status === 'running'
    || selectedChild.status === 'queued';
  const selectedChildHasCompletedOutput = Boolean(selectedChild?.output?.trim());
  // The composer works like the session's: one box, one send, and the same
  // keystrokes. While running, plain send queues a follow-up and the modifier
  // send interjects (steer) — exactly the main composer's Enter / ⌘+Enter
  // split. A settled reply may not be steered over, and a finished run reads
  // any send as continuing it.
  const composerActionForIntent = (
    intent: 'queue' | 'steer',
  ): SubagentControlIntent | undefined => {
    if (detail.status !== 'running') {
      return detail.capabilities.resume ? 'resume' : undefined;
    }
    if (!detail.capabilities.steer || !selectedChildActive) return undefined;
    if (intent === 'steer' && !selectedChildHasCompletedOutput) return 'steer';
    return 'follow_up';
  };
  const defaultComposerAction = composerActionForIntent('queue');
  const steerAvailable = composerActionForIntent('steer') === 'steer';
  const controlDraftKey = selectedChild?.id ?? 'all';
  const controlMessage = controlDrafts[controlDraftKey] ?? '';
  const setControlMessage = (message: string): void => {
    setControlDrafts((current) => ({ ...current, [controlDraftKey]: message }));
  };
  const sendShortcutLabel = getComposerSendShortcutLabel(
    sendShortcutPreference,
    window.electronAPI?.platform,
  );
  const submitControl = (action: SubagentControlIntent | undefined): void => {
    const message = controlMessage.trim();
    if (!message || !action || controlBusy) return;
    setControlBusy(true);
    setControlError(false);
    void onControl(detail, action, message, selectedChild?.id).then((ok) => {
      if (ok) setControlDrafts((current) => ({ ...current, [controlDraftKey]: '' }));
      else setControlError(true);
    }).finally(() => setControlBusy(false));
  };
  const displayedStatus = selectedChild
    ? childStatusLabel(selectedChild, t)
    : t(`chat.agentTask.status.${detail.status}`);
  const selectedOutputTruncated = selectedChild?.outputTruncated ?? detail.returnedResultTruncated;
  const showStop = detail.status === 'running'
    && detail.capabilities.stop
    && selectedChildActive;

  const hasConversation = conversation.items.length > 0;
  // Whether the transcript actually carries the agent's reply — not merely
  // *some* item. A long run can hit the 50MB transcript cap, or keep its reply
  // outside the eagerly paged window, leaving only task and tool items behind.
  // Gating the durable-result fallback on "any item" then swallowed a finished
  // result that the durable record still had.
  //
  // Scoped to the *current* generation. The transcript now carries every
  // generation of this child permanently, so a reply the previous one gave
  // would otherwise go on standing in for a newest generation that has none —
  // truncated at the 50MB cap, unreadable, or simply outside the paged window.
  // That is a steady state, not a moment: the user would be left reading the
  // old answer with the new `returnedResult` nowhere on screen.
  //
  // Judged on the transcript entries rather than `conversation.items`, which
  // drop `childId` in the projection. `entry.role === 'subagent'` is exactly
  // the predicate that produces a `kind: 'subagent'` item, so the two cannot
  // disagree. An entry with no `childId` at all — a single-generation record,
  // or an older wire format — counts as current, which is what it always was
  // before aliases existed.
  const currentIds = selectedChild ? [selectedChild.id] : children.map((child) => child.id);
  const currentGenerationChildIds = new Set(currentIds);
  const hasAssistantItem = visibleTranscript.some((entry) => entry.role === 'subagent' && (!entry.childId || currentGenerationChildIds.size === 0 || currentGenerationChildIds.has(entry.childId)));
  // Old or truncated records can start mid-run. The assignment is still the
  // first thing the user needs, so it is prepended when the transcript itself
  // carries no parent line.
  const assignment = selectedChild?.task ?? detail.description ?? '';
  const showAssignmentFallback = Boolean(assignment)
    && !conversation.items.some((item) => item.kind === 'parent');
  // Same criterion as the fallback below, so "a reply is on screen" and "we
  // rendered one" cannot disagree: previously this counted a `visibleResult`
  // that the suppressed fallback never drew, so neither the result nor the
  // missing-reply notice appeared.
  /**
   * Is what we are looking at the *end* of this generation's transcript?
   *
   * Two ways it is not. The runner stops appending the moment the record hits
   * its byte cap and writes a `transcript-truncated` marker — so truncation
   * always loses the *tail*, which is exactly where the newest reply is. And the
   * renderer pages head-first with a page bound, so a long transcript can stop
   * short with `transcriptCursor` still set.
   */
  const currentGenerationTruncated = conversation.system.some((entry) => entry.systemEvent?.kind === 'transcript-truncated' && (!entry.childId || currentGenerationChildIds.size === 0 || currentGenerationChildIds.has(entry.childId)));
  const transcriptTailComplete = transcriptCursor === null && !currentGenerationTruncated && !transcriptIncomplete;
  // An assistant item is only proof that *this* generation replied — not that we
  // are looking at its latest reply. A follow-up produces another `message_end`,
  // and the runner overwrites `task.output` each time, so the durable result is
  // always the newest one while the transcript may still be showing an earlier
  // one. With the tail missing, "some assistant line exists" and "the newest
  // reply is on screen" come apart, and suppressing on the first was how the
  // user ended up reading a stale answer with the current one nowhere.
  //
  // When the tail is complete this is exactly the previous condition. When it is
  // not, the result is shown even at the cost of repeating a reply that happens
  // to already be visible: seeing the newest answer twice is a far smaller
  // failure than not seeing it at all.
  const showDurableResultFallback =
    (!hasAssistantItem || !transcriptTailComplete) && Boolean(visibleResult);
  const hasAssistantReply = hasAssistantItem || showDurableResultFallback;
  // A parallel run stays `running` until its last child settles, so the run
  // status alone would keep a waiting spinner under a child that already
  // finished — contradicting that child's own terminal label and its disabled
  // composer on the same screen. When a child is selected the wait belongs to
  // that child; `selectedChildActive` is already true with no child selected,
  // so the overview and single-child aggregate keep their existing behaviour.
  const activeNoticeKey = selectedChild?.awaitingApproval
    ? 'awaitingApprovalDetail'
    : selectedChild?.status === 'queued'
      ? 'queuedDetail'
      : detail.status === 'running' && selectedChildActive
        ? 'waitingForReply'
        : null;
  const actionBarItemId = detail.status === 'running'
    ? null
    : lastAssistantItemId(conversation.items);
  const settled = displayedRunStatus !== 'running' && displayedRunStatus !== 'queued';
  const processOpen = processExpanded ?? !settled;
  const finalId = settled && !showDurableResultFallback ? lastAssistantItemId(conversation.items) : null;
  const finalItems = conversation.items.filter((item) => item.id === finalId);
  const processItems = conversation.items.filter((item) => item.id !== finalId);
  const durationMs = detail.usage?.durationMs ?? ((detail.endedAt ?? detail.updatedAt) - detail.startedAt);
  const duration = formatDuration(durationMs);
  const processLabel = settled && duration ? t('rightSidebar.subagents.elapsed', { duration }) : displayedStatus;
  const titleSource = hasMultipleChildren && selectedChild
    ? { id: selectedChild.identityAliases?.at(-1) ?? selectedChild.id }
    : selectedNativeChildId ? { id: selectedNativeChildId } : detail;
  const selectedTitle = subagentDisplayTitle(titleSource);

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-subagent-detail-mode={detail.provider === 'pi' ? 'pi-durable' : 'native-transcript'}>
      <HeaderBack
        onBack={onBack}
        title={selectedTitle}
        source={titleSource}
        action={showStop ? (
          <Tip text={t('chat.agentTask.stop')} side="bottom">
            <button
              type="button"
              onClick={() => onStop(detail, selectedChild?.id)}
              disabled={stopping}
              aria-label={t('chat.agentTask.stop')}
              data-subagent-stop="true"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
            >
              <Square size={12} aria-hidden="true" />
            </button>
          </Tip>
        ) : undefined}
      />
      <div ref={reading.scrollRef} onScroll={reading.onScroll} className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-6">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5">
          {hasMultipleChildren ? (
            <div
              className="flex max-w-full gap-1 overflow-x-auto"
              role="group"
              aria-label={t('rightSidebar.subagents.children')}
            >
              <ChildChip
                label={t('rightSidebar.subagents.overview')}
                selected={!selectedChild}
                onSelect={() => setSelectedChildId(null)}
              />
              {children.map((child) => (
                <ChildChip
                  key={child.id}
                  label={subagentDisplayTitle({ id: child.identityAliases?.at(-1) ?? child.id })}
                  selected={selectedChild?.id === child.id}
                  onSelect={() => setSelectedChildId(child.id)}
                />
              ))}
            </div>
          ) : null}

          {hasMultipleChildren && !selectedChild ? (
            <section aria-label={t('rightSidebar.subagents.children')}>
              <SectionTitle>{t('rightSidebar.subagents.children')}</SectionTitle>
              <div className="grid gap-2">
                {children.map((child) => (
                  <ChildOverviewCard
                    key={child.id}
                    child={child}
                    onOpen={() => setSelectedChildId(child.id)}
                  />
                ))}
              </div>
            </section>
          ) : null}

          {nativeChildIds.length > 1 && <div className="flex flex-wrap gap-2" aria-label={t('rightSidebar.subagents.children')}>
            <ChildChip label={t('rightSidebar.subagents.overview')} selected={!selectedNativeChildId} onSelect={() => setSelectedChildId(null)} />
            {nativeChildIds.map((id) => <ChildChip key={id} label={subagentDisplayTitle({ id })} selected={selectedNativeChildId === id} onSelect={() => setSelectedChildId(id)} />)}
          </div>}
          <div>
            <button type="button" aria-expanded={processOpen} onClick={() => setProcessExpanded(!processOpen)} data-subagent-process-toggle="true"
              className="flex min-h-8 items-center gap-1 rounded-full text-13 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
              {processLabel}<ChevronRight size={13} className={processOpen ? 'rotate-90' : undefined} aria-hidden="true" />
            </button>
            <div hidden={!processOpen} className="mt-3 space-y-4" data-subagent-process="true">
          {showAssignmentFallback && !selectedNativeChildId ? (
            <UserMessage
              workingDir={workdir}
              allowPrivilegedLinks={allowPrivilegedLinks}
              content={assignment}
              createdAt={new Date(detail.startedAt).toISOString()}
            />
          ) : null}

          {hasConversation ? (
            <ConversationStream
              items={processItems}
              provider={detail.provider}
              workdir={workdir}
              allowPrivilegedLinks={allowPrivilegedLinks}
              actionBarItemId={actionBarItemId}
            />
          ) : null}

            </div>
          </div>
          {finalItems.length > 0 && <ConversationStream items={finalItems} provider={detail.provider} workdir={workdir} allowPrivilegedLinks={allowPrivilegedLinks} actionBarItemId={actionBarItemId} />}
          {/* The durable result, only when the transcript did not already carry
              the reply — a complete transcript ending in that result must not
              render it a second time. */}
          {showDurableResultFallback && !selectedNativeChildId ? (
            <AssistantMessage
              workingDir={workdir}
              allowPrivilegedLinks={allowPrivilegedLinks}
              content={visibleResult}
              createdAt={new Date(detail.updatedAt).toISOString()}
              agentKind={detail.provider === 'claude-code' ? 'cc' : detail.provider}
              showActionBar
            />
          ) : null}

          {activeNoticeKey ? (
            <div className="flex items-center gap-2 text-13 text-[var(--text-tertiary)]">
              <Spinner icon={LoaderCircle} spinning size={14} />
              {t(`rightSidebar.subagents.${activeNoticeKey}`)}
            </div>
          ) : !hasAssistantReply && !rawError ? (
            <div className="flex items-start gap-2 text-13 leading-5 text-[var(--error-fg)]">
              <AlertCircle size={15} className="mt-0.5 shrink-0" aria-hidden="true" />
              {t(displayedRunStatus === 'failed'
                ? 'rightSidebar.subagents.failedNoReply'
                : displayedRunStatus === 'stopped'
                  ? 'rightSidebar.subagents.stoppedNoReply'
                  : 'rightSidebar.subagents.completedNoReply')}
            </div>
          ) : null}

          {rawError ? <SubagentErrorNotice rawError={rawError} /> : null}

          {selectedOutputTruncated ? (
            <p className="text-11 text-[var(--text-tertiary)]">
              {t('rightSidebar.subagents.resultTruncated')}
            </p>
          ) : null}

          {settled && visibleResult && !selectedNativeChildId && <div>
            <button type="button" className="rounded-full px-2 py-1 text-12 text-[var(--text-tertiary)] hover:bg-[var(--surface-hover)]" onClick={() => {
              const text = `${selectedTitle}\n\n${visibleResult}`;
              const input = { targetSessionId: detail.parentSessionId, text };
              const inserted = insertPromptIntoComposer(input);
              setActionNotice(inserted ? 'quoted' : 'quoteUnavailable');
            }}>{t('rightSidebar.subagents.quoteResult')}</button>
            {actionNotice && <p role="status" className="text-12 text-[var(--text-secondary)]">{t(`rightSidebar.subagents.${actionNotice}`)}</p>}
          </div>}
          {transcriptIncomplete && <p role="status" className="text-12 text-[var(--text-tertiary)]">{t('rightSidebar.subagents.partialRecord')}</p>}
          {transcriptCursor && <button type="button" disabled={transcriptLoading} onClick={onLoadMoreTranscript} className="h-8 rounded-full border border-[var(--border-default)] px-3 text-12 hover:bg-[var(--surface-hover)]">{t('rightSidebar.subagents.loadMoreTranscript')}</button>}
        </div>
      </div>
      {reading.hasNewContent && <button type="button" onClick={reading.jumpToLatest} className="mx-auto my-2 h-8 shrink-0 rounded-full border border-[var(--border-default)] px-3 text-12 text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]">{t('rightSidebar.subagents.newContent')}</button>}

      {defaultComposerAction ? (
        <div className="shrink-0 border-t border-[var(--border-default)] p-3">
          <div className="mx-auto flex max-w-[720px] flex-col gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--surface-elevated)] p-2">
            <p className="px-2 text-11 text-[var(--text-tertiary)]">{t('rightSidebar.subagents.sendTo', { name: selectedTitle })}</p>
            <div className="flex items-end gap-2">
              <textarea
                value={controlMessage}
                onChange={(event) => setControlMessage(event.target.value)}
                onKeyDown={(event) => {
                  const intent = resolveComposerEnterIntent(
                    event.nativeEvent,
                    sendShortcutPreference,
                    {
                      turnRunning: detail.status === 'running',
                      platform: window.electronAPI?.platform,
                    },
                  );
                  if (intent === 'native' || intent === null) return;
                  event.preventDefault();
                  if (intent === 'ignore') return;
                  submitControl(composerActionForIntent(intent));
                }}
                disabled={controlBusy}
                maxLength={32_000}
                rows={2}
                placeholder={steerAvailable && sendShortcutPreference === 'enter'
                  ? t('rightSidebar.subagents.composerPlaceholders.runningWithSteer', {
                      steerShortcut: getComposerModifierShortcutLabel(window.electronAPI?.platform),
                    })
                  : t(`rightSidebar.subagents.composerPlaceholders.${defaultComposerAction}`)}
                aria-label={t('rightSidebar.subagents.sendDirection')}
                title={t('rightSidebar.subagents.sendShortcutHint', { shortcut: sendShortcutLabel })}
                className="min-h-10 min-w-0 flex-1 resize-none rounded-lg bg-transparent px-2 py-1.5 text-13 leading-5 text-[var(--text-primary)] placeholder:text-[var(--text-placeholder)] focus-visible:outline-none disabled:cursor-wait disabled:opacity-60"
              />
              <Tip text={t(`rightSidebar.subagents.controlActions.${defaultComposerAction}`)} side="top">
                <button
                  type="button"
                  disabled={controlBusy || !controlMessage.trim()}
                  onClick={() => submitControl(defaultComposerAction)}
                  aria-label={t(`rightSidebar.subagents.controlActions.${defaultComposerAction}`)}
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--surface-chip)] text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
                >
                  {controlBusy ? (
                    <Spinner icon={LoaderCircle} spinning size={14} />
                  ) : (
                    <SendHorizontal size={14} aria-hidden="true" />
                  )}
                </button>
              </Tip>
            </div>
            {controlError ? (
              <p role="alert" className="px-2 text-11 text-[var(--error-fg)]">
                {t('rightSidebar.subagents.controlFailed')}
              </p>
            ) : null}
          </div>
        </div>
      ) : detail.status === 'running' && selectedChild && !selectedChildActive ? (
        <div className="shrink-0 border-t border-[var(--border-default)] px-4 py-3 text-12 text-[var(--text-tertiary)]">
          {t('rightSidebar.subagents.childEndedControlHint')}
        </div>
      ) : null}
    </div>
  );
}

export function DetailView(props: SubagentDetailViewProps) {
  const hasTranscript = props.detail?.capabilities.viewFullTranscript;
  return hasTranscript
    ? <TranscriptDetailView key={props.detail?.id} {...props} />
    : <LegacyDetailView {...props} />;
}
