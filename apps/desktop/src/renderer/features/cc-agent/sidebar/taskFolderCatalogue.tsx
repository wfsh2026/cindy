import { createContext, useContext, type ReactNode } from 'react';
import type { Session } from '@/lib/ccAgent.types';

const TaskFolderCatalogue = createContext<readonly Session[]>([]);
export function TaskFolderCatalogueProvider({
  sessions,
  children,
}: {
  sessions: readonly Session[];
  children: ReactNode;
}) {
  return <TaskFolderCatalogue.Provider value={sessions}>{children}</TaskFolderCatalogue.Provider>;
}
export function useTaskFolderCatalogue(): readonly Session[] {
  return useContext(TaskFolderCatalogue);
}
