import { z } from 'zod';
import type { DataOwnerPushStamp } from './dataOwnerPush';

export const TASK_FOLDERS_CHANNEL = 'sidebar:task-folders:execute';
export const TASK_FOLDERS_CHANGED = 'sidebar:task-folders:changed';
const id = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => !['__proto__', 'constructor', 'prototype'].includes(value));
const projectKey = z.string().min(1).max(4096);
const name = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => {
    for (const character of value) {
      const code = character.charCodeAt(0);
      if (code < 32 || code === 127) return false;
    }
    return true;
  });
const membership = z.object({ projectKey, folderId: id.nullable() });
const folder = z.object({ id, projectKey, name });

export const taskFolderStateSchema = z.object({
  revision: z.number().int().nonnegative(),
  folders: z.array(folder).max(10000),
  memberships: z.record(id, membership),
});
export type TaskFolderState = z.infer<typeof taskFolderStateSchema>;
export type TaskFolder = TaskFolderState['folders'][number];
export type TaskFolderMembership = z.infer<typeof membership>;
export interface TaskFolderSnapshot extends TaskFolderState {
  ownerStamp: DataOwnerPushStamp;
}

export const taskFolderCommandSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('create'),
    projectKey,
    name,
    sessionIds: z.array(id).max(5000).optional(),
  }),
  z.object({ action: z.literal('rename'), folderId: id, name }),
  z.object({ action: z.literal('delete'), folderId: id }),
  z.object({ action: z.literal('reorder'), projectKey, folderIds: z.array(id).max(10000) }),
  z.object({
    action: z.literal('move'),
    projectKey,
    folderId: id.nullable(),
    sessionIds: z.array(id).min(1).max(5000),
  }),
  z.object({
    action: z.literal('restore'),
    revision: z.number().int().nonnegative(),
    memberships: z.record(id, membership.nullable()),
  }),
]);
export type TaskFolderCommand = z.infer<typeof taskFolderCommandSchema>;
export interface TaskFolderRequest {
  ownerStamp: DataOwnerPushStamp;
  command?: TaskFolderCommand;
  expectedRevision?: number;
}
export const EMPTY_TASK_FOLDERS: TaskFolderState = { revision: 0, folders: [], memberships: {} };
