import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { useEffect, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useTranslation } from 'react-i18next';
import { FolderInput, Pin, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tip } from '@/components/ui/tooltip';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { Session } from '@/lib/ccAgent.types';
import type { SessionClickHandler } from './SessionItem';
import { useTaskFolders, taskFolderProject, loadTaskFolders } from './taskFoldersStore';
import { openTaskFolderDialog, revealTaskFolder, useTaskFolderDialog } from './taskFolderActions';
import { MENU_ITEM_CLASS } from './menuStyles';

export function TaskFolderMoveItem({ session }: { session: Session }) {
  const { t } = useTranslation();
  const projectKey = taskFolderProject(session);
  if (!projectKey) return null;
  const open = () => {
    const request = { kind: 'move' as const, projectKey, sessionIds: [session.id] };
    openTaskFolderDialog(request);
  };
  return (
    <DropdownMenuItem onSelect={open} className={MENU_ITEM_CLASS}>
      {t('ccAgent.sidebar.taskFolders.move')}
    </DropdownMenuItem>
  );
}

export function TaskFolderBulkMove({ sessions }: { sessions: Session[] }) {
  const { t } = useTranslation();
  const projectKey = sessions[0] ? taskFolderProject(sessions[0]) : null;
  const enabled =
    projectKey && sessions.every((session) => taskFolderProject(session) === projectKey);
  const open = () => {
    if (!enabled || !projectKey) return;
    const sessionIds = sessions.map((session) => session.id);
    const request = { kind: 'move' as const, projectKey, sessionIds };
    openTaskFolderDialog(request);
  };
  const label = t(`ccAgent.sidebar.taskFolders.${enabled ? 'move' : 'sameProject'}`);
  return (
    <Tip text={label}>
      <button
        type="button"
        onClick={open}
        disabled={!enabled}
        aria-label={label}
        className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-sidebar-item-hover disabled:opacity-40"
      >
        <FolderInput size={14} />
      </button>
    </Tip>
  );
}

interface Props {
  sessions: Session[];
  onSessionClick: SessionClickHandler;
  attentionIds: ReadonlySet<string>;
  runningIds: ReadonlySet<string>;
}

