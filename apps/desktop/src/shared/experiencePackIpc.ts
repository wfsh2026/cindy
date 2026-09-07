import type {
  ExperienceContextSnapshot,
  ExperienceInputContext,
  ExperienceModuleContent,
  ExperiencePackIndex,
  ExperienceResolveResult,
  ExperiencePackSummary,
  ExperienceSelectionSnapshot,
  ExperiencePackTaskMetadata,
  ExperiencePackListResult,
  ExperiencePackGetResult,
  ExperiencePackTaskResult,
  ExperiencePackFallbackPayload,
} from '@cindy/maker-shared/experience-pack';

export {
  isExperiencePackFallbackPayload,
  isExperiencePackGetResult,
  isExperiencePackIndex,
  isExperiencePackListResult,
  isExperiencePackResolveResult,
  isExperiencePackTaskMetadata,
  isExperiencePackTaskResult,
} from '@cindy/maker-shared/experience-pack';

/** Renderer/main channels for the read-only project-experience registry. */
export const EXPERIENCE_PACK_IPC = {
  LIST: 'experience-packs:list',
  GET_SELECTION: 'experience-packs:get-selection',
  SET_SELECTION: 'experience-packs:set-selection',
  GET: 'experience-packs:get',
  RESOLVE: 'experience-packs:resolve',
  READ_CONTENT: 'experience-packs:read-content',
  GET_OVERRIDE: 'experience-packs:get-override',
  SET_OVERRIDE: 'experience-packs:set-override',
  FREEZE_TASK: 'experience-packs:freeze-task',
  GET_TASK: 'experience-packs:get-task',
  DELETE_TASK: 'experience-packs:delete-task',
  REFRESH: 'experience-packs:refresh',
  CHANGED: 'experience-packs:changed',
  FALLBACK: 'experience-packs:fallback',
} as const;

export type { ExperiencePackListResult, ExperiencePackGetResult, ExperiencePackTaskMetadata, ExperiencePackTaskResult, ExperiencePackFallbackPayload } from '@cindy/maker-shared/experience-pack';
export type ExperiencePackResolveRequest = {
  sessionId?: string;
  text: string;
  selection: ExperienceSelectionSnapshot;
};
export type ExperiencePackResolveResult = ExperienceResolveResult;

export type ExperiencePackOverrideRequest = {
  packId: string;
  workflowId: string;
};
export type ExperiencePackOverrideWriteRequest = ExperiencePackOverrideRequest & {
  ignoredNodeIds: string[];
  ignoredModuleIds: string[];
};
export type ExperiencePackOverride = {
  workflowId: string;
  ignoredNodeIds: string[];
  ignoredModuleIds: string[];
};
export type ExperiencePackTaskRequest = {
  sessionId: string;
  clientId?: string;
  text: string;
  selection: ExperienceSelectionSnapshot;
};
export type ExperiencePackContentRequest = {
  packId: string;
  moduleId: string;
};
export type ExperiencePackContentResult = ExperienceModuleContent;
