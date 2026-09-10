import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { SubagentRun } from '@cindy/maker-shared/subagent-workspace';

import { SubagentAvatar } from '@/components/chat/SubagentAvatar';
import { Tip } from '@/components/ui/tooltip';
import { formatRelativeTimestamp, runTitle } from './subagentFormat';

function RunRow({ run, onOpen }: { run: SubagentRun; onOpen: (run: SubagentRun) => void }) {
  const { t, i18n } = useTranslation();
  const title = runTitle(run, t('rightSidebar.subagents.untitled'));
  const statusLabel = t(`chat.agentTask.status.${run.status}`);
  const relative = formatRelativeTimestamp(run.updatedAt, i18n?.language);
  return <Tip text={title}><button type="button" onClick={() => onOpen(run)} data-subagent-run-row={run.id}
    className="flex min-h-11 w-full items-center gap-2.5 rounded-full px-2 py-2 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
    <SubagentAvatar source={run} size={20} />
    <span className="min-w-0 flex-1 truncate text-13 text-[var(--text-primary)]">{title}</span>
    <span className="shrink-0 text-11 text-[var(--text-tertiary)]" aria-label={statusLabel}>
      {run.status === 'running' || run.status === 'failed' || run.status === 'stopped' ? statusLabel : relative ?? statusLabel}
    </span>
  </button></Tip>;
}

function GroupTitle({ label }: { label: string }) {
  return (
    <div className="select-none px-3 pb-1 pt-2 text-12 text-[var(--text-tertiary)]">
      {label}
    </div>
  );
}

interface RunListProps {
  runs: readonly SubagentRun[];
  nextCursor: string | null;
  loadingMore: boolean;
  onOpen: (run: SubagentRun) => void;
  onLoadMore: () => void;
}

export function RunList({ runs, nextCursor, loadingMore, onOpen, onLoadMore }: RunListProps) {
  const { t } = useTranslation();
  const grouped = useMemo(
    () => ({
      running: runs.filter((run) => run.status === 'running'),
      finished: runs.filter((run) => run.status !== 'running'),
    }),
    [runs],
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {(
          <section>
            <GroupTitle label={`${t('rightSidebar.subagents.running')} · ${grouped.running.length}`} />
            {!grouped.running.length && <p className="px-3 py-2 text-12 text-[var(--text-tertiary)]">{t('rightSidebar.subagents.noRunning')}</p>}
            <div className="flex flex-col gap-0.5">
              {grouped.running.map((run) => (
                <RunRow key={run.id} run={run} onOpen={onOpen} />
              ))}
            </div>
          </section>
        )}
        {grouped.finished.length > 0 ? (
          <section className={grouped.running.length > 0 ? 'mt-2' : undefined}>
            <GroupTitle label={`${t('rightSidebar.subagents.finished')} · ${grouped.finished.length}`} />
            <div className="flex flex-col gap-0.5">
              {grouped.finished.map((run) => (
                <RunRow key={run.id} run={run} onOpen={onOpen} />
              ))}
            </div>
          </section>
        ) : null}
        {nextCursor ? (
          <button
            type="button"
            disabled={loadingMore}
            onClick={onLoadMore}
            className="mx-3 mt-3 flex h-8 items-center justify-center rounded-full border border-[var(--border-default)] px-3 text-12 text-[var(--text-secondary)] transition-colors hover:bg-[var(--surface-hover)] disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
          >
            {loadingMore
              ? t('rightSidebar.subagents.loading')
              : t('rightSidebar.subagents.loadEarlier')}
          </button>
        ) : null}
      </div>
    </div>
  );
}
