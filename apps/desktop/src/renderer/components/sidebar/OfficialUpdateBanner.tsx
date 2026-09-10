import { Flame } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useUpdateStatus } from '@/hooks/useUpdateStatus';
import { Tip } from '@/components/ui/tooltip';

export function OfficialUpdateBanner({ isCollapsed, onOpen }: { isCollapsed: boolean; onOpen?: (version: string) => void }) {
  const { official } = useUpdateStatus();
  const { t } = useTranslation();
  if (!official?.hasUpdate || !official.latestVersion || !onOpen) return null;
  const version = official.latestVersion;
  const label = t('update.official.available', { version });
  const open = () => onOpen(version);
  return <div className="px-2 py-2">
    <Tip text={label}><button type="button" onClick={open} aria-label={label} className="flex w-full items-center gap-2 rounded-full px-3 py-2 text-left text-13 text-[var(--text-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
      <Flame size={18} className="shrink-0" />
      {!isCollapsed && <span><span className="block">{label}</span><span className="block text-12 text-[var(--text-secondary)]">{t('update.official.unsynced')}</span></span>}
    </button></Tip>
  </div>;
}
