import { useColorScheme } from 'react-native';

import { darkTheme, lightTheme } from '@/theme/tokens';
import { useAppearance } from '@/theme/appearance-provider';

export function useBillyTheme() {
  const scheme = useColorScheme();
  const { preference } = useAppearance();
  return (preference === 'system' ? scheme : preference) === 'dark' ? darkTheme : lightTheme;
}
