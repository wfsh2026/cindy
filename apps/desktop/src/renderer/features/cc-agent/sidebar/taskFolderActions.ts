import { useSyncExternalStore } from 'react';
export interface TaskFolderDialogRequest {
  kind: 'create' | 'rename' | 'move' | 'browse' | 'folders';
  projectKey: string;
  projectName?: string;
  folderId?: string | null;
  name?: string;
  sessionIds?: string[];
  attentionOnly?: boolean;
}
let current: TaskFolderDialogRequest | null = null;
let reveal: { sessionId: string; sequence: number } | null = null;
let revealSequence = 0;
const listeners = new Set<() => void>();
export function openTaskFolderDialog(request: TaskFolderDialogRequest | null): void {
  current = request;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
function getSnapshot(): TaskFolderDialogRequest | null {
  return current;
}
export function useTaskFolderDialog(): TaskFolderDialogRequest | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
function getReveal() {
  return reveal;
}
export function revealTaskFolder(sessionId: string): void {
  revealSequence += 1;
  reveal = { sessionId, sequence: revealSequence };
  for (const listener of listeners) listener();
}
export function dismissTaskFolderReveal(): void {
  reveal = null;
  for (const listener of listeners) listener();
}
export function useTaskFolderReveal() {
  return useSyncExternalStore(subscribe, getReveal, getReveal);
}
