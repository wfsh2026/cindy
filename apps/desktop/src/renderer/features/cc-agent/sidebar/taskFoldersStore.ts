import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '@/contexts/AuthContext';
import {
  getDataOwnerGeneration,
  isDataOwnerPushStampCurrent,
} from '@/contexts/dataOwnerGeneration';
import { toast } from '@/lib/toast';
import { extractIpcError } from '@/utils/ipcError';
import {
  EMPTY_TASK_FOLDERS,
  type TaskFolderCommand,
  type TaskFolderMembership,
  type TaskFolderSnapshot,
} from '../../../../shared/taskFolders';
import { projectKeyComparisonKey } from '../../../../shared/projectKeys';
import type { Session } from '@/lib/ccAgent.types';
import { projectIdentityKeyForSession } from '../lib/projectGrouping';
import type { DataOwnerPushStamp } from '../../../../shared/dataOwnerPush';

let snapshot: TaskFolderSnapshot | null = null;
let loading: Promise<void> | null = null;
let scope = '';
const listeners = new Set<() => void>();
let unsubscribe: (() => void) | null = null;
function emit(): void {
  for (const listener of listeners) listener();
}
function accept(next: TaskFolderSnapshot): void {
  if (!isDataOwnerPushStampCurrent(next.ownerStamp)) return;
  if (
    snapshot &&
    isDataOwnerPushStampCurrent(snapshot.ownerStamp) &&
    snapshot.revision > next.revision
  )
    return;
  snapshot = next;
  emit();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (!unsubscribe && window.electronAPI?.taskFolders) {
    unsubscribe = window.electronAPI.taskFolders.onChanged(accept);
    window.addEventListener('focus', refresh);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      unsubscribe?.();
      unsubscribe = null;
      window.removeEventListener('focus', refresh);
    }
  };
}
function getSnapshot(): TaskFolderSnapshot | null {
  return snapshot && isDataOwnerPushStampCurrent(snapshot.ownerStamp) ? snapshot : null;
}
function refresh(): void {
  void loadTaskFolders();
}
export async function loadTaskFolders(): Promise<void> {
  const owner = getDataOwnerGeneration();
  if (!owner.dataOwnerId || !window.electronAPI?.taskFolders) return;
  const nextScope = `${owner.generation}:${owner.dataOwnerId}`;
  if (scope !== nextScope) {
    scope = nextScope;
    snapshot = null;
    loading = null;
    emit();
  }
  if (loading) return loading;
  const ownerStamp = { dataOwnerId: owner.dataOwnerId, ownerGeneration: owner.generation };
  const request = { ownerStamp };
  const pending = window.electronAPI.taskFolders
    .execute(request)
    .then(accept)
    .catch(() => {
      /* Original task list remains available. */
    });
  loading = pending;
  await pending;
  if (loading === pending) loading = null;
}
export async function executeTaskFolder(
  command: TaskFolderCommand,
  expectedOwner?: DataOwnerPushStamp,
  expectedRevision?: number,
): Promise<TaskFolderSnapshot> {
  const owner = getDataOwnerGeneration();
  const ownerStamp = expectedOwner ?? {
    dataOwnerId: owner.dataOwnerId,
    ownerGeneration: owner.generation,
  };
  const request = { ownerStamp, command, expectedRevision };
  const next = await window.electronAPI.taskFolders.execute(request);
  accept(next);
  return next;
}
export function folderProjectKey(raw: string): string {
  const platform = window.electronAPI?.platform;
  return projectKeyComparisonKey(raw, platform) ?? raw;
}
export function taskFolderProject(session: Session): string | null {
  if (
    session.deviceLinkDeviceId ||
    session.workspaceKind === 'dialogue' ||
    session.orcaRole === 'worker' ||
    session.source === 'scheduler' ||
    session.source === 'bot'
  )
    return null;
  const key = projectIdentityKeyForSession(session);
  return key ? folderProjectKey(key) : null;
}
export function useTaskFolders() {
  const { dataOwnerId, dataOwnerGeneration } = useAuth();
  const { t } = useTranslation();
  const current = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => {
    if (!getSnapshot()) void loadTaskFolders();
  }, [dataOwnerId, dataOwnerGeneration]);
  const state = current ?? EMPTY_TASK_FOLDERS;
  const byId = useMemo(() => {
    const entries = state.folders.map((folder) => [folder.id, folder] as const);
    return new Map(entries);
  }, [state.folders]);
  const reportError = (error: unknown) => {
    const decoded = extractIpcError(error);
    const key = decoded?.code === 'ALREADY_EXISTS' ? 'duplicate' : 'failed';
    const message = t(`ccAgent.sidebar.taskFolders.${key}`);
    toast.error(message);
  };
  const run = async (command: TaskFolderCommand): Promise<TaskFolderSnapshot | null> => {
    const stamp = { dataOwnerId, ownerGeneration: dataOwnerGeneration };
    const revision = command.action === 'restore' ? command.revision : state.revision;
    try {
      return await executeTaskFolder(command, stamp, revision);
    } catch (error) {
      reportError(error);
      void loadTaskFolders();
      return null;
    }
  };
  const move = async (
    command: Extract<TaskFolderCommand, { action: 'move' | 'create' }>,
  ): Promise<boolean> => {
    const sessionIds = command.sessionIds ?? [];
    const previous: Record<string, TaskFolderMembership | null> = {};
    for (const id of sessionIds) {
      const member = state.memberships[id];
      previous[id] = member?.projectKey === command.projectKey ? member : null;
    }
    const result = await run(command);
    if (!result) return false;
    const target =
      command.action === 'move' ? state.folders.find((item) => item.id === command.folderId) : null;
    const folderName =
      command.action === 'create'
        ? command.name
        : (target?.name ?? t('ccAgent.sidebar.taskFolders.projectRoot'));
    const message = t('ccAgent.sidebar.taskFolders.moved', {
      count: sessionIds.length,
      name: folderName,
    });
    const undo = () => {
      const restore: TaskFolderCommand = {
        action: 'restore',
        revision: result.revision,
        memberships: previous,
      };
      void run(restore);
    };
    const options = {
      duration: 6000,
      action: { label: t('ccAgent.sidebar.taskFolders.undo'), onClick: undo },
    };
    toast.success(message, options);
    return true;
  };
  const folderFor = (session: Session): string | null => {
    const projectKey = taskFolderProject(session);
    const member = state.memberships[session.id];
    if (!member || member.projectKey !== projectKey) return null;
    const folder = member.folderId ? byId.get(member.folderId) : null;
    return folder?.projectKey === projectKey ? member.folderId : null;
  };
  return { ...state, ready: current !== null, ownerId: dataOwnerId, run, move, folderFor };
}
