import Svg, { Circle, Path } from 'react-native-svg';
import { subagentIdentityVariant, type SubagentPresentationSource } from '@cindy/maker-shared/subagent-workspace';
import { useTheme } from '@/theme';

export function SubagentAvatar({ source, size = 20 }: { source: SubagentPresentationSource; size?: number }) {
  const { colors } = useTheme();
  const palette = [colors.subagentIdentity1, colors.subagentIdentity2, colors.subagentIdentity3, colors.subagentIdentity4];
  const variant = subagentIdentityVariant(source);
  const color = palette[variant];
  return <Svg width={size} height={size} viewBox="0 0 24 24" accessible={false}>
    {[0, 60, 120, 180, 240, 300].map((angle) => <Path key={angle} d="M12 1 15 5 12 9 9 5Z" transform={`rotate(${angle} 12 12)`} fill={color} opacity={0.8} />)}
    <Circle cx={12} cy={12} r={2.4} fill={color} />
  </Svg>;
}
