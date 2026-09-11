import { useId, useState, type ReactNode } from 'react';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

interface ModListRowProps {
  name: string;
  detail: string;
  icon: ReactNode;
  enabled: boolean;
  empty?: boolean;
  busy?: boolean;
  builtin?: boolean;
  onEnabledChange: (enabled: boolean) => void;
  actions: ReactNode;
  children: ReactNode;
}

export function ModListRow({ name, detail, icon, enabled, empty, busy, builtin, onEnabledChange, actions, children }: ModListRowProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const toggle = () => setExpanded(!expanded);
  const status = enabled ? empty ? 'noParts' : 'enabled' : 'disabled';
  return <section aria-label={name} data-mod-source={builtin ? 'builtin' : 'imported'} className="overflow-hidden rounded-xl border border-[var(--settings-theme-card-border)] bg-[var(--settings-theme-card-bg)]">
    <div className="flex items-center gap-3 p-3">
      <button type="button" onClick={toggle} aria-label={name} aria-expanded={expanded} aria-controls={id} className="flex min-h-10 min-w-0 flex-1 items-center gap-3 rounded-full px-2 text-left text-[var(--text-primary)] hover:bg-[var(--surface-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
        <ChevronRight size={16} aria-hidden className={expanded ? 'shrink-0 rotate-90' : 'shrink-0'} />
        <span aria-hidden className="shrink-0 text-[var(--text-secondary)]">{icon}</span>
        <span className="min-w-0 truncate text-14 font-medium">{name}</span>
        <span className="truncate text-12 text-[var(--text-tertiary)]">{detail}</span>
      </button>
      <span role="status" className="shrink-0 text-12 text-[var(--text-secondary)]">{t(`settings.personalMods.${status}`)}</span>
      <Switch checked={enabled} onCheckedChange={onEnabledChange} disabled={busy} aria-label={name} />
      {actions}
    </div>
    {expanded && <div id={id} className="flex flex-col gap-3 border-t border-[var(--border-default)] px-5 py-4">{children}</div>}
  </section>;
}

export interface ModAction { label: string; run: () => void; disabled?: boolean }
export function ModRowActions({ name, actions }: { name: string; actions: ModAction[] }) {
  const { t } = useTranslation();
  const items = actions.map(action => <DropdownMenuItem key={action.label} onSelect={action.run} disabled={action.disabled}>{action.label}</DropdownMenuItem>);
  return <DropdownMenu>
    <DropdownMenuTrigger asChild><Button variant="secondary" aria-label={t('settings.personalMods.more', { name })} className="w-8 px-0"><MoreHorizontal size={16} /></Button></DropdownMenuTrigger>
    <DropdownMenuContent align="end">{items}</DropdownMenuContent>
  </DropdownMenu>;
}
