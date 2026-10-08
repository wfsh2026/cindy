import { BrowserWindow, ipcMain } from 'electron';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  EMPTY_TASK_FOLDERS,
  TASK_FOLDERS_CHANNEL,
  TASK_FOLDERS_CHANGED,
  taskFolderCommandSchema,
  taskFolderStateSchema,
} from '../shared/taskFolders';
import type {
  TaskFolderCommand,
  TaskFolderRequest,
  TaskFolderSnapshot,
  TaskFolderState,
} from '../shared/taskFolders';
import { isDataOwnerPushStamp, type DataOwnerPushStamp } from '../shared/dataOwnerPush';
import {
  normalizeProjectKey,
  projectIdentityKey,
  projectKeyComparisonKey,
} from '../shared/projectKeys';
import {
  activeOwnerScopeKey,
  getActiveDataOwnerPushStamp,
  isAppSessionBoundaryPending,
  ownerScopedUserDataPath,
} from './appSessionState';
import {
  createOverrideSettingsFile,
  type OverrideSettingsState,
} from './maker-host/override-settings-file';
import {
  assertTrustedAppRendererEvent,
  isTrustedAppRendererWindow,
} from './security/trustedAppRenderer';
import { getDbClient } from './localDb/client/current';
import { throwIpcError } from './utils/ipcValidate';
import { createLogger } from './logger';
import { isIpcError } from '../shared/ipc-errors';

const log = createLogger('task-folders');
const stores = new Map<string, ReturnType<typeof createOverrideSettingsFile<TaskFolderState>>>();

function normalizeState(raw: unknown): TaskFolderState {
  return taskFolderStateSchema.parse(raw);
}

function assertOwner(stamp: DataOwnerPushStamp): void {
  const current = getActiveDataOwnerPushStamp();
  if (
    isAppSessionBoundaryPending() ||
    !current.dataOwnerId ||
    current.dataOwnerId !== stamp.dataOwnerId ||
    current.ownerGeneration !== stamp.ownerGeneration
  ) {
    throwIpcError('PRECONDITION_FAILED', 'Task folder account changed');
  }
}

function currentStore() {
  const root = ownerScopedUserDataPath();
  let store = stores.get(root);
  if (!store) {
    const file = path.join(root, 'task-folders.json');
    const options = {
      filePath: () => file,
      defaults: EMPTY_TASK_FOLDERS,
      normalize: normalizeState,
      log,
      label: 'task-folders',
      scopeKey: activeOwnerScopeKey,
      maxBytes: 16 * 1024 * 1024,
      preserveUnreadableFile: true,
      logLoadedValue: false,
      logReadErrorDetails: false,
    };
    store = createOverrideSettingsFile<TaskFolderState>(options);
    stores.set(root, store);
  }
  return store;
}

function canonicalProject(raw: string): string {
  const normalized = normalizeProjectKey(raw);
  if (!normalized || normalized.startsWith('device:'))
    throwIpcError('INVALID_PARAMS', 'Unsupported task folder project');
  return projectKeyComparisonKey(normalized, process.platform) ?? normalized;
}

