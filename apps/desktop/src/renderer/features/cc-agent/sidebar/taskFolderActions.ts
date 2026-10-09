import { useSyncExternalStore } from 'react';
let reveal: { sessionId: string; sequence: number } | null = null;
let revealSequence = 0;
const listeners = new Set<() => void>();
function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
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
