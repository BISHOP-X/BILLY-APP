import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, View } from 'react-native';

import type { GoogleIdentityButtonProps } from './google-identity-button.types';

const googleButtonSource = Platform.select({
  ios: require('../../../assets/brand/google-sign-in-ios.png'),
  default: require('../../../assets/brand/google-sign-in-android-web.png'),
});

export function GoogleIdentityButton({
  disabled,
  loading,
  onOAuthPress,
}: GoogleIdentityButtonProps) {
  return (
    <Pressable
      accessibilityLabel="Sign in with Google"
      accessibilityRole="button"
      accessibilityState={{ busy: loading, disabled }}
      disabled={disabled || loading}
      onPress={onOAuthPress}
      style={({ pressed }) => [
        styles.button,
        { opacity: disabled ? 0.5 : pressed ? 0.86 : 1 },
      ]}>
      <Image resizeMode="contain" source={googleButtonSource} style={styles.image} />
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color="#146237" />
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    height: 56,
    justifyContent: 'center',
    width: 252,
  },
  image: {
    height: 56,
    width: 252,
  },
  loading: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
    borderRadius: 28,
    bottom: 0,
    justifyContent: 'center',
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
});
