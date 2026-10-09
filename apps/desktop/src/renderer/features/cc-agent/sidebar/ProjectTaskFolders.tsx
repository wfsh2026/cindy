import { useEffect, useRef, useState, type DragEvent } from 'react';
import {
  ChevronDown,
  ChevronRight,
  EllipsisVertical,
  Folder,
  FolderOpen,
  Plus,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tip } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useConfirmDialog } from '@/components/ui/confirm-dialog-provider';
import { patchDraft } from '@/state/newMakerDraft';
import { cn } from '@/lib/utils';
import { SessionEntryList, type SessionEntryListProps } from './SessionEntryList';
import { folderProjectKey, taskFolderProject, useTaskFolders } from './taskFoldersStore';
import {
  dismissTaskFolderReveal,
  openTaskFolderDialog,
  useTaskFolderReveal,
} from './taskFolderActions';
import { useTaskFolderCatalogue } from './taskFolderCatalogue';
import { useSessionAttentionKinds } from '@/lib/sessionAttentionStore';
import { useSessionAttentionUrgencySet } from '../contexts/SessionAttentionUrgencyContext';
import { aggregateSessionLamps } from '../lib/sessionLampAggregation';
import { SidebarRightStatusIndicator } from './SidebarRightStatusIndicator';
import { SPLIT_GROUP_SESSION_MIME } from '../splitGroupDnd';
import { MENU_ITEM_CLASS } from './menuStyles';
import type { ProjectNode } from '../lib/projectGrouping';

const FOLDER_MIME = 'application/x-cindy-task-folder';
interface Props {
  project: ProjectNode;
  listProps: SessionEntryListProps;
  creating: boolean;
  onCreatingChange: (value: boolean) => void;
  onCreateInProject: (project: ProjectNode) => void;
  statusFilter: 'active' | 'archived' | 'all';
}

function readExpanded(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(key);
    const value = raw ? JSON.parse(raw) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return value;
  } catch {
    return {};
  }
}

