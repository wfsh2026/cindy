import { useTranslation } from 'react-i18next';
import { useModPresentation } from '@/features/composer-modes/useModIdentity';

import { useBrandLogo } from '@/hooks/useBrandLogo';

export function WelcomePage() {
  const { t } = useTranslation();
  const brandLogo = useBrandLogo();
  const { appName } = useModPresentation();
  return (
    <div className="flex h-full flex-col items-center justify-center">
      <img
        src={brandLogo}
        alt={appName}
        className="w-[120px] object-contain pointer-events-none"
        draggable={false}
      />
      <p className="mt-[20px] text-28 font-semibold text-welcome-text">
        {t('welcome.greeting')}
      </p>
    </div>
  );
}
