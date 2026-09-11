import { useEffect, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import { Folder, Palette } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ThemeBrandLockup } from '@/components/branding/ThemeBrandLockup';
import { useTheme } from '@/hooks/useTheme';
import { getThemeFamilies, type ThemeFamily } from '@/themes/families';
import { buildCopyFromTheme, onLocalThemesChange, refreshLocalThemes } from '@/themes/local-themes';
import { isLocalThemeId, type LocalThemeDiagnostic } from '../../../shared/local-themes';
import { themePartEnabled } from '../../../shared/themeModParts';
import { applyThemeModParts, availableThemeParts } from '@/themes/mod-parts';
import { resetThemeModParts, setThemeModPart, useThemeModOptions } from '@/themes/mod-preferences';
import type { Theme } from '@/themes/types';
import { ThemeModNameField } from './ThemeModNameField';
import { ModListRow, ModRowActions, type ModAction } from './ModListRow';

function ThemePreview({ theme }: { theme: Theme }) {
  const { t } = useTranslation();
  const style: CSSProperties & Record<string, string> = {};
  for (const [id, value] of Object.entries(theme.colors)) {
    if (value !== undefined) style[`--${id}`] = value;
  }
  return <div style={style} className="flex min-h-40 flex-col gap-4 rounded-xl border border-[var(--border-default)] bg-[var(--surface)] p-5 text-[var(--text-primary)]">
    <ThemeBrandLockup theme={theme} />
    <div className="flex items-center gap-2 text-13">
      <Folder size={16} className="text-[var(--sidebar-project-icon)]" />
      <span className="text-[var(--sidebar-project-name)]">{t('settings.personalMods.theme.sampleProject')}</span>
    </div>
    <p className="text-13">{theme.mod?.assistantName ?? t('settings.personalMods.theme.sampleAssistant')}</p>
  </div>;
}


function ThemeModRow({ family, onError }: { family: ThemeFamily; onError: (message: string) => void }) {
  const { t } = useTranslation();
  const { familyId, setFamily } = useTheme();
  const options = useThemeModOptions(family.id);
  const [preview, setPreview] = useState(false);
  const [mode, setMode] = useState<'light' | 'dark'>('dark');
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const rawTheme = family[mode] ?? family.light ?? family.dark!;
  const theme = applyThemeModParts(rawTheme, options);
  const mod = rawTheme.mod;
  const variants = [family.light, family.dark];
  const available = availableThemeParts(variants);
  const selected = familyId === family.id;
  const toggle = (enabled: boolean) => { if (enabled) setFamily(family.id); else if (selected) setFamily('cindy'); };
  const togglePreview = () => setPreview(!preview);
  const toggleMode = () => setMode(mode === 'dark' ? 'light' : 'dark');
  const reset = () => resetThemeModParts(family.id);
  const open = async () => {
    try {
      const request = { action: 'open' as const, directory: mod?.directory ?? '' };
      const result = mod?.directory ? await window.electronAPI.personalMods.manageDirectory?.(request) : await window.electronAPI.localThemes.openDir();
      if (result && !result.success) onError(result.error);
    } catch { onError(t('settings.personalMods.errors.failed')); }
  };
  const copy = async () => {
    setBusy(true);
    try {
      if (mod?.source === 'builtin') {
        const result = await window.electronAPI.personalMods.exportExample?.('theme');
        if (!result?.success) throw new Error('copy failed');
      } else if (mod?.directory) {
        const request = { action: 'copy' as const, directory: mod.directory };
        const result = await window.electronAPI.personalMods.manageDirectory?.(request);
        if (!result?.success) throw new Error('copy failed');
      } else {
        const request = buildCopyFromTheme(rawTheme);
        const result = await window.electronAPI.localThemes.write(request);
        if (!result.success) throw new Error('copy failed');
        await window.electronAPI.localThemes.openDir();
      }
      await refreshLocalThemes();
    } catch { onError(t('settings.personalMods.errors.failed')); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!mod?.directory || busy) return;
    setBusy(true);
    try {
      const request = { action: 'uninstall' as const, directory: mod.directory };
      const result = await window.electronAPI.personalMods.manageDirectory?.(request);
      if (!result?.success) throw new Error('remove failed');
      if (selected) setFamily('cindy');
      await refreshLocalThemes();
      setRemoving(false);
    } catch { onError(t('settings.personalMods.errors.failed')); }
    finally { setBusy(false); }
  };
  const askRemove = () => setRemoving(true);
  const local = isLocalThemeId(family.id);
  const source = t(local ? 'settings.personalMods.local' : 'settings.personalMods.builtin');
  const detail = source + (mod ? ' · ' + mod.version : '');
  const actions: ModAction[] = [{ label: t('settings.personalMods.copy'), run: copy, disabled: busy }, { label: t('settings.personalMods.theme.reload'), run: refreshLocalThemes }];
  if (local) actions.push({ label: t('settings.personalMods.openDirectory'), run: open });
  if (mod?.directory) actions.push({ label: t('settings.personalMods.remove'), run: askRemove, disabled: busy });
  const menu = <ModRowActions name={family.name} actions={actions} />;
  const parts = available.map(part => {
    const change = (next: boolean) => setThemeModPart(family.id, part, next);
    const labelKey = 'settings.personalMods.parts.' + part;
    const label = t(labelKey);
    const enabled = themePartEnabled(options, part);
    return <div key={part} data-theme-part={part}>
      <div className="flex items-center justify-between gap-4 py-2"><span className="text-13 text-[var(--text-primary)]">{label}</span><Switch checked={enabled} onCheckedChange={change} aria-label={label} /></div>
      {(part === 'appName' || part === 'assistantName') && <ThemeModNameField familyId={family.id} field={part} placeholder={part === 'appName' ? mod?.appDisplayName : mod?.assistantName} />}
    </div>;
  });
  const empty = available.every(part => !themePartEnabled(options, part));
  return <ModListRow name={family.name} detail={detail} icon={<Palette size={20} />} enabled={selected} empty={empty} busy={busy} builtin={!local} onEnabledChange={toggle} actions={menu}>
    {parts}
    <div className="flex flex-wrap gap-2"><Button variant="secondary" onClick={togglePreview}>{t('settings.personalMods.theme.preview')}</Button><Button variant="secondary" onClick={reset}>{t('settings.personalMods.resetParts')}</Button></div>
    {preview && <div className="flex flex-col gap-3"><Button variant="secondary" onClick={toggleMode}>{t(mode === 'dark' ? 'settings.appearance.theme.light' : 'settings.appearance.theme.dark')}</Button><ThemePreview theme={theme} /></div>}
    <ConfirmDialog open={removing} onOpenChange={setRemoving} title={t('settings.personalMods.remove')} description={t('settings.personalMods.theme.removeHint')} confirmText={t('settings.personalMods.remove')} loading={busy} onConfirm={remove} />
  </ModListRow>;
}