async function validateMembers(command: TaskFolderCommand): Promise<void> {
  if (command.action !== 'move' && command.action !== 'create' && command.action !== 'restore')
    return;
  const targets = command.action === 'restore' ? command.memberships : null;
  const ids = targets
    ? Object.keys(targets)
    : 'sessionIds' in command
      ? (command.sessionIds ?? [])
      : [];
  if (ids.length > 5000) throwIpcError('INVALID_PARAMS', 'Too many task folder members');
  const client = getDbClient();
  for (let offset = 0; offset < ids.length; offset += 200) {
    const batch = ids.slice(offset, offset + 200);
    const placeholders = batch.map(() => '?').join(',');
    const sql = `SELECT id, working_dir AS workingDir, remote_host_id AS remoteHostId, workspace_kind AS workspaceKind FROM sessions WHERE status != 'deleted' AND source NOT IN ('scheduler', 'bot') AND (orca_role IS NULL OR orca_role != 'worker') AND id IN (${placeholders})`;
    const rows = await client.query<{
      id: string;
      workingDir: string | null;
      remoteHostId: string | null;
      workspaceKind: string;
    }>(sql, batch);
    if (rows.length !== new Set(batch).size)
      throwIpcError('NOT_FOUND', 'Task folder member is missing');
    for (const row of rows) {
      const target = targets
        ? targets[row.id]?.projectKey
        : 'projectKey' in command
          ? command.projectKey
          : null;
      if (!target) continue;
      if (!row.workingDir || row.workspaceKind === 'dialogue')
        throwIpcError('INVALID_PARAMS', 'Task does not belong to a project');
      const scope = row.remoteHostId ? 'remote' : 'local';
      const identity = projectIdentityKey(scope, row.workingDir, row.remoteHostId);
      const actual = canonicalProject(identity);
      const expected = canonicalProject(target);
      if (actual !== expected) throwIpcError('INVALID_PARAMS', 'Task belongs to another project');
    }
  }
}

function changeState(current: TaskFolderState, command: TaskFolderCommand): TaskFolderState {
  const next: TaskFolderState = {
    revision: current.revision + 1,
    folders: [...current.folders],
    memberships: { ...current.memberships },
  };
  if (command.action === 'create' || command.action === 'rename') {
    const existing =
      command.action === 'rename'
        ? current.folders.find((item) => item.id === command.folderId)
        : null;
    if (command.action === 'rename' && !existing)
      throwIpcError('NOT_FOUND', 'Task folder is missing');
    const projectKey =
      existing?.projectKey ??
      canonicalProject(command.action === 'create' ? command.projectKey : '');
    const duplicate = current.folders.some(
      (item) =>
        item.projectKey === projectKey &&
        item.id !== existing?.id &&
        item.name.toLocaleLowerCase() === command.name.toLocaleLowerCase(),
    );
    if (duplicate) throwIpcError('ALREADY_EXISTS', 'Task folder name already exists');
    if (existing) {
      next.folders = next.folders.map((item) =>
        item.id === existing.id ? { ...item, name: command.name } : item,
      );
    } else {
      const folderId = randomUUID();
      next.folders.push({ id: folderId, projectKey, name: command.name });
      if (command.action === 'create')
        for (const sessionId of command.sessionIds ?? [])
          next.memberships[sessionId] = { projectKey, folderId };
    }
  } else if (command.action === 'delete') {
    next.folders = next.folders.filter((item) => item.id !== command.folderId);
    for (const [sessionId, member] of Object.entries(next.memberships)) {
      if (member.folderId === command.folderId)
        next.memberships[sessionId] = { ...member, folderId: null };
    }
  } else if (command.action === 'reorder') {
    const projectKey = canonicalProject(command.projectKey);
    const folders = current.folders.filter((item) => item.projectKey === projectKey);
    const keys = new Set(command.folderIds);
    if (
      keys.size !== folders.length ||
      keys.size !== command.folderIds.length ||
      folders.some((item) => !keys.has(item.id))
    )
      throwIpcError('PRECONDITION_FAILED', 'Task folders changed; reload before sorting');
    const entries = folders.map((item) => [item.id, item] as const);
    const byId = new Map(entries);
    next.folders = current.folders.filter((item) => item.projectKey !== projectKey);
    for (const id of command.folderIds) next.folders.push(byId.get(id)!);
  } else if (command.action === 'move') {
    const projectKey = canonicalProject(command.projectKey);
    if (
      command.folderId &&
      !current.folders.some(
        (item) => item.id === command.folderId && item.projectKey === projectKey,
      )
    )
      throwIpcError('NOT_FOUND', 'Task folder is missing');
    for (const sessionId of command.sessionIds)
      next.memberships[sessionId] = { projectKey, folderId: command.folderId };
  } else {
    if (current.revision !== command.revision)
      throwIpcError('PRECONDITION_FAILED', 'Task folders changed; undo is no longer available');
    for (const [id, member] of Object.entries(command.memberships)) {
      if (member === null) delete next.memberships[id];
      else {
        const projectKey = canonicalProject(member.projectKey);
        if (
          member.folderId &&
          !current.folders.some(
            (folder) => folder.id === member.folderId && folder.projectKey === projectKey,
          )
        )
          throwIpcError('NOT_FOUND', 'Task folder is missing');
        next.memberships[id] = { projectKey, folderId: member.folderId };
      }
    }
  }
  return next;
}

