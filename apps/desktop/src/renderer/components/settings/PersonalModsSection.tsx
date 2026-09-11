import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ChevronRight, Palette, Swords } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Switch } from '@/components/ui/switch';
import { useTheme } from '@/hooks/useTheme';
import { ModErrorBoundary } from '@/features/composer-modes/ModErrorBoundary';
import { CartethyiaBattlePreview } from '@/features/composer-modes/cartethyia-battle/CartethyiaBattleStage';
import { builtinBattleMod } from '@/features/composer-modes/builtinBattleMod';
import { setComposerModePreference, useComposerModePreference } from '@/features/composer-modes/useComposerModePreference';
import { DEFAULT_MOD_DISPLAY, resetModDisplayOptions, setModDisplayOption, setPersonalModsEnabled, setCharacterSource, usePersonalModPreferences } from '@/features/composer-modes/usePersonalModPreferences';
import { refreshPersonalMod, useInstalledPersonalMod } from '@/features/composer-modes/useInstalledPersonalMod';
import { useAvailablePersonalMod } from '@/features/composer-modes/useAvailablePersonalMod';
import type { ModDisplayOption } from '@/features/composer-modes/types';
import type { InstalledPersonalMod } from '../../../shared/personalMod';
import { ThemeModsSection } from './ThemeModsSection';
import { ModListRow, ModRowActions, type ModAction } from './ModListRow';

function CharacterModRow({ mod, builtin, onRemove }: { mod: InstalledPersonalMod; builtin: boolean; onRemove?: () => void }) {
  const { t } = useTranslation();
  const available = useAvailablePersonalMod();
  const { selectedMode } = useComposerModePreference();
  const { enabled, display } = usePersonalModPreferences(mod.id);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState(false);
  const selected = available.builtin === builtin && selectedMode === 'cartethyia-battle' && enabled;
  const name = mod.name ?? t('settings.personalMods.cartethyiaName');
  const sourceLabel = t(builtin ? 'settings.personalMods.builtin' : 'settings.personalMods.imported');
  const detail = sourceLabel + ' · ' + mod.version;
  const toggle = (next: boolean) => {
    if (next) { setCharacterSource(builtin ? 'builtin' : 'imported'); setComposerModePreference('cartethyia-battle'); setPersonalModsEnabled(true); }
    else if (selected) setComposerModePreference('standard');
  };
  const reset = () => resetModDisplayOptions(mod.id);
  const togglePreview = () => setPreview(!preview);
  const finishPreview = () => setPreview(false);
  const copy = async () => {
    try { const result = await window.electronAPI.personalMods.exportExample?.('battle'); setError(!result?.success); }
    catch { setError(true); }
  };
  const actions: ModAction[] = [{ label: t('settings.personalMods.createExample'), run: copy }, { label: t('settings.personalMods.reload'), run: refreshPersonalMod }];
  if (onRemove) actions.push({ label: t('settings.personalMods.remove'), run: onRemove });
  const menu = <ModRowActions name={name} actions={actions} />;
  const keys = Object.keys(DEFAULT_MOD_DISPLAY) as ModDisplayOption[];
  const parts = keys.map(key => {
    const change = (next: boolean) => setModDisplayOption(mod.id, key, next);
    const labelKey = 'settings.personalMods.options.' + key;
    const label = t(labelKey);
    return <div key={key} className="flex items-center justify-between gap-4 py-2"><span className="text-13 text-[var(--text-primary)]">{label}</span><Switch checked={display[key]} onCheckedChange={change} aria-label={label} /></div>;
  });
  const empty = keys.every(key => !display[key]);
  return <ModListRow name={name} detail={detail} icon={<Swords size={20} />} enabled={selected} empty={empty} builtin={builtin} onEnabledChange={toggle} actions={menu}>
    {parts}
    <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={togglePreview}>{t(preview ? 'settings.personalMods.stopPreview' : 'settings.personalMods.preview')}</Button><Button variant="secondary" onClick={reset}>{t('settings.personalMods.resetParts')}</Button></div>
    {preview && <ModErrorBoundary><CartethyiaBattlePreview mod={mod} onComplete={finishPreview} /></ModErrorBoundary>}
    {error && <p role="alert" className="text-12 text-[var(--error-fg)]">{t('settings.personalMods.errors.failed')}</p>}
  </ModListRow>;
}