export function ThemeModsSection() {
  const { t } = useTranslation();
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [diagnostics, setDiagnostics] = useState<LocalThemeDiagnostic[]>([]);
  const [disabled, setDisabled] = useState<string[]>([]);
  const refresh = async () => {
    try {
      const result = await refreshLocalThemes();
      setDiagnostics(result.diagnostics);
      if (result.success) setDisabled(result.disabledPacks ?? []);
      setError(result.success ? '' : result.error);
    } catch { setError(t('settings.personalMods.errors.failed')); }
  };
  useEffect(() => {
    const update = () => { setRevision(current => current + 1); void refresh(); };
    const unsubscribe = onLocalThemesChange(update);
    void refresh(); return unsubscribe;
  }, []);
  const add = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await window.electronAPI.personalMods.importThemeDirectory?.();
      if (!result?.success) throw new Error('import failed');
      if (!result.canceled) await refresh();
    } catch { setError(t('settings.personalMods.errors.failed')); }
    finally { setBusy(false); }
  };
  const open = async () => { try { await window.electronAPI.localThemes.openDir(); } catch { setError(t('settings.personalMods.errors.failed')); } };
  void revision;
  const all = getThemeFamilies();
  const families = all.filter(family => family.id !== 'cindy');
  const rows = families.map(family => <ThemeModRow key={family.id} family={family} onError={setError} />);
  const notices = diagnostics.map(item => <p key={item.file} className="text-12 text-[var(--text-secondary)]">{item.file}: {item.error}</p>);
  const restoreButtons = disabled.map(directory => {
    const restore = async () => {
      try { const request = { action: 'restore' as const, directory }; const result = await window.electronAPI.personalMods.manageDirectory?.(request); if (!result?.success) throw new Error('restore failed'); await refresh(); }
      catch { setError(t('settings.personalMods.errors.failed')); }
    };
    return <Button key={directory} variant="secondary" onClick={restore}>{t('settings.personalMods.theme.restore', { name: directory })}</Button>;
  });
  return <div className="flex flex-col gap-3" data-mod-category="theme">
    <div className="flex flex-wrap gap-2"><Button onClick={add} loading={busy}>{t('settings.personalMods.addTheme')}</Button><Button variant="secondary" onClick={open}>{t('settings.personalMods.openDirectory')}</Button><Button variant="secondary" onClick={refresh}>{t('settings.personalMods.theme.reload')}</Button></div>
    {error && <p role="alert" className="text-13 text-[var(--error-fg)]">{error}</p>}
    {notices}{rows}{restoreButtons}
    <p className="text-12 text-[var(--text-secondary)]">{t('settings.personalMods.baseHint')}</p>
  </div>;
}
