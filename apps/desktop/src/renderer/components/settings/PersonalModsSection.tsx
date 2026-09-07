import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Switch } from '@/components/ui/switch';
import { composerModeDefinitions } from '@/features/composer-modes/registry';
import { ModErrorBoundary } from '@/features/composer-modes/ModErrorBoundary';
import { setComposerModePreference, useComposerModePreference } from '@/features/composer-modes/useComposerModePreference';
import { resetModDisplayOptions, setModDisplayOption, setPersonalModsEnabled, usePersonalModPreferences } from '@/features/composer-modes/usePersonalModPreferences';
import type { ComposerModeDefinition, ModDisplayOption } from '@/features/composer-modes/types';
import { refreshPersonalMod, useInstalledPersonalMod } from '@/features/composer-modes/useInstalledPersonalMod';
import type { InstalledPersonalMod } from '../../../shared/personalMod';

const CARD_CLASS = 'rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-5';

function ModOption({ id, option }: { id: ComposerModeDefinition['id']; option: ModDisplayOption }) {
  const { t } = useTranslation();
  const { display } = usePersonalModPreferences();
  const labelKey = `settings.personalMods.options.${option}`;
  const label = t(labelKey);
  const change = (enabled: boolean) => setModDisplayOption(id, option, enabled);
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-13 text-[var(--text-primary)]">{label}</span>
      <Switch checked={display[option]} onCheckedChange={change} aria-label={label} />
    </div>
  );
}

function PersonalModCard({ definition, mod, onRemove }: { definition: ComposerModeDefinition; mod: InstalledPersonalMod; onRemove: () => void }) {
  const { t } = useTranslation();
  const { enabled } = usePersonalModPreferences();
  const { selectedMode } = useComposerModePreference();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const selected = selectedMode === definition.id;
  const name = t(definition.nameKey);
  const settingsId = `mod-settings-${definition.id}`;
  const Preview = definition.preview;
  const toggle = (next: boolean) => {
    const mode = next ? definition.id : 'standard';
    setComposerModePreference(mode);
  };
  const toggleSettings = () => {
    const next = !settingsOpen;
    setSettingsOpen(next);
  };
  const togglePreview = () => {
    const next = !previewing;
    setPreviewing(next);
  };
  const finishPreview = () => setPreviewing(false);
  const reset = () => resetModDisplayOptions(definition.id);
  const statusKey = !selected ? 'disabled' : enabled ? 'enabled' : 'paused';
  const statusLabelKey = `settings.personalMods.${statusKey}`;
  const renderOption = (option: ModDisplayOption) => <ModOption key={option} id={definition.id} option={option} />;
  const optionElements = definition.options.map(renderOption);

  return (
    <section className={CARD_CLASS} aria-label={name}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h3 className="text-14 font-medium text-[var(--text-primary)]">{name}</h3>
          <p className="mt-1 text-12 text-[var(--text-secondary)]">{t(definition.descriptionKey)}</p>
          <p className="mt-2 text-12 text-[var(--text-tertiary)]">
            {t('settings.personalMods.imported')} · {t(definition.locationKey)} · {mod.version}
          </p>
          <p className="mt-1 text-12 text-[var(--text-secondary)]">{t(statusLabelKey)}</p>
        </div>
        <Switch checked={selected} onCheckedChange={toggle} aria-label={name} />
      </div>
      <div className="my-3 overflow-hidden rounded-xl border border-[var(--border-default)] bg-[var(--surface)]">
        {previewing ? <ModErrorBoundary><Preview onComplete={finishPreview} /></ModErrorBoundary>
          : <img src={mod.assets.ground} alt="" className="h-24 w-full object-contain" />}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button onClick={togglePreview}>{t(previewing ? 'settings.personalMods.stopPreview' : 'settings.personalMods.preview')}</Button>
        <Button variant="secondary" onClick={toggleSettings} aria-expanded={settingsOpen} aria-controls={settingsId}>
          {t('settings.personalMods.configure')}
        </Button>
        <Button variant="secondary" onClick={onRemove}>{t('settings.personalMods.remove')}</Button>
      </div>
      {settingsOpen && (
        <div id={settingsId} className="mt-4 border-t border-[var(--border-default)] pt-3">
          {optionElements}
          <Button variant="secondary" className="mt-3" onClick={reset}>{t('settings.defaults.restore')}</Button>
        </div>
      )}
    </section>
  );
}

export function PersonalModsSection() {
  const { t } = useTranslation();
  const { enabled } = usePersonalModPreferences();
  const { mod, loading, error: loadError } = useInstalledPersonalMod();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removeRevision, setRemoveRevision] = useState<string | null>(null);
  const requestRemove = () => {
    if (mod && !busy) setRemoveRevision(mod.revision);
  };
  const importPackage = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.personalMods.import();
      if (!result.ok) setError(result.error);
      else if (!result.canceled) await refreshPersonalMod();
    } catch { setError('failed'); }
    finally { setBusy(false); }
  };
  const removePackage = async () => {
    if (!removeRevision || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.personalMods.remove(removeRevision);
      if (!result.ok) setError(result.error);
      else await refreshPersonalMod();
    } catch { setError('failed'); }
    finally {
      setBusy(false);
      setRemoveRevision(null);
    }
  };
  const changeRemoveOpen = (open: boolean) => {
    if (!open && !busy) setRemoveRevision(null);
  };
  const renderCard = (definition: ComposerModeDefinition) => mod && definition.id === mod.id
    ? <PersonalModCard key={mod.revision} definition={definition} mod={mod} onRemove={requestRemove} /> : null;
  const cards = composerModeDefinitions.map(renderCard);
  const errorKey = `settings.personalMods.errors.${error ?? 'unavailable'}`;
  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-16 font-medium text-[var(--settings-section-title)]">{t('settings.tabs.personalMods')}</h2>
      <p className="text-12 text-[var(--text-secondary)]">{t('settings.personalMods.importHint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={importPackage} disabled={busy}>{t(busy ? 'settings.personalMods.working' : 'settings.personalMods.import')}</Button>
        {loadError && <Button variant="secondary" onClick={refreshPersonalMod}>{t('settings.personalMods.reload')}</Button>}
      </div>
      {(error || loadError) && <p role="alert" className="text-13 text-[var(--text-secondary)]">{t(errorKey)}</p>}
      <div className={CARD_CLASS}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-13 font-medium text-[var(--text-primary)]">{t('settings.personalMods.master')}</span>
          <Switch checked={enabled} onCheckedChange={setPersonalModsEnabled} aria-label={t('settings.personalMods.master')} />
        </div>
        <p className="mt-2 text-12 text-[var(--text-secondary)]">{t('settings.personalMods.hint')}</p>
      </div>
      {cards}
      {!mod && <p role="status" className="text-13 text-[var(--text-secondary)]">{t(loading ? 'settings.personalMods.loading' : 'settings.personalMods.empty')}</p>}
      <ConfirmDialog open={removeRevision !== null} onOpenChange={changeRemoveOpen} title={t('settings.personalMods.remove')}
        description={t('settings.personalMods.removeHint')} confirmText={t('settings.personalMods.remove')} loading={busy} onConfirm={removePackage} />
    </div>
  );
}
