import { useModPresentation } from '@/features/composer-modes/useModIdentity';

export function usePersonalAssistantAvatar() {
  const { avatar, assistantName } = useModPresentation();
  if (!avatar) return undefined;
  return <img src={avatar} alt={assistantName} title={assistantName} className="h-7 w-7 rounded-full object-cover" />;
}