function broadcast(snapshot: TaskFolderSnapshot): void {
  const windows = BrowserWindow.getAllWindows();
  for (const window of windows) {
    try {
      if (isTrustedAppRendererWindow(window))
        window.webContents.send(TASK_FOLDERS_CHANGED, snapshot);
    } catch {
      log.warn('Task folder window notification failed');
    }
  }
}

export async function executeTaskFolders(raw: TaskFolderRequest): Promise<TaskFolderSnapshot> {
  if (!raw || !isDataOwnerPushStamp(raw.ownerStamp))
    throwIpcError('INVALID_PARAMS', 'Invalid task folder owner');
  const stamp = raw.ownerStamp;
  assertOwner(stamp);
  const store = currentStore();
  if (raw.command === undefined) {
    store.invalidateIfChanged();
    const state = store.read();
    return { ...state, ownerStamp: stamp };
  }
  const parsed = taskFolderCommandSchema.safeParse(raw.command);
  if (!parsed.success) throwIpcError('INVALID_PARAMS', 'Invalid task folder operation');
  const command = parsed.data;
  if (
    raw.expectedRevision !== undefined &&
    (!Number.isSafeInteger(raw.expectedRevision) || raw.expectedRevision < 0)
  )
    throwIpcError('INVALID_PARAMS', 'Invalid task folder revision');
  await validateMembers(command);
  assertOwner(stamp);
  const update = (state: OverrideSettingsState<TaskFolderState>) => {
    assertOwner(stamp);
    if (raw.expectedRevision !== undefined && state.value.revision !== raw.expectedRevision)
      throwIpcError('PRECONDITION_FAILED', 'Task folders changed; reload before editing');
    return changeState(state.value, command);
  };
  const next = await store.updateAtomic(update);
  assertOwner(stamp);
  const snapshot = { ...next, ownerStamp: stamp };
  broadcast(snapshot);
  return snapshot;
}

/** Forks copy organization once; later moves of the parent do not move the child. */
export async function inheritTaskFolder(
  sourceId: string,
  sessionId: string,
  stamp: DataOwnerPushStamp,
): Promise<void> {
  try {
    assertOwner(stamp);
    const store = currentStore();
    store.invalidateIfChanged();
    const state = store.read();
    const member = state.memberships[sourceId];
    if (!member?.folderId || state.memberships[sessionId]) return;
    const command = {
      action: 'move' as const,
      projectKey: member.projectKey,
      folderId: member.folderId,
      sessionIds: [sessionId],
    };
    await validateMembers(command);
    assertOwner(stamp);
    const update = (current: OverrideSettingsState<TaskFolderState>) => {
      assertOwner(stamp);
      if (current.value.memberships[sessionId]) return {};
      return changeState(current.value, command);
    };
    const next = await store.updateAtomic(update);
    assertOwner(stamp);
    const snapshot = { ...next, ownerStamp: stamp };
    broadcast(snapshot);
  } catch {
    log.warn('Fork task folder could not be inherited');
  }
}

export function registerTaskFolderIpc(): void {
  ipcMain.handle(TASK_FOLDERS_CHANNEL, async (event, request: TaskFolderRequest) => {
    assertTrustedAppRendererEvent(event);
    try {
      return await executeTaskFolders(request);
    } catch (error) {
      if (isIpcError(error)) throw error;
      log.warn('Task folder operation failed');
      throwIpcError('INTERNAL', 'Unable to save task folders');
    }
  });
}
