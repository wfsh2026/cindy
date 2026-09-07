import type { JSONContent } from '@tiptap/core';

import type { BrowserCommentDraftItem } from '@/lib/browserComments';
import type { AttachedFile } from '@/lib/fileTypes';
import type { ExperienceSelectionSnapshot } from '@cindy/maker-shared/experience-pack';

export interface ComposerSendSnapshot {
  documentToken: string;
  attachments: readonly AttachedFile[];
  browserComments: readonly BrowserCommentDraftItem[];
  experience?: ExperienceSelectionSnapshot;
  experienceCleared?: boolean;
}

export interface ComposerSendSnapshotFields {
  attachments: AttachedFile[];
  browserComments: BrowserCommentDraftItem[];
  experience?: ExperienceSelectionSnapshot;
  experienceCleared?: boolean;
}

type LegacyComposerSendSnapshotArgs = [
  browserComments?: BrowserCommentDraftItem[],
  experience?: ExperienceSelectionSnapshot,
  experienceCleared?: boolean,
];

function resolveSnapshotFields(
  fieldsOrAttachments: ComposerSendSnapshotFields | AttachedFile[],
  legacyArgs: LegacyComposerSendSnapshotArgs,
): ComposerSendSnapshotFields {
  if (!Array.isArray(fieldsOrAttachments)) return fieldsOrAttachments;
  const [browserComments = [], experience, experienceCleared = false] = legacyArgs;
  return { attachments: fieldsOrAttachments, browserComments, experience, experienceCleared };
}

/** Captures object versions without serializing potentially large attachment bytes. */
export function captureComposerSendSnapshot(
  document: JSONContent,
  fields: ComposerSendSnapshotFields,
): ComposerSendSnapshot;
/** @deprecated Keep the pre-metadata call shape for older renderer tests/callers. */
export function captureComposerSendSnapshot(
  document: JSONContent,
  attachments: AttachedFile[],
  ...legacyArgs: LegacyComposerSendSnapshotArgs
): ComposerSendSnapshot;
export function captureComposerSendSnapshot(
  document: JSONContent,
  fieldsOrAttachments: ComposerSendSnapshotFields | AttachedFile[],
  ...legacyArgs: LegacyComposerSendSnapshotArgs
): ComposerSendSnapshot {
  const fields = resolveSnapshotFields(fieldsOrAttachments, legacyArgs);
  return {
    documentToken: JSON.stringify(document),
    attachments: fields.attachments,
    browserComments: fields.browserComments,
    ...(fields.experience ? { experience: fields.experience } : {}),
    ...(fields.experienceCleared ? { experienceCleared: true } : {}),
  };
}

/** Supports the metadata object and the legacy attachment/comment arguments. */
export function isComposerSendSnapshotCurrent(
  snapshot: ComposerSendSnapshot,
  document: JSONContent,
  ...input: [fields: ComposerSendSnapshotFields] | [attachments: AttachedFile[], ...legacy: LegacyComposerSendSnapshotArgs]
): boolean {
  const [fieldsOrAttachments, ...legacyArgs] = input;
  const fields = resolveSnapshotFields(fieldsOrAttachments, legacyArgs);
  return (
    snapshot.documentToken === JSON.stringify(document) &&
    snapshot.attachments.length === fields.attachments.length &&
    snapshot.attachments.every((item, index) => item === fields.attachments[index]) &&
    snapshot.browserComments.length === fields.browserComments.length &&
    snapshot.browserComments.every((item, index) => item === fields.browserComments[index]) &&
    JSON.stringify(snapshot.experience ?? null) === JSON.stringify(fields.experience ?? null) &&
    (snapshot.experienceCleared === true) === (fields.experienceCleared === true)
  );
}