export function TaskFolderDialogs({ sessions, onSessionClick, attentionIds, runningIds }: Props) {
  const request = useTaskFolderDialog();
  const { confirm } = useConfirmDialog();
  const folders = useTaskFolders();
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState(false);
  const [createMode, setCreateMode] = useState(false);
  const [limit, setLimit] = useState(100);
  const [attentionOnly, setAttentionOnly] = useState(false);
  useEffect(() => {
    setName(request?.name ?? '');
    setQuery('');
    setSelected(new Set());
    setCreateMode(false);
    setLimit(100);
    setAttentionOnly(request?.attentionOnly ?? false);
  }, [request]);
  useEffect(() => {
    openTaskFolderDialog(null);
  }, [folders.ownerId]);
  if (!request) return null;
  const close = () => {
    if (!pending) openTaskFolderDialog(null);
  };
  const projectFolders = folders.folders.filter(
    (folder) => folder.projectKey === request.projectKey,
  );
  const folderName =
    projectFolders.find((folder) => folder.id === request.folderId)?.name ??
    t('ccAgent.sidebar.taskFolders.inbox');
  const isBrowser = request.kind === 'browse';
  const isFolderBrowser = request.kind === 'folders';
  const isName = request.kind === 'create' || request.kind === 'rename' || createMode;
  const title = isFolderBrowser
    ? request.projectName
    : isBrowser
      ? `${request.projectName ?? ''} / ${folderName}`
      : t(
          `ccAgent.sidebar.taskFolders.${isName ? (request.kind === 'rename' ? 'rename' : 'create') : 'move'}`,
        );
  const matching = sessions.filter((session) => {
    const projectKey = taskFolderProject(session);
    if (projectKey !== request.projectKey || session.status === 'deleted') return false;
    if (folders.folderFor(session) !== (request.folderId ?? null)) return false;
    if (attentionOnly && !attentionIds.has(session.id) && !runningIds.has(session.id)) return false;
    const title = session.title ?? '';
    const needle = query.toLocaleLowerCase();
    return title.toLocaleLowerCase().includes(needle);
  });
  const rows = matching.slice(0, limit);
  const submitName = async () => {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    const command =
      request.kind === 'rename'
        ? { action: 'rename' as const, folderId: request.folderId!, name: trimmed }
        : {
            action: 'create' as const,
            projectKey: request.projectKey,
            name: trimmed,
            sessionIds: request.sessionIds,
          };
    const result =
      command.action === 'create' && command.sessionIds?.length
        ? await folders.move(command)
        : await folders.run(command);
    setPending(false);
    if (result) openTaskFolderDialog(null);
  };
  const moveTo = async (folderId: string | null) => {
    if (pending || !request.sessionIds?.length) return;
    setPending(true);
    const command = {
      action: 'move' as const,
      projectKey: request.projectKey,
      folderId,
      sessionIds: request.sessionIds,
    };
    const moved = await folders.move(command);
    setPending(false);
    if (moved) openTaskFolderDialog(null);
  };
  const moveSelection = () => {
    const sessionIds = Array.from(selected);
    const next = { kind: 'move' as const, projectKey: request.projectKey, sessionIds };
    openTaskFolderDialog(next);
  };
  const selectAll = () => {
    const ids = matching.map((session) => session.id);
    const next = selected.size === matching.length ? new Set<string>() : new Set(ids);
    setSelected(next);
  };
  return (
    <Dialog.Root open onOpenChange={close}>
      <Dialog.Portal>
        <Dialog.Overlay className="modal-scrim fixed inset-0 z-50" />
        <Dialog.Content onPointerDownOutside={(event) => event.preventDefault()} className="modal-panel fixed left-1/2 top-1/2 z-50 flex max-h-[80vh] w-[min(640px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 p-4 text-[var(--text-primary)]">
          <div className="flex items-center gap-3">
            <Dialog.Title className="min-w-0 flex-1 truncate text-base font-medium">
              {title}
            </Dialog.Title>
            <Tip text={t('ccAgent.sidebar.taskFolders.close')}>
              <button
                type="button"
                onClick={close}
                disabled={pending}
                aria-label={t('ccAgent.sidebar.taskFolders.close')}
                className="flex size-8 items-center justify-center rounded-full hover:bg-sidebar-item-hover"
              >
                <X size={16} />
              </button>
            </Tip>
          </div>
          <Dialog.Description className="text-sm text-[var(--text-secondary)]">
            {t(`ccAgent.sidebar.taskFolders.${isBrowser ? 'browseHint' : 'description'}`)}
          </Dialog.Description>
          {!folders.ready && (
            <Button variant="secondary" onClick={() => void loadTaskFolders()}>
              {t('ccAgent.sidebar.taskFolders.reload')}
            </Button>
          )}
          {isName ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submitName();
              }}
              className="flex flex-col gap-3"
            >
              <Input
                autoFocus
                value={name}
                maxLength={80}
                onChange={setName}
                aria-label={t('ccAgent.sidebar.taskFolders.name')}
                placeholder={t('ccAgent.sidebar.taskFolders.name')}
                disabled={pending}
              />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={close}>
                  {t('ccAgent.sidebar.taskFolders.cancel')}
                </Button>
                <Button type="submit" disabled={!folders.ready || !name.trim()} loading={pending}>
                  {t('ccAgent.sidebar.taskFolders.save')}
                </Button>
              </div>
            </form>
          ) : isFolderBrowser ? (
            <div className="flex min-h-0 flex-col gap-2 overflow-y-auto">
              <Input
                value={query}
                onChange={setQuery}
                aria-label={t('ccAgent.sidebar.taskFolders.name')}
                placeholder={t('ccAgent.sidebar.taskFolders.name')}
              />
              {projectFolders
                .filter((folder) =>
                  folder.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
                )
                .map((folder) => {
                  const open = () => {
                    const next = {
                      kind: 'browse' as const,
                      projectKey: request.projectKey,
                      projectName: request.projectName,
                      folderId: folder.id,
                    };
                    openTaskFolderDialog(next);
                  };
                  const rename = () => {
                    const next = {
                      kind: 'rename' as const,
                      projectKey: request.projectKey,
                      folderId: folder.id,
                      name: folder.name,
                    };
                    openTaskFolderDialog(next);
                  };
                  const remove = async () => {
                    const options = {
                      title: t('ccAgent.sidebar.taskFolders.delete'),
                      description: t('ccAgent.sidebar.taskFolders.deleteDescription', {
                        name: folder.name,
                      }),
                      confirmText: t('ccAgent.sidebar.taskFolders.delete'),
                      cancelText: t('ccAgent.sidebar.taskFolders.cancel'),
                    };
                    const accepted = await confirm(options);
                    if (!accepted) return;
                    const command = { action: 'delete' as const, folderId: folder.id };
                    setPending(true);
                    await folders.run(command);
                    setPending(false);
                  };
                  const index = projectFolders.indexOf(folder);
                  const shift = async (offset: number) => {
                    const ids = projectFolders.map((item) => item.id);
                    const other = index + offset;
                    [ids[index], ids[other]] = [ids[other], ids[index]];
                    const command = {
                      action: 'reorder' as const,
                      projectKey: request.projectKey,
                      folderIds: ids,
                    };
                    setPending(true);
                    await folders.run(command);
                    setPending(false);
                  };
                  return (
                    <div key={folder.id} className="flex items-center gap-2">
                      <Button
                        variant="secondary"
                        className="min-w-0 flex-1 truncate"
                        onClick={open}
                      >
                        {folder.name}
                      </Button>
                      <Button variant="secondary" onClick={rename}>
                        {t('ccAgent.sidebar.taskFolders.rename')}
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={pending}
                        onClick={() => void remove()}
                        aria-label={t('ccAgent.sidebar.taskFolders.delete')}
                      >
                        <Trash2 size={14} />
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={pending || index === 0}
                        onClick={() => void shift(-1)}
                        aria-label={t('ccAgent.sidebar.taskFolders.moveUp')}
                      >
                        ↑
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={pending || index === projectFolders.length - 1}
                        onClick={() => void shift(1)}
                        aria-label={t('ccAgent.sidebar.taskFolders.moveDown')}
                      >
                        ↓
                      </Button>
                    </div>
                  );
                })}
            </div>
          ) : isBrowser ? (
            <>
              <Input
                value={query}
                onChange={(value) => {
                  setQuery(value);
                  setLimit(100);
                  const empty = new Set<string>();
                  setSelected(empty);
                }}
                aria-label={t('ccAgent.sidebar.taskFolders.search')}
                placeholder={t('ccAgent.sidebar.taskFolders.search')}
              />
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={selectAll}>
                  {t('ccAgent.sidebar.taskFolders.selectAll')}
                </Button>
                <Button disabled={!selected.size} onClick={moveSelection}>
                  {t('ccAgent.sidebar.taskFolders.moveCount', { count: selected.size })}
                </Button>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={attentionOnly}
                    onChange={(event) => {
                      setAttentionOnly(event.target.checked);
                      setSelected(new Set());
                    }}
                  />
                  {t('ccAgent.sidebar.taskFolders.attentionOnly')}
                </label>
              </div>
              <div className="min-h-0 overflow-y-auto">
                {rows.map((session) => {
                  const toggle = () => {
                    const next = new Set(selected);
                    if (next.has(session.id)) next.delete(session.id);
                    else next.add(session.id);
                    setSelected(next);
                  };
                  const open = () => {
                    close();
                    revealTaskFolder(session.id);
                    onSessionClick(session.id);
                  };
                  return (
                    <div
                      key={session.id}
                      className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-sidebar-item-hover"
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(session.id)}
                        onChange={toggle}
                        aria-label={session.title ?? session.id}
                      />
                      <button
                        type="button"
                        onClick={open}
                        className="min-w-0 flex-1 py-2 text-left"
                      >
                        <span className="block truncate text-sm">
                          {session.title || t('ccAgent.sidebar.taskFolders.untitled')}
                        </span>
                        <span className="text-xs text-[var(--text-secondary)]">
                          {session.status === 'archived'
                            ? t('ccAgent.sidebar.taskFolders.archived')
                            : attentionIds.has(session.id)
                              ? t('ccAgent.sidebar.taskFolders.attention')
                              : runningIds.has(session.id)
                                ? t('ccAgent.sidebar.taskFolders.running')
                                : ''}
                        </span>
                      </button>
                      {session.pinnedAt && (
                        <Pin size={14} aria-label={t('ccAgent.sidebar.taskFolders.pinned')} />
                      )}
                    </div>
                  );
                })}
                {!rows.length && (
                  <p className="p-3 text-sm text-[var(--text-secondary)]">
                    {t('ccAgent.sidebar.taskFolders.empty')}
                  </p>
                )}
                {matching.length > limit && (
                  <Button variant="secondary" onClick={() => setLimit(limit + 100)}>
                    {t('ccAgent.sidebar.taskFolders.more')}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <div className="flex min-h-0 flex-col gap-1 overflow-y-auto">
              <Button
                variant="secondary"
                disabled={pending || !folders.ready}
                onClick={() => void moveTo(null)}
              >
                {t('ccAgent.sidebar.taskFolders.inbox')}
              </Button>
              {projectFolders.map((folder) => (
                <Button
                  key={folder.id}
                  variant="secondary"
                  disabled={pending || !folders.ready}
                  onClick={() => void moveTo(folder.id)}
                >
                  {folder.name}
                </Button>
              ))}
              <Button disabled={pending || !folders.ready} onClick={() => setCreateMode(true)}>
                {t('ccAgent.sidebar.taskFolders.createAndMove')}
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
