import { useColorScheme } from 'react-native';

import { darkTheme, lightTheme } from '@/theme/tokens';

export function useBillyTheme() {
  const scheme = useColorScheme();
  return scheme === 'dark' ? darkTheme : lightTheme;
}