function CharacterModsList() {
  const { t } = useTranslation();
  const installed = useInstalledPersonalMod();
  const available = useAvailablePersonalMod();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorKey = 'settings.personalMods.errors.' + error;
  const [removal, setRemoval] = useState<string | null>(null);
  const importMod = async (folder: boolean) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const api = window.electronAPI.personalMods;
      const result = folder ? await api.importDirectory?.() : await api.import();
      if (!result?.ok) setError(result?.error ?? 'failed');
      else if (!result.canceled) { setCharacterSource(available.builtin ? 'builtin' : 'imported'); await refreshPersonalMod(); }
    } catch { setError('failed'); }
    finally { setBusy(false); }
  };
  const importFile = () => { void importMod(false); };
  const importFolder = () => { void importMod(true); };
  const requestRemove = () => { if (installed.mod) setRemoval(installed.mod.revision); };
  const remove = async () => {
    if (!removal || busy) return;
    setBusy(true);
    try {
      const result = await window.electronAPI.personalMods.remove(removal);
      if (!result.ok) setError(result.error); else { await refreshPersonalMod(); setRemoval(null); }
    } catch { setError('failed'); }
    finally { setBusy(false); }
  };
  return <div data-mod-category="character" className="flex flex-col gap-3">
    <div className="flex flex-wrap gap-2"><Button onClick={importFile} disabled={busy}>{t('settings.personalMods.import')}</Button><Button variant="secondary" onClick={importFolder} disabled={busy}>{t('settings.personalMods.importDirectory')}</Button><Button variant="secondary" onClick={refreshPersonalMod}>{t('settings.personalMods.reload')}</Button></div>
    {error && <p role="alert" className="text-13 text-[var(--error-fg)]">{t(errorKey)}</p>}
    <CharacterModRow mod={builtinBattleMod} builtin />
    {installed.mod && <CharacterModRow mod={installed.mod} builtin={false} onRemove={requestRemove} />}
    <ConfirmDialog open={removal !== null} onOpenChange={open => { if (!open && !busy) setRemoval(null); }} title={t('settings.personalMods.remove')} description={t('settings.personalMods.removeHint')} confirmText={t('settings.personalMods.remove')} loading={busy} onConfirm={remove} />
  </div>;
}

export function PersonalModsSection() {
  const { t } = useTranslation();
  const { familyId } = useTheme();
  const { mode } = useComposerModePreference();
  const [category, setCategory] = useState<'theme' | 'character' | null>(null);
  const back = () => setCategory(null);
  const categories = ['theme', 'character'] as const;
  const entries = categories.map(value => {
    const enter = () => setCategory(value);
    const count = value === 'theme' ? Number(familyId !== 'cindy') : Number(mode !== 'standard');
    const labelKey = 'settings.personalMods.categories.' + value;
    const label = t(labelKey);
    return <button key={value} type="button" onClick={enter} className="flex min-h-16 w-full items-center gap-4 rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] px-5 py-4 text-left hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]" aria-label={label}>
      {value === 'theme' ? <Palette size={22} className="text-[var(--text-secondary)]" /> : <Swords size={22} className="text-[var(--text-secondary)]" />}
      <span className="flex-1 text-14 font-medium text-[var(--text-primary)]">{label}</span><span className="text-12 text-[var(--text-secondary)]">{t('settings.personalMods.enabledCount', { count })}</span><ChevronRight size={16} className="text-[var(--text-secondary)]" />
    </button>;
  });
  return <div className="flex flex-col gap-4">
    <div className="flex items-center gap-3">{category && <Button onClick={back} variant="secondary" aria-label={t('settings.personalMods.back')}><ArrowLeft size={16} /></Button>}<h2 className="text-16 font-medium text-[var(--settings-section-title)]">{t(category ? 'settings.personalMods.categories.' + category : 'settings.tabs.personalMods')}</h2></div>
    {category === null ? entries : category === 'theme' ? <ThemeModsSection /> : <CharacterModsList />}
  </div>;
}
