import { Component, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';

class ModBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export function ModErrorBoundary({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [generation, setGeneration] = useState(0);
  const reload = () => {
    const next = generation + 1;
    setGeneration(next);
  };
  const fallback = (
    <div role="status" className="flex items-center justify-between gap-3 p-3 text-13 text-[var(--text-secondary)]">
      <span>{t('settings.personalMods.failed')}</span>
      <Button onClick={reload}>{t('settings.personalMods.reload')}</Button>
    </div>
  );
  return <ModBoundary key={generation} fallback={fallback}>{children}</ModBoundary>;
}
