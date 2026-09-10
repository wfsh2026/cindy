import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocale } from '@/hooks/useLocale';
import { UpdateNoticeDialog } from './UpdateNoticeDialog';
import { fetchReleaseNotes, fetchReleaseNotesIndex, type ReleaseNotes } from '@/release-notes';
import { officialNoticeVersions } from '@/lib/officialNoticePresentation';
import { toast } from '@/lib/toast';
import type { OfficialNoticeAction, OfficialUpdateSnapshot } from '../../shared/personalBuildInfo';

interface Props {
  open: boolean;
  official?: OfficialUpdateSnapshot;
  onDismiss: () => void;
  act: (action: OfficialNoticeAction) => Promise<boolean>;
}

const actionClass = 'rounded-full border border-[var(--border-default)] px-3 py-2 text-13 text-[var(--text-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]';

export function OfficialUpdateNotice({ open, official, onDismiss, act }: Props) {
  const { t } = useTranslation();
  const { effectiveLocale } = useLocale();
  const info = window.electronAPI.personalBuildInfo;
  const personalVersion = window.electronAPI.appVersion;
  const [personalUnread, setPersonalUnread] = useState(() => {
    try { return localStorage.getItem('cartethyia:personal-notes-read') !== personalVersion; }
    catch { return true; }
  });
  const [notes, setNotes] = useState<ReleaseNotes[]>([]);
  const [loading, setLoading] = useState(false);
  const [personalView, setPersonalView] = useState(false);
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const latest = official?.latestVersion ?? info?.upstreamVersion ?? '';
  const baseline = info?.upstreamVersion ?? '';
  const placeholder = useCallback((version: string): ReleaseNotes => ({ version, date: '', contributors: [], sections: [], topics: [{ title: t('update.official.title'), text: t('update.official.notesPending'), contributors: [] }] }), [t]);
  const loadVersion = useCallback((version: string) => fetchReleaseNotes(version, effectiveLocale), [effectiveLocale]);

  useEffect(() => {
    if (!open || !info) return;
    let cancelled = false;
    setLoading(true);
    const pending = placeholder(latest);
    setNotes([pending]);
    const load = async () => {
      const index = await fetchReleaseNotesIndex();
      const range = { baseline, latest };
      const versions = officialNoticeVersions(index, range);
      // Bound concurrency for users who have skipped many releases.
      const loaded: ReleaseNotes[] = [];
      for (let offset = 0; offset < versions.length; offset += 4) {
        const batch = versions.slice(offset, offset + 4);
        const requests = batch.map(loadVersion);
        const results = await Promise.allSettled(requests);
        if (cancelled) return;
        for (const [index, result] of results.entries()) {
          const note = result.status === 'fulfilled' ? result.value : null;
          const entry = note ?? placeholder(batch[index]);
          loaded.push(entry);
        }
        setNotes([...loaded]);
      }
    };
    void load().catch(() => {}).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, info, baseline, latest, loadVersion, placeholder, retry]);

  if (!info) return null;
  const personalNotes: ReleaseNotes = {
    version: personalVersion, date: '', contributors: [], sections: [],
    topics: info.changeKeys.map((key) => ({ id: key, title: t(`update.personal.changes.${key}.title`), text: t(`update.personal.changes.${key}.text`), contributors: [] })),
  };
  const pending = placeholder(latest);
  const visibleNotes = personalView ? [personalNotes] : notes.length ? notes : [pending];
  const title = t(personalView ? 'update.personal.title' : 'update.official.title');
  const openWebsite = () => {
    const url = 'https://github.com/makecindy/cindy/releases';
    void window.electronAPI.openExternal(url);
  };
  const copy = async () => {
    const context = { personal: personalVersion, baseline, latest, commit: info.upstreamCommit, url: 'https://github.com/makecindy/cindy/releases' };
    const content = t('update.official.syncRequest', context);
    try { await navigator.clipboard.writeText(content); const message = t('update.official.copied'); toast.success(message); }
    catch { const message = t('update.official.copyFailed'); toast.error(message); }
  };
  const postpone = async (action: OfficialNoticeAction) => {
    setSaving(true);
    try {
      const accepted = await act(action);
      if (accepted) onDismiss();
      else { const message = t('update.official.actionStale'); toast.warning(message); }
    } catch { const message = t('update.official.saveFailed'); toast.error(message); }
    finally { setSaving(false); }
  };
  const snooze = () => { void postpone('snooze'); };
  const ignore = () => { void postpone('ignore'); };
  const refresh = () => { setRetry((value) => value + 1); };
  const toggleView = () => {
    if (!personalView) {
      try { localStorage.setItem('cartethyia:personal-notes-read', personalVersion); } catch { /* UI-only read marker. */ }
      setPersonalUnread(false);
    }
    setPersonalView((value) => !value);
  };
  const lastChecked = official?.lastCheckedAt ? new Date(official.lastCheckedAt).toLocaleString() : t('update.official.notChecked');
  const header = <div className="space-y-1 border-b border-[var(--border-default)] px-6 py-3 text-13 text-[var(--text-secondary)]">
    <div>{t('update.official.personalVersion', { version: personalVersion })}</div>
    <div>{t('update.official.baseline', { version: baseline })}</div>
    <div>{t('update.official.latest', { version: official?.latestVersion ?? t('update.official.notChecked') })}</div>
    <div>{t('update.official.checkedAt', { time: lastChecked })}</div>
    {official?.checkFailed && <p role="status">{t('update.official.checkFailed')}</p>}
    {loading && !personalView && <p role="status">{t('update.official.loading')}</p>}
    <button type="button" className={actionClass} onClick={toggleView}>{t(personalView ? 'update.official.title' : personalUnread ? 'update.personal.unread' : 'update.personal.title')}</button>
  </div>;
  const footer = <>
    {!personalView && <>
      <button type="button" className={actionClass} onClick={copy}>{t('update.official.copy')}</button>
      <button type="button" className={actionClass} onClick={openWebsite}>{t('update.official.website')}</button>
      <button type="button" className={actionClass} onClick={refresh} disabled={loading}>{t('update.official.retry')}</button>
      {official?.hasUpdate && <>
        <button type="button" className={actionClass} onClick={snooze} disabled={saving}>{t('update.official.snooze')}</button>
        <button type="button" className={actionClass} onClick={ignore} disabled={saving}>{t('update.official.ignore')}</button>
      </>}
    </>}
  </>;
  return <UpdateNoticeDialog open={open} mode="auto" title={title} releaseNotes={visibleNotes} allVersions={null} loadVersion={loadVersion} onDismiss={onDismiss} headerContent={header} footerContent={footer} />;
}
