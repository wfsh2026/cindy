import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { setThemeModName, useThemeModOptions } from '@/themes/mod-preferences';
import { normalizeModIdentity } from '../../../shared/modIdentity';

export function ThemeModNameField({ familyId, field, placeholder }: { familyId: string; field: 'appName' | 'assistantName'; placeholder?: string }) {
  const { t } = useTranslation();
  const options = useThemeModOptions(familyId);
  const stored = options.names?.[field] ?? '';
  const labelKey = 'settings.personalMods.identity.' + field;
  const [value, setValue] = useState(stored);
  const [error, setError] = useState(false);
  useEffect(() => setValue(stored), [stored]);
  const save = () => {
    const input = { [field]: value };
    const normalized = normalizeModIdentity(input);
    if (value.trim() && !normalized[field]) { setError(true); return; }
    setError(false);
    setThemeModName(familyId, field, value);
  };
  return <div className="mb-2 flex flex-col gap-2 pl-3">
    <div className="flex items-center gap-2"><Input value={value} onChange={setValue} maxLength={40} placeholder={placeholder} aria-label={t(labelKey)} /><Button variant="secondary" onClick={save}>{t('settings.personalMods.identity.save')}</Button></div>
    {field === 'assistantName' && <p className="text-12 text-[var(--text-secondary)]">{t('settings.personalMods.nameHint')}</p>}
    {error && <p role="alert" className="text-12 text-[var(--error-fg)]">{t('settings.personalMods.identity.error')}</p>}
  </div>;
}
