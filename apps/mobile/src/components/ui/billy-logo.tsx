import {
  type ColorValue,
  Image,
  type ImageStyle,
  type StyleProp,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';

type BillyLogoProps = {
  variant?: 'mark' | 'wordmark';
  size?: number;
  style?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  tintColor?: ColorValue;
};

const mark = require('../../../assets/brand/billy-mark-transparent.png');
const wordmark = require('../../../assets/brand/billy-wordmark-transparent.png');

export function BillyLogo({
  variant = 'mark',
  size = variant === 'mark' ? 92 : 184,
  style,
  imageStyle,
  tintColor,
}: BillyLogoProps) {
  const ratio = variant === 'mark' ? 411 / 407 : 622 / 282;
  return (
    <View
      accessibilityLabel="Billy"
      accessibilityRole="image"
      style={[
        styles.clip,
        {
          width: size,
          height: size / ratio,
        },
        style,
      ]}>
      <Image
        resizeMode="cover"
        source={variant === 'mark' ? mark : wordmark}
        tintColor={tintColor}
        style={[
          styles.image,
          imageStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  image: {
    width: '100%',
    height: '100%',
  },
});
