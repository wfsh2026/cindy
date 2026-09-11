import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { saveModIdentity, useModIdentity, useModPresentation } from '@/features/composer-modes/useModIdentity';
import { themeService } from '@/themes/theme-service';
import { normalizeModIdentity, type ModIdentity } from '../../../shared/modIdentity';

export function ModIdentitySettings() {
  const { t } = useTranslation();
  const identity = useModIdentity();
  const presentation = useModPresentation();
  const [draft, setDraft] = useState<ModIdentity>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    setDraft(identity);
  }, [identity]);
  const save = async (next: ModIdentity) => {
    if (busy) return;
    const normalized = normalizeModIdentity(next);
    if ((next.appName?.trim() && !normalized.appName) || (next.assistantName?.trim() && !normalized.assistantName)) { setError(true); return; }
    setBusy(true);
    setError(false);
    try { await saveModIdentity(normalized); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  const submit = () => { void save(draft); };
  const reset = () => { const empty = {}; void save(empty); };
  const fromTheme = () => {
    const theme = themeService.getCurrentTheme();
    const next = theme?.mod ? { themeId: theme.mod.id } : {};
    void save(next);
  };
  return <section className="rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)] p-5">
    <h3 className="text-14 font-medium text-[var(--text-primary)]">{t('settings.personalMods.identity.title')}</h3>
    <p className="mt-2 text-12 text-[var(--text-secondary)]">{t('settings.personalMods.identity.hint')}</p>
    <div className="my-4 flex flex-col gap-3">
      <label className="flex flex-col gap-2 text-13 text-[var(--text-primary)]">{t('settings.personalMods.identity.appName')}
        <Input value={draft.appName ?? ''} placeholder={presentation.appName} maxLength={40} onChange={value => setDraft({ ...draft, themeId: undefined, appName: value })} />
      </label>
      <label className="flex flex-col gap-2 text-13 text-[var(--text-primary)]">{t('settings.personalMods.identity.assistantName')}
        <Input value={draft.assistantName ?? ''} placeholder={presentation.assistantName} maxLength={40} onChange={value => setDraft({ ...draft, themeId: undefined, assistantName: value })} />
      </label>
    </div>
    <div className="flex flex-wrap gap-2">
      <Button onClick={submit} loading={busy}>{t('settings.personalMods.identity.save')}</Button>
      <Button onClick={fromTheme} disabled={busy} variant="secondary">{t('settings.personalMods.identity.fromTheme')}</Button>
      <Button onClick={reset} disabled={busy} variant="secondary">{t('settings.personalMods.identity.reset')}</Button>
    </div>
    {error && <p role="alert" className="mt-3 text-12 text-[var(--error-fg)]">{t('settings.personalMods.identity.error')}</p>}
  </section>;
}
