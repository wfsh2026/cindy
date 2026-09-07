import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, CircleAlert, CircleHelp, FolderOpen, Minus, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import type {
  ExperienceContextPlan,
  ExperiencePackIndex,
  ExperiencePackSummary,
  ExperiencePackTaskMetadata,
  ExperienceSelectionSnapshot,
  ExperienceWorkflowDocument,
} from '@cindy/maker-shared/experience-pack';
import { MorphPopover } from '@/components/ui/morph-popover';
import { Tip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type ExperiencePackButtonProps = {
  value?: ExperienceSelectionSnapshot;
  onChange: (
    value?: ExperienceSelectionSnapshot,
    options?: { explicitClear?: boolean },
  ) => void;
  /** Controlled popover state lets the composer reopen the picker when the
   * automatic router needs an explicit workflow choice. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  disabled?: boolean;
  dense?: boolean;
  visualVariant?: 'default' | 'create-agent';
  text?: string;
  sessionId?: string;
};

type ExperienceIndexState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  index: ExperiencePackIndex | null;
  message?: string;
};

const EMPTY_SELECTION = (packId: string): ExperienceSelectionSnapshot => ({
  version: 1,
  packId,
  mode: 'auto',
  workflowId: null,
  ignoredNodeIds: [],
  ignoredModuleIds: [],
});

function stateLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  state: 'ready' | 'pending' | 'blocked' | 'waiting' | 'not-applicable' | 'unavailable' | 'ignored',
): string {
  return t(`newChat.chatInput.projectExperience.${state}`, {
    defaultValue: state,
  });
}

function workflowIsSelectable(
  pack: ExperiencePackSummary | undefined,
  workflowId: string,
): boolean {
  return pack?.workflows.some((workflow) => workflow.id === workflowId && workflow.status === 'ready') ?? false;
}

function selectedOverride(value: ExperienceSelectionSnapshot | undefined): {
  nodeIds: Set<string>;
  moduleIds: Set<string>;
} {
  return {
    nodeIds: new Set(value?.ignoredNodeIds ?? []),
    moduleIds: new Set(value?.ignoredModuleIds ?? []),
  };
}

function workflowModules(workflow: ExperienceWorkflowDocument, index: ExperiencePackIndex): string[] {
  const ids = new Set<string>();
  const moduleMap = new Map(index.modules.map((module) => [module.id, module]));
  const visit = (id: string): void => {
    if (ids.has(id)) return;
    const module = moduleMap.get(id);
    if (!module) return;
    for (const dependency of module.requires) visit(dependency);
    ids.add(id);
  };
  for (const node of workflow.nodes) {
    for (const id of node.modules) visit(id);
    for (const id of node.optionalModules) visit(id);
  }
  return [...ids];
}

function workflowModuleRoles(
  workflow: ExperienceWorkflowDocument,
  index: ExperiencePackIndex,
): { required: Set<string>; optional: Set<string> } {
  const moduleMap = new Map(index.modules.map((module) => [module.id, module]));
  const required = new Set<string>();
  const optional = new Set<string>();
  const visit = (id: string, target: Set<string>): void => {
    if (target.has(id)) return;
    const module = moduleMap.get(id);
    if (!module) return;
    target.add(id);
    for (const dependency of module.requires) visit(dependency, target);
  };
  for (const node of workflow.nodes) {
    for (const id of node.modules) visit(id, required);
    for (const id of node.optionalModules) visit(id, optional);
  }
  for (const id of required) optional.delete(id);
  return { required, optional };
}

function planStateLabel(
  t: (key: string, options?: Record<string, unknown>) => string,
  state: ExperienceContextPlan['nodes'][number]['state'] | ExperienceContextPlan['nodes'][number]['modules'][number]['state'],
): string {
  return state === 'enabled' ? stateLabel(t, 'ready') : stateLabel(t, state);
}

/**
 * Composer entry for the host-owned project-experience registry.
 *
 * Only the pack's light indexes cross into the renderer. Module Markdown is
 * intentionally never requested here; Main reads it at the final dispatch
 * boundary after the queue item has been accepted.
 */
export function ExperiencePackButton({
  value,
  onChange,
  open: controlledOpen,
  onOpenChange,
  disabled = false,
  dense = false,
  visualVariant = 'default',
  text,
  sessionId,
}: ExperiencePackButtonProps) {
  const { t } = useTranslation();
  const modeGroupId = useId();
  const [internalOpen, setInternalOpen] = useState(false);
  const [packs, setPacks] = useState<ExperiencePackSummary[]>([]);
  const [loadingPacks, setLoadingPacks] = useState(false);
  const [packError, setPackError] = useState(false);
  const [indexByPack, setIndexByPack] = useState<Record<string, ExperienceIndexState>>({});
  const [resolvedPlan, setResolvedPlan] = useState<ExperienceContextPlan | null>(null);
  const [resolveMessage, setResolveMessage] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [lastPrepared, setLastPrepared] = useState<ExperiencePackTaskMetadata | null>(null);
  const [localPackId, setLocalPackId] = useState<string | null>(value?.packId ?? null);
  const isCreateAgentVariant = visualVariant === 'create-agent';
  const open = controlledOpen ?? internalOpen;
  const setOpen = useCallback((next: boolean) => {
    if (controlledOpen === undefined) setInternalOpen(next);
    onOpenChange?.(next);
  }, [controlledOpen, onOpenChange]);
  const selectedPackId = value?.packId ?? localPackId;
  const selectedPack = packs.find((pack) => pack.packId === selectedPackId);
  const selectedIndexState = selectedPackId ? indexByPack[selectedPackId] : undefined;
  const selectedIndex = selectedIndexState?.index ?? null;
  const selectedWorkflowId = value?.mode === 'explicit' ? value.workflowId : null;
  // Automatic mode intentionally does not preview an arbitrary workflow. The
  // Main router chooses one from the message text at dispatch time; showing
  // the first ready workflow here would make users think it was already bound.
  const selectedWorkflow = selectedWorkflowId
    ? selectedIndex?.workflows.find((workflow) => workflow.id === selectedWorkflowId)
    : undefined;
  const prepared = lastPrepared && lastPrepared.sessionId === sessionId && lastPrepared.packId === value?.packId ? lastPrepared : null;
  const preparedWorkflow = selectedPack?.workflows.find((workflow) => workflow.id === prepared?.workflowId);

  useEffect(() => {
    setLastPrepared(null);
    if (!open || !sessionId || !value?.packId) return;
    let cancelled = false;
    const readPrepared = async () => {
      try {
        const result = await window.electronAPI.experiencePacks.getTask(sessionId);
        if (!cancelled) setLastPrepared(result.snapshot);
      } catch {
        // Do not turn unavailable diagnostics into a claimed loaded state.
      }
    };
    void readPrepared();
    return () => { cancelled = true; };
  }, [open, sessionId, value?.packId]);
  const override = useMemo(() => selectedOverride(value), [value]);

  const loadPacks = useCallback(async () => {
    setLoadingPacks(true);
    setPackError(false);
    try {
      const result = await window.electronAPI.experiencePacks.list();
      setPacks(result.packs);
    } catch {
      setPackError(true);
    } finally {
      setLoadingPacks(false);
    }
  }, []);

  const indexByPackRef = useRef(indexByPack);
  indexByPackRef.current = indexByPack;
  const loadIndex = useCallback(async (packId: string) => {
    const current = indexByPackRef.current[packId];
    if (current?.status === 'loading' || current?.status === 'ready') return;
    setIndexByPack((previous) => ({
      ...previous,
      [packId]: { status: 'loading', index: null },
    }));
    try {
      const result = await window.electronAPI.experiencePacks.get(packId);
      setIndexByPack((previous) => ({
        ...previous,
        [packId]: result.index
          ? { status: 'ready', index: result.index }
          : { status: 'error', index: null },
      }));
    } catch (error) {
      setIndexByPack((previous) => ({
        ...previous,
        [packId]: {
          status: 'error',
          index: null,
          message: error instanceof Error ? error.message : undefined,
        },
      }));
    }
  }, []);

  useEffect(() => {
    void loadPacks();
    const dispose = window.electronAPI.experiencePacks.onChanged((payload) => {
      setPacks(payload.packs);
      indexByPackRef.current = {};
      setIndexByPack({});
      if (selectedPackId) void loadIndex(selectedPackId);
    });
    return dispose;
  }, [loadPacks, loadIndex, open, selectedPackId]);

  useEffect(() => {
    if (!selectedPackId) return;
    void loadIndex(selectedPackId);
  }, [loadIndex, open, selectedPackId]);

  useEffect(() => {
    setLocalPackId(value?.packId ?? null);
  }, [value?.packId]);

  const choosePack = useCallback((packId: string) => {
    setLocalPackId(packId);
    if (value?.packId === packId) return;
    const next = EMPTY_SELECTION(packId);
    onChange(next, { explicitClear: false });
  }, [onChange, value]);

  const chooseNone = useCallback(() => {
    setLocalPackId(null);
    onChange(undefined, { explicitClear: true });
    setOpen(false);
  }, [onChange, setOpen]);

  const chooseAuto = useCallback(() => {
    if (!selectedPackId) return;
    const next = EMPTY_SELECTION(selectedPackId);
    onChange(next, { explicitClear: false });
  }, [onChange, selectedPackId]);

  const chooseExplicit = useCallback(() => {
    if (!selectedPackId || value?.mode === 'explicit') return;
    const current = EMPTY_SELECTION(selectedPackId);
    const next: ExperienceSelectionSnapshot = { ...current, mode: 'explicit' };
    onChange(next, { explicitClear: false });
  }, [onChange, selectedPackId, value]);

  const chooseWorkflow = useCallback((workflowId: string) => {
    if (!selectedPackId || !workflowIsSelectable(selectedPack, workflowId)) return;
    const current = value?.workflowId === workflowId ? value : EMPTY_SELECTION(selectedPackId);
    const next: ExperienceSelectionSnapshot = { ...current, mode: 'explicit', workflowId };
    onChange(next, { explicitClear: false });
  }, [onChange, selectedPack, selectedPackId, value]);

  const updateIgnored = useCallback((kind: 'node' | 'module', id: string) => {
    if (!value || value.mode !== 'explicit' || !value.workflowId) return;
    const ids = kind === 'node' ? [...value.ignoredNodeIds] : [...value.ignoredModuleIds];
    const has = ids.includes(id);
    const nextIds = has ? ids.filter((item) => item !== id) : [...ids, id];
    const next = kind === 'node'
      ? { ...value, ignoredNodeIds: nextIds }
      : { ...value, ignoredModuleIds: nextIds };
    onChange(next, { explicitClear: false });
  }, [onChange, value]);

  const triggerLabel = value && selectedPack
    ? `${text ?? t('newChat.chatInput.projectExperience.button')} · ${selectedPack.name}`
    : text ?? t('newChat.chatInput.projectExperience.button');
  const triggerSummary = value?.mode === 'explicit' && selectedWorkflow
    ? selectedWorkflow.name
    : value?.mode === 'explicit'
      ? t('newChat.chatInput.projectExperience.chooseWorkflow')
      : value
      ? t('newChat.chatInput.projectExperience.auto')
      : t('newChat.chatInput.projectExperience.none');
  const workflowStatusById = useMemo(
    () => new Map((selectedPack?.workflows ?? []).map((workflow) => [workflow.id, workflow.status])),
    [selectedPack],
  );
  const moduleMap = useMemo(
    () => new Map((selectedIndex?.modules ?? []).map((module) => [module.id, module])),
    [selectedIndex],
  );
  const moduleIds = selectedWorkflow && selectedIndex ? workflowModules(selectedWorkflow, selectedIndex) : [];
  const moduleRoles = selectedWorkflow && selectedIndex
    ? workflowModuleRoles(selectedWorkflow, selectedIndex)
    : { required: new Set<string>(), optional: new Set<string>() };
  const resolvedNodeById = useMemo(
    () => new Map((resolvedPlan?.nodes ?? []).map((node) => [node.id, node])),
    [resolvedPlan],
  );
  const resolvedModuleById = useMemo(() => {
    const result = new Map<string, ExperienceContextPlan['nodes'][number]['modules'][number]>();
    for (const node of resolvedPlan?.nodes ?? []) {
      for (const module of node.modules) {
        const previous = result.get(module.id);
        if (!previous || previous.state === 'enabled' || module.state !== 'enabled') result.set(module.id, module);
      }
    }
    return result;
  }, [resolvedPlan]);

  useEffect(() => {
    if (!open || !selectedIndex || !value || value.mode !== 'explicit' || !value.workflowId) {
      setResolvedPlan(null);
      setResolveMessage(null);
      setResolving(false);
      return;
    }
    let cancelled = false;
    setResolving(true);
    setResolveMessage(null);
    const resolveSelection = async (): Promise<void> => {
      try {
        const result = await window.electronAPI.experiencePacks.resolve({ text: '', selection: value });
        if (cancelled) return;
        setResolvedPlan(result.plan);
        setResolveMessage(result.reason ?? null);
      } catch (error) {
        if (cancelled) return;
        setResolvedPlan(null);
        setResolveMessage(error instanceof Error ? error.message : null);
      } finally {
        if (!cancelled) setResolving(false);
      }
    };
    void resolveSelection();
    return () => {
      cancelled = true;
    };
  }, [open, selectedIndex, value]);

  return (
    <MorphPopover
      open={open}
      onOpenChange={setOpen}
      panelWidth={430}
      panelClassName="p-0"
      panelAriaLabel={t('newChat.chatInput.projectExperience.menuAria')}
      endBg="var(--surface-elevated)"
      endBorderColor="var(--border-default)"
      wrapperClassName="shrink-0"
      trigger={
        <Tip text={triggerSummary} side="top">
          <button
            type="button"
            disabled={disabled}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setOpen(!open)}
            aria-label={triggerLabel}
            aria-expanded={open}
            aria-haspopup="dialog"
            className={cn(
              'flex h-[30px] min-w-0 max-w-[210px] shrink items-center gap-1 rounded-full border border-transparent px-2.5',
              'bg-transparent text-[var(--text-primary)] transition-colors',
              'hover:border-[var(--border-default)] hover:bg-[var(--surface-hover-soft)]',
              'disabled:cursor-not-allowed disabled:opacity-50',
              open && 'border-[var(--border-default)] bg-[var(--surface-hover-soft)]',
              dense && 'text-12',
              isCreateAgentVariant && 'text-12',
            )}
          >
            <FolderOpen size={dense || isCreateAgentVariant ? 13 : 14} className="shrink-0" />
            <span className="min-w-0 truncate">{triggerLabel}</span>
            <ChevronDown size={dense || isCreateAgentVariant ? 12 : 13} className="shrink-0" />
          </button>
        </Tip>
      }
    >
      <div className="flex max-h-[min(620px,calc(100vh-32px))] min-w-0 flex-col overflow-hidden text-[var(--text-primary)]">
        <div className="flex items-center justify-between border-b border-[var(--border-default)] px-4 py-3">
          <div className="min-w-0">
            <div className="text-13 font-medium">{t('newChat.chatInput.projectExperience.title')}</div>
            <div className="mt-0.5 truncate text-11 text-[var(--text-secondary)]">{triggerSummary}</div>
          </div>
          {value ? (
            <button
              type="button"
              className="rounded-full p-1 text-[var(--text-secondary)] hover:bg-[var(--surface-hover-soft)] hover:text-[var(--text-primary)]"
              aria-label={t('newChat.chatInput.projectExperience.clear')}
              onClick={chooseNone}
            >
              <X size={14} />
            </button>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 py-3">
          <div className="flex flex-col gap-1" role="listbox" aria-label={t('newChat.chatInput.projectExperience.pack')}>
            <div className="text-11 font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              {t('newChat.chatInput.projectExperience.pack')}
            </div>
            <button
              type="button"
              role="option"
              aria-selected={!value}
              onClick={chooseNone}
              className={cn(
                'flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-13 hover:bg-[var(--surface-hover-soft)]',
                !value && 'bg-[var(--surface-hover-soft)]',
              )}
            >
              <span className="flex h-5 w-5 items-center justify-center">
                {!value ? <Check size={14} /> : null}
              </span>
              <span>{t('newChat.chatInput.projectExperience.none')}</span>
            </button>
            {loadingPacks && packs.length === 0 ? (
              <div className="px-2.5 py-2 text-12 text-[var(--text-secondary)]">{t('newChat.chatInput.projectExperience.loading')}</div>
            ) : null}
            {packError ? (
              <div className="flex items-center gap-2 px-2.5 py-2 text-12 text-[var(--text-secondary)]">
                <CircleAlert size={14} className="shrink-0 text-[var(--warning-fg)]" />
                <span>{t('newChat.chatInput.projectExperience.loadFailed')}</span>
              </div>
            ) : null}
            {!loadingPacks && packs.length === 0 && !packError ? (
              <div className="px-2.5 py-2 text-12 text-[var(--text-secondary)]">{t('newChat.chatInput.projectExperience.noPacks')}</div>
            ) : null}
            {packs.map((pack) => (
              <button
                key={pack.packId}
                type="button"
                role="option"
                aria-selected={value?.packId === pack.packId}
                disabled={pack.status !== 'ready'}
                onClick={() => choosePack(pack.packId)}
                className={cn(
                  'flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--surface-hover-soft)] disabled:cursor-not-allowed disabled:opacity-50',
                  value?.packId === pack.packId && 'bg-[var(--surface-hover-soft)]',
                )}
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center">
                  {value?.packId === pack.packId ? <Check size={14} /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-13">{pack.name}</span>
                  <span className="block truncate text-11 text-[var(--text-secondary)]">
                    {t('newChat.chatInput.projectExperience.version', { version: pack.packVersion })}
                  </span>
                </span>
                {pack.status !== 'ready' ? (
                  <span className="shrink-0 text-11 text-[var(--text-secondary)]">{stateLabel(t, 'unavailable')}</span>
                ) : null}
              </button>
            ))}
          </div>

          {selectedPack && value ? (
            <>
              <div className="flex flex-col gap-1" role="radiogroup" aria-label={t('newChat.chatInput.projectExperience.mode')}>
                <div className="text-11 font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                  {t('newChat.chatInput.projectExperience.mode')}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(['auto', 'explicit'] as const).map((mode) => {
                    const selected = value.mode === mode;
                    const label = t(`newChat.chatInput.projectExperience.${mode}`);
                    const change = mode === 'auto' ? chooseAuto : chooseExplicit;
                    const cardClass = cn('flex cursor-pointer items-center gap-2 rounded-full border px-3 py-2 text-12 transition-colors focus-within:ring-2 focus-within:ring-[var(--focus-ring)]', selected ? 'border-[var(--text-primary)] bg-[var(--surface-chip)] font-medium' : 'border-[var(--border-default)] bg-[var(--surface-elevated)] hover:bg-[var(--surface-hover-soft)]');
                    return (
                      <label key={mode} className={cardClass}>
                        <input type="radio" name={modeGroupId} aria-label={label} checked={selected} onChange={change} className="sr-only" />
                        <span aria-hidden="true" className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-current">
                          {selected ? <span className="h-2 w-2 rounded-full bg-current" /> : null}
                        </span>
                        <span>{label}</span>
                      </label>
                    );
                  })}
                </div>
                {value.mode === 'auto' ? (
                  <div className="rounded-xl bg-[var(--surface-sunken)] px-2.5 py-2 text-11 text-[var(--text-secondary)]">
                    {t('newChat.chatInput.projectExperience.autoHint')}
                  </div>
                ) : (
                  <div className="px-2.5 py-2 text-11 text-[var(--text-secondary)]">{t('newChat.chatInput.projectExperience.explicitHint')}</div>
                )}
              </div>

              {selectedIndex?.pack.requiredModules?.length ? (
                <div className="rounded-xl border border-[var(--border-default)] px-2.5 py-2 text-12">
                  {t('newChat.chatInput.projectExperience.baseEnabled')}
                </div>
              ) : null}

              {prepared ? (
                <details className="rounded-xl border border-[var(--border-default)] px-2.5 py-2 text-12">
                  <summary className="cursor-pointer rounded-full focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
                    {t('newChat.chatInput.projectExperience.lastPrepared', { workflow: preparedWorkflow?.name ?? prepared.workflowId })}
                  </summary>
                  <div className="mt-2 break-all text-11 text-[var(--text-secondary)]">
                    <div>{t('newChat.chatInput.projectExperience.preparedDetails', { version: prepared.packVersion, count: prepared.plan.moduleIds.length })}</div>
                    <div>{t('newChat.chatInput.projectExperience.preparedOnly')}</div>
                    <div className="mt-1">{prepared.planDigest}</div>
                  </div>
                </details>
              ) : null}

              {value.mode === 'explicit' ? (
              <div className="flex flex-col gap-1" role="listbox" aria-label={t('newChat.chatInput.projectExperience.workflow')}>
                <div className="text-11 font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                  {t('newChat.chatInput.projectExperience.workflow')}
                </div>
                {selectedPack.workflows.map((workflow) => {
                  const status = workflowStatusById.get(workflow.id) ?? 'pending';
                  const selected = value.mode === 'explicit' && value.workflowId === workflow.id;
                  return (
                    <button
                      key={workflow.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      disabled={status !== 'ready'}
                      onClick={() => chooseWorkflow(workflow.id)}
                      className={cn(
                        'flex min-w-0 items-start gap-2 rounded-lg px-2.5 py-2 text-left hover:bg-[var(--surface-hover-soft)] disabled:cursor-not-allowed disabled:opacity-50',
                        selected && 'bg-[var(--surface-hover-soft)]',
                      )}
                    >
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                        {selected ? <Check size={13} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-13">{workflow.name}</span>
                        <span className="mt-0.5 block text-11 leading-snug text-[var(--text-secondary)]">{workflow.summary}</span>
                      </span>
                      <span className="shrink-0 text-11 text-[var(--text-secondary)]">{stateLabel(t, status)}</span>
                    </button>
                  );
                })}
              </div>
              ) : null}

              {selectedIndexState?.status === 'loading' ? (
                <div className="text-12 text-[var(--text-secondary)]">{t('newChat.chatInput.projectExperience.loading')}</div>
              ) : null}
              {selectedIndexState?.status === 'error' ? (
                <div className="flex items-center gap-2 text-12 text-[var(--text-secondary)]">
                  <CircleAlert size={14} className="shrink-0 text-[var(--warning-fg)]" />
                  <span>{t('newChat.chatInput.projectExperience.loadFailed')}</span>
                </div>
              ) : null}
              {resolving ? (
                <div className="text-12 text-[var(--text-secondary)]">{t('newChat.chatInput.projectExperience.resolving')}</div>
              ) : null}
              {!resolving && resolveMessage ? (
                <div className="flex items-start gap-2 rounded-xl bg-[var(--surface-sunken)] px-2.5 py-2 text-11 text-[var(--text-secondary)]">
                  <CircleAlert size={14} className="mt-0.5 shrink-0 text-[var(--warning-fg)]" />
                  <span>{resolveMessage}</span>
                </div>
              ) : null}

              {selectedWorkflow && selectedIndex ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <div className="text-11 font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                      {t('newChat.chatInput.projectExperience.nodes')}
                    </div>
                    {value.mode === 'auto' ? (
                      <span className="text-11 text-[var(--text-secondary)]">{t('newChat.chatInput.projectExperience.autoHint')}</span>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-1">
                    {selectedWorkflow.nodes.map((node) => {
                      const ignored = override.nodeIds.has(node.id);
                      const nodePlan = resolvedNodeById.get(node.id);
                      return (
                        <div key={node.id} className="flex items-start gap-2 rounded-xl border border-[var(--border-default)] px-2.5 py-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5 text-12 font-medium">
                              <span className="truncate">{node.name}</span>
                              <span className="shrink-0 text-10 text-[var(--text-tertiary)]">
                                {nodePlan
                                  ? planStateLabel(t, nodePlan.state)
                                  : node.skippable
                                    ? t('newChat.chatInput.projectExperience.optional')
                                    : t('newChat.chatInput.projectExperience.required')}
                              </span>
                            </div>
                            <div className="mt-1 text-11 text-[var(--text-secondary)]">
                              {node.modules.length + node.optionalModules.length > 0
                                ? `${node.modules.length + node.optionalModules.length} ${t('newChat.chatInput.projectExperience.modules')}`
                                : t('newChat.chatInput.projectExperience.noModules')}
                            </div>
                            {nodePlan?.reasons[0] ? (
                              <div className="mt-1 text-10 leading-snug text-[var(--text-tertiary)]">{nodePlan.reasons[0]}</div>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            disabled={value.mode !== 'explicit' || !node.skippable}
                            aria-label={node.skippable ? t('newChat.chatInput.projectExperience.toggleNode', { name: node.name }) : t('newChat.chatInput.projectExperience.required')}
                            aria-pressed={ignored}
                            onClick={() => updateIgnored('node', node.id)}
                            className={cn(
                              'mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] text-[var(--text-secondary)]',
                              ignored && 'bg-[var(--surface-hover-soft)] text-[var(--text-primary)]',
                              'disabled:cursor-not-allowed disabled:opacity-40',
                            )}
                          >
                            {ignored ? <Minus size={12} /> : <Check size={12} />}
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="text-11 font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                      {t('newChat.chatInput.projectExperience.modules')}
                    </div>
                    {moduleIds.map((moduleId) => {
                      const module = moduleMap.get(moduleId);
                      if (!module) return null;
                      const isOptional = moduleRoles.optional.has(moduleId) && !moduleRoles.required.has(moduleId);
                      const ignored = override.moduleIds.has(moduleId);
                      const modulePlan = resolvedModuleById.get(moduleId);
                      const unavailable = module.status !== 'ready' || modulePlan?.state === 'unavailable';
                      return (
                        <div key={moduleId} className="flex items-start gap-2 rounded-lg px-2.5 py-1.5 hover:bg-[var(--surface-hover-soft)]">
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-12">{module.name}</div>
                            <div className="truncate text-11 text-[var(--text-secondary)]">{module.summary}</div>
                          </div>
                          <span className="shrink-0 text-10 text-[var(--text-tertiary)]">
                            {modulePlan
                              ? planStateLabel(t, modulePlan.state)
                              : unavailable
                                ? stateLabel(t, 'unavailable')
                                : isOptional
                                  ? t('newChat.chatInput.projectExperience.optional')
                                  : t('newChat.chatInput.projectExperience.required')}
                          </span>
                          <button
                            type="button"
                            disabled={value.mode !== 'explicit' || !isOptional || unavailable}
                            aria-label={t('newChat.chatInput.projectExperience.toggleModule', { name: module.name })}
                            aria-pressed={ignored}
                            onClick={() => updateIgnored('module', moduleId)}
                            className={cn(
                              'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--border-default)] text-[var(--text-secondary)]',
                              ignored && 'bg-[var(--surface-hover-soft)] text-[var(--text-primary)]',
                              'disabled:cursor-not-allowed disabled:opacity-40',
                            )}
                          >
                            {ignored ? <Minus size={12} /> : <Check size={12} />}
                          </button>
                          {modulePlan?.reason ? (
                            <span className="sr-only">{modulePlan.reason}</span>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-start gap-2 rounded-xl bg-[var(--surface-sunken)] px-2.5 py-2 text-11 text-[var(--text-secondary)]">
                    <CircleHelp size={14} className="mt-0.5 shrink-0" />
                    <span>{t('newChat.chatInput.projectExperience.mainOwnedHint')}</span>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </div>
    </MorphPopover>
  );
}
