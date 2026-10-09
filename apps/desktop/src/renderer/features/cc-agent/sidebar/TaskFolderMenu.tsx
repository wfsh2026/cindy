import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FolderInput } from 'lucide-react';
import { Tip } from '@/components/ui/tooltip';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import type { Session } from '@/lib/ccAgent.types';
import { useTaskFolders, taskFolderProject } from './taskFoldersStore';
import { MENU_ITEM_CLASS } from './menuStyles';

function TaskFolderDestinations({ sessions }: { sessions: Session[] }) {
  const folders = useTaskFolders();
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const projectKey = sessions[0] ? taskFolderProject(sessions[0]) : null;
  const enabled =
    projectKey && sessions.every((session) => taskFolderProject(session) === projectKey);
  const moveTo = async (folderId: string | null) => {
    if (!enabled || !projectKey || pending || !folders.ready) return;
    const sessionIds = sessions.map((session) => session.id);
    const command = { action: 'move' as const, projectKey, folderId, sessionIds };
    setPending(true);
    await folders.move(command);
    setPending(false);
  };
  const destinations = folders.folders.filter((folder) => folder.projectKey === projectKey);
  const disabled = !enabled || !folders.ready || pending;
  return (
    <>
      <DropdownMenuItem
        className={MENU_ITEM_CLASS}
        disabled={disabled}
        onSelect={() => void moveTo(null)}
      >
        {t('ccAgent.sidebar.taskFolders.projectRoot')}
      </DropdownMenuItem>
      {destinations.map((folder) => (
        <DropdownMenuItem
          key={folder.id}
          className={MENU_ITEM_CLASS}
          disabled={disabled}
          onSelect={() => void moveTo(folder.id)}
        >
          {folder.name}
        </DropdownMenuItem>
      ))}
    </>
  );
}

export function TaskFolderMoveItem({ session }: { session: Session }) {
  const { t } = useTranslation();
  const projectKey = taskFolderProject(session);
  if (!projectKey) return null;
  const sessions = [session];
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={MENU_ITEM_CLASS}>
        {t('ccAgent.sidebar.taskFolders.move')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
        <TaskFolderDestinations sessions={sessions} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function TaskFolderBulkMove({ sessions }: { sessions: Session[] }) {
  const { t } = useTranslation();
  const projectKey = sessions[0] ? taskFolderProject(sessions[0]) : null;
  const enabled =
    projectKey && sessions.every((session) => taskFolderProject(session) === projectKey);
  const label = t(`ccAgent.sidebar.taskFolders.${enabled ? 'move' : 'sameProject'}`);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Tip text={label}>
          <button
            type="button"
            disabled={!enabled}
            aria-label={label}
            className="flex size-7 shrink-0 items-center justify-center rounded-full hover:bg-sidebar-item-hover disabled:opacity-40"
          >
            <FolderInput size={14} />
          </button>
        </Tip>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="max-h-72 overflow-y-auto">
        <TaskFolderDestinations sessions={sessions} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
