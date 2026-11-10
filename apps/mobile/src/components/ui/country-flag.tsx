import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { View } from 'react-native';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { countryFlagAssets } from './country-flag-assets';

export function CountryFlag({ code, name }: { code: string; name?: string }) {
  const theme = useBillyTheme();
  const source = countryFlagAssets[code.trim().toUpperCase()];
  return (
    <View
      style={{
        width: 30,
        height: 24,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {source
        ? (
          <Image
            source={source}
            contentFit='contain'
            style={{ width: 28, height: 21 }}
            accessibilityLabel={`${name || code.toUpperCase()} flag`}
          />
        )
        : (
          <Ionicons
            name='globe-outline'
            size={24}
            color={theme.colors.brand}
            accessible={false}
          />
        )}
    </View>
  );
}