export function ProjectTaskFolders({
  project,
  listProps,
  creating,
  onCreatingChange,
  onCreateInProject,
  statusFilter,
}: Props) {
  const folders = useTaskFolders();
  const catalogue = useTaskFolderCatalogue();
  const reveal = useTaskFolderReveal();
  const attentionKinds = useSessionAttentionKinds();
  const urgentSessionIds = useSessionAttentionUrgencySet();
  const { t } = useTranslation();
  const { confirm } = useConfirmDialog();
  const projectKey = folderProjectKey(project.projectKey);
  const preferenceKey = `sidebar.taskFolders.expanded:${folders.ownerId}:${projectKey}`;
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() =>
    readExpanded(preferenceKey),
  );
  const [temporary, setTemporary] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [over, setOver] = useState<string | null>(null);
  const [dropPosition, setDropPosition] = useState<'before' | 'after' | null>(null);
  const lastActive = useRef<string | undefined>(undefined);
  const lastReveal = useRef(0);
  useEffect(() => {
    const next = readExpanded(preferenceKey);
    setExpanded(next);
    setTemporary(null);
  }, [preferenceKey]);
  const projectFolders = folders.folders.filter((folder) => folder.projectKey === projectKey);
  const ordinary = listProps.sessions.filter((session) => taskFolderProject(session) !== null);
  const special = listProps.sessions.filter((session) => taskFolderProject(session) === null);
  const allProjectSessions = catalogue.filter(
    (session) =>
      taskFolderProject(session) === projectKey &&
      (statusFilter === 'all' ? session.status !== 'deleted' : session.status === statusFilter),
  );
  useEffect(() => {
    if (!folders.ready) return;
    const explicitlyRevealed =
      reveal !== null &&
      reveal.sessionId === listProps.activeSessionId &&
      reveal.sequence !== lastReveal.current;
    if (lastActive.current === listProps.activeSessionId && !explicitlyRevealed) return;
    const changed =
      lastActive.current !== undefined && lastActive.current !== listProps.activeSessionId;
    lastActive.current = listProps.activeSessionId;
    lastReveal.current = reveal?.sequence ?? 0;
    if (!changed && !explicitlyRevealed) return;
    const active = ordinary.find((session) => session.id === listProps.activeSessionId);
    const folderId = active ? (folders.folderFor(active) ?? 'inbox') : null;
    setTemporary(folderId);
  }, [listProps.activeSessionId, ordinary, folders, reveal]);
  const toggle = (id: string) => {
    if (temporary === id) dismissTaskFolderReveal();
    const next = { ...expanded, [id]: !(expanded[id] || temporary === id) };
    setExpanded(next);
    setTemporary(null);
    try {
      const serialized = JSON.stringify(next);
      localStorage.setItem(preferenceKey, serialized);
    } catch {
      /* Retain the in-window preference. */
    }
  };
  const create = async () => {
    const trimmed = name.trim();
    if (!trimmed || pending) return;
    setPending(true);
    const command = { action: 'create' as const, projectKey, name: trimmed };
    const result = await folders.run(command);
    setPending(false);
    if (!result) return;
    const created = result.folders.find(
      (folder) => folder.projectKey === projectKey && folder.name === trimmed,
    );
    if (created) {
      const next = { ...expanded, [created.id]: true };
      setExpanded(next);
      try {
        const serialized = JSON.stringify(next);
        localStorage.setItem(preferenceKey, serialized);
      } catch {
        /* View-only preference. */
      }
    }
    setName('');
    onCreatingChange(false);
  };
  if (project.deviceLinkDeviceId || (!projectFolders.length && !creating))
    return <SessionEntryList {...listProps} />;
  const nodes = [{ id: 'inbox', name: t('ccAgent.sidebar.taskFolders.inbox') }, ...projectFolders];
  const visibleNodes = nodes.slice(0, 11);
  if (temporary && !visibleNodes.some((item) => item.id === temporary)) {
    const node = nodes.find((item) => item.id === temporary);
    if (node) visibleNodes.push(node);
  }
  const currentNode = ordinary.find((session) => session.id === listProps.activeSessionId);
  const activeFolder = currentNode ? (folders.folderFor(currentNode) ?? 'inbox') : null;
  const browseFolders = () => {
    const request = { kind: 'folders' as const, projectKey, projectName: project.displayName };
    openTaskFolderDialog(request);
  };
  const createForm = creating && (
    <form
      className="flex flex-col gap-1 px-2 py-1"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <Input
        autoFocus
        size="sm"
        maxLength={80}
        value={name}
        onChange={setName}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onCreatingChange(false);
          }
        }}
        aria-label={t('ccAgent.sidebar.taskFolders.name')}
        placeholder={t('ccAgent.sidebar.taskFolders.name')}
        disabled={pending}
      />
      <div className="flex justify-end gap-1">
        <Button type="submit" disabled={!name.trim() || !folders.ready} loading={pending}>
          {t('ccAgent.sidebar.taskFolders.save')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={pending}
          onClick={() => onCreatingChange(false)}
        >
          {t('ccAgent.sidebar.taskFolders.cancel')}
        </Button>
      </div>
    </form>
  );
  return (
    <div className="flex flex-col gap-0.5" data-no-drag>
      {createForm}
      {visibleNodes.map((node) => {
        const folderId = node.id === 'inbox' ? null : node.id;
        const sessions = ordinary.filter((session) => folders.folderFor(session) === folderId);
        const countedSessions = allProjectSessions.filter(
          (session) => folders.folderFor(session) === folderId,
        );
        const open = expanded[node.id] || temporary === node.id;
        const lampContext = {
          runningSessionIds: listProps.runningSessionIds,
          notifications: listProps.notifications,
          attentionKinds,
          urgentSessionIds,
        };
        const lamp = aggregateSessionLamps(countedSessions, lampContext);
        const status = lamp.dotTone ?? (lamp.running ? 'running' : null);
        const visible = sessions.slice(0, 5);
        const active = sessions.find((session) => session.id === listProps.activeSessionId);
        if (active && !visible.includes(active)) visible[visible.length - 1] = active;
        const browse = (attentionOnly = false) => {
          const request = {
            kind: 'browse' as const,
            projectKey,
            projectName: project.displayName,
            folderId,
            attentionOnly,
          };
          openTaskFolderDialog(request);
        };
        const createTask = () => {
          onCreateInProject(project);
          const patch = { taskFolder: folderId ? { projectKey, folderId } : null };
          patchDraft(patch);
        };
        const rename = () => {
          const request = { kind: 'rename' as const, projectKey, folderId, name: node.name };
          openTaskFolderDialog(request);
        };
        const remove = async () => {
          const options = {
            title: t('ccAgent.sidebar.taskFolders.delete'),
            description: t('ccAgent.sidebar.taskFolders.deleteDescription', { name: node.name }),
            confirmText: t('ccAgent.sidebar.taskFolders.delete'),
            cancelText: t('ccAgent.sidebar.taskFolders.cancel'),
          };
          if (!(await confirm(options))) return;
          const command = { action: 'delete' as const, folderId: node.id };
          await folders.run(command);
        };
        const reorder = (beforeId: string, after: boolean) => {
          const ids = projectFolders.map((folder) => folder.id).filter((id) => id !== beforeId);
          const targetIndex = ids.indexOf(node.id);
          if (targetIndex < 0) return;
          ids.splice(targetIndex + (after ? 1 : 0), 0, beforeId);
          const command = { action: 'reorder' as const, projectKey, folderIds: ids };
          void folders.run(command);
        };
        const drop = (event: DragEvent) => {
          event.preventDefault();
          event.stopPropagation();
          setOver(null);
          const draggedFolder = event.dataTransfer.getData(FOLDER_MIME);
          if (draggedFolder) {
            if (
              draggedFolder === node.id ||
              !projectFolders.some((folder) => folder.id === draggedFolder)
            )
              return;
            const rect = event.currentTarget.getBoundingClientRect();
            reorder(draggedFolder, event.clientY > rect.top + rect.height / 2);
            return;
          }
          const sessionId = event.dataTransfer.getData(SPLIT_GROUP_SESSION_MIME);
          if (!sessionId) return;
          const ids = listProps.selectedSessionIds?.has(sessionId)
            ? Array.from(listProps.selectedSessionIds)
            : [sessionId];
          const command = { action: 'move' as const, projectKey, folderId, sessionIds: ids };
          void folders.move(command);
        };
        const onDragOver = (event: DragEvent) => {
          const types = event.dataTransfer.types;
          if (
            !types.includes(SPLIT_GROUP_SESSION_MIME) &&
            !(folderId && types.includes(FOLDER_MIME))
          )
            return;
          event.preventDefault();
          event.stopPropagation();
          event.dataTransfer.dropEffect = 'move';
          setOver(node.id);
          if (types.includes(FOLDER_MIME)) {
            const rect = event.currentTarget.getBoundingClientRect();
            const position = event.clientY > rect.top + rect.height / 2 ? 'after' : 'before';
            setDropPosition(position);
          } else setDropPosition(null);
        };
        const rowClass = cn(
          'group relative flex min-h-8 items-center gap-1 rounded-full pl-3 pr-1 hover:bg-sidebar-item-hover',
          over === node.id && !dropPosition && 'ring-1 ring-[var(--focus-ring)]',
          activeFolder === node.id && !open && 'font-medium ring-1 ring-[var(--border-default)]',
        );
        const Icon = open ? FolderOpen : Folder;
        const Arrow = open ? ChevronDown : ChevronRight;
        return (
          <div key={node.id} data-task-folder={node.id}>
            <div
              className={rowClass}
              onDragOver={onDragOver}
              onDragLeave={() => setOver(null)}
              onDrop={drop}
            >
              {over === node.id && dropPosition && (
                <span
                  aria-hidden
                  className={
                    dropPosition === 'before'
                      ? 'pointer-events-none absolute inset-x-3 top-0 h-px bg-[var(--focus-ring)]'
                      : 'pointer-events-none absolute inset-x-3 bottom-0 h-px bg-[var(--focus-ring)]'
                  }
                />
              )}
              <Tip text={node.name}>
                <button
                  type="button"
                  draggable={!!folderId}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = 'move';
                    event.dataTransfer.setData(FOLDER_MIME, node.id);
                  }}
                  onClick={() => toggle(node.id)}
                  aria-expanded={!!open}
                  className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-sm"
                >
                  <Arrow size={12} className="shrink-0" />
                  <Icon size={14} className="shrink-0 text-[var(--text-secondary)]" />
                  <span className="truncate">{node.name}</span>
                  <span className="ml-auto text-xs text-[var(--text-secondary)]">
                    {countedSessions.length}
                  </span>
                </button>
              </Tip>
              {status && (
                <Tip text={t('ccAgent.sidebar.taskFolders.attention')}>
                  <button
                    type="button"
                    onClick={() => browse(true)}
                    aria-label={t('ccAgent.sidebar.taskFolders.attention')}
                    className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-sidebar-item-hover"
                  >
                    <SidebarRightStatusIndicator kind={status} isActive={false} />
                  </button>
                </Tip>
              )}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Tip text={t('ccAgent.sidebar.taskFolders.actions')}>
                    <button
                      type="button"
                      aria-label={t('ccAgent.sidebar.taskFolders.actions')}
                      className="flex size-7 shrink-0 items-center justify-center rounded-full opacity-0 hover:bg-sidebar-item-hover focus:opacity-100 group-hover:opacity-100"
                    >
                      <EllipsisVertical size={14} />
                    </button>
                  </Tip>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={createTask}>
                    {t('ccAgent.sidebar.taskFolders.newTask')}
                  </DropdownMenuItem>
                  <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => browse()}>
                    {t('ccAgent.sidebar.taskFolders.organize')}
                  </DropdownMenuItem>
                  {folderId && (
                    <>
                      <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={rename}>
                        {t('ccAgent.sidebar.taskFolders.rename')}
                      </DropdownMenuItem>
                      <DropdownMenuItem className={MENU_ITEM_CLASS} onSelect={() => void remove()}>
                        {t('ccAgent.sidebar.taskFolders.delete')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {open && (
              <div className="pl-4">
                <SessionEntryList {...listProps} sessions={visible} collapsible={false} />
                {!sessions.length && (
                  <button
                    type="button"
                    onClick={createTask}
                    className="flex min-h-8 w-full items-center gap-2 rounded-full px-3 text-xs text-[var(--text-secondary)] hover:bg-sidebar-item-hover"
                  >
                    <Plus size={12} />
                    {t('ccAgent.sidebar.taskFolders.newTask')}
                  </button>
                )}
                {(sessions.length > 5 || countedSessions.length > sessions.length) && (
                  <button
                    type="button"
                    onClick={() => browse()}
                    className="min-h-8 w-full rounded-full px-3 text-xs text-[var(--text-secondary)] hover:bg-sidebar-item-hover"
                  >
                    {t('ccAgent.sidebar.taskFolders.viewAll', { count: countedSessions.length })}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
      {nodes.length > 11 && (
        <Button variant="secondary" onClick={browseFolders}>
          {t('ccAgent.sidebar.taskFolders.moreFolders')}
        </Button>
      )}
      {special.length > 0 && <SessionEntryList {...listProps} sessions={special} />}
    </div>
  );
}
