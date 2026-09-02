import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { ReactNode, useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  StyleSheet,
  StyleProp,
  Text,
  useWindowDimensions,
  View,
  ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillyLogo } from '@/components/ui/billy-logo';
import { AppButton } from '@/components/ui/button';
import { FadeSlide } from '@/components/ui/motion';
import { markOnboardingSeen } from '@/features/onboarding/onboarding-storage';
import { radii, spacing, typography } from '@/theme/tokens';

type Slide = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  visual: 'services' | 'wallet' | 'security';
};

const slides: Slide[] = [
  {
    id: 'possibilities',
    eyebrow: 'EVERYDAY, ELEVATED',
    title: 'One app. More possibilities.',
    description: 'Pay, trade, and manage everyday digital services in one calm place.',
    visual: 'services',
  },
  {
    id: 'clarity',
    eyebrow: 'CLEAR BY DESIGN',
    title: 'Your money, clearly.',
    description: 'See balances, activity, fees, and progress without the guesswork.',
    visual: 'wallet',
  },
  {
    id: 'security',
    eyebrow: 'SECURITY, YOUR WAY',
    title: 'Protected at every step.',
    description: 'Secure access, transaction PINs, and biometric unlock when you choose.',
    visual: 'security',
  },
];

function ServiceTile({
  emoji,
  label,
  style,
}: {
  emoji: string;
  label: string;
  style?: object;
}) {
  return (
    <View style={[styles.serviceTile, style]}>
      <Text accessible={false} style={styles.serviceEmoji}>
        {emoji}
      </Text>
      <Text style={styles.serviceLabel}>{label}</Text>
    </View>
  );
}

function SlideVisual({ scale, type }: { scale: number; type: Slide['visual'] }) {
  const translateY = scale < 0.65 ? 0 : (1 - scale) * 72;
  const scaledStageStyle = {
    marginVertical: -(1 - scale) * 145,
    transform: [{ scale }, { translateY }],
  };

  if (type === 'wallet') {
    return (
      <View style={[styles.visualStage, scaledStageStyle]}>
        <View style={[styles.orbit, styles.orbitLarge]} />
        <View style={styles.walletCard}>
          <View style={styles.walletTopRow}>
            <View>
              <Text style={styles.walletLabel}>Available balance</Text>
              <Text style={styles.walletAmount}>₦ 0.00</Text>
            </View>
            <View style={styles.eyeBubble}>
              <Ionicons color="#146237" name="eye-outline" size={20} />
            </View>
          </View>
          <View style={styles.walletDivider} />
          <View style={styles.walletBottomRow}>
            <View style={styles.miniAction}>
              <Ionicons color="#FFFFFF" name="add" size={18} />
              <Text style={styles.miniActionText}>Add money</Text>
            </View>
            <View style={styles.miniAction}>
              <Ionicons color="#FFFFFF" name="arrow-up" size={17} />
              <Text style={styles.miniActionText}>Withdraw</Text>
            </View>
          </View>
        </View>
        <View style={[styles.floatingBadge, styles.badgeRight]}>
          <Ionicons color="#146237" name="receipt-outline" size={18} />
          <Text style={styles.badgeText}>Clear activity</Text>
        </View>
      </View>
    );
  }

  if (type === 'security') {
    return (
      <View style={[styles.visualStage, scaledStageStyle]}>
        <View style={[styles.orbit, styles.orbitSmall]} />
        <View style={styles.securityHalo}>
          <View style={styles.securityCore}>
            <Ionicons color="#146237" name="shield-checkmark" size={66} />
          </View>
        </View>
        <View style={[styles.securityPill, styles.pinPill]}>
          <Ionicons color="#146237" name="keypad-outline" size={18} />
          <Text style={styles.securityPillText}>6-digit PIN</Text>
        </View>
        <View style={[styles.securityPill, styles.bioPill]}>
          <Ionicons color="#146237" name="finger-print-outline" size={19} />
          <Text style={styles.securityPillText}>Biometrics</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.visualStage, scaledStageStyle]}>
      <View style={[styles.orbit, styles.orbitLarge]} />
      <View style={styles.spark}>
        <Text accessible={false} style={styles.sparkEmoji}>
          ⚡️
        </Text>
      </View>
      <ServiceTile emoji="💡" label="Pay bills" style={styles.tileLeft} />
      <ServiceTile emoji="🎁" label="Gift cards" style={styles.tileRight} />
      <ServiceTile emoji="🌍" label="Global services" style={styles.tileBottom} />
    </View>
  );
}

function OnboardingCell({
  children,
  onLayout,
  style,
}: {
  children: ReactNode;
  onLayout?: (event: LayoutChangeEvent) => void;
  style: StyleProp<ViewStyle>;
}) {
  return (
    <View onLayout={onLayout} style={[style, styles.carouselCell]}>
      {children}
    </View>
  );
}

export default function OnboardingScreen() {
  const { height, width } = useWindowDimensions();
  const listRef = useRef<FlatList<Slide>>(null);
  const [scrollX] = useState(() => new Animated.Value(0));
  const [activeIndex, setActiveIndex] = useState(0);
  const contentWidth = Math.min(width, 560);
  const visualScale = Math.min(1, Math.max(0.5, (height - 427) / 290));

  async function leaveOnboarding(destination: '/(auth)/sign-in' | '/(auth)/sign-up') {
    await markOnboardingSeen();
    router.push(destination);
  }

  function goNext() {
    if (activeIndex === slides.length - 1) {
      void leaveOnboarding('/(auth)/sign-up');
      return;
    }
    const nextIndex = activeIndex + 1;
    setActiveIndex(nextIndex);
    listRef.current?.scrollToOffset({
      animated: true,
      offset: nextIndex * contentWidth,
    });
  }

  function handleMomentumEnd(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / contentWidth);
    setActiveIndex(Math.max(0, Math.min(nextIndex, slides.length - 1)));
  }

  return (
    <LinearGradient colors={['#0A492B', '#146237', '#1B7847']} style={styles.container}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea}>
        <View style={[styles.topBar, { maxWidth: contentWidth }]}>
          <BillyLogo size={54} />
          <Pressable
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => void leaveOnboarding('/(auth)/sign-up')}
            testID="onboarding-skip">
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </View>

        <Animated.FlatList
          bounces={false}
          CellRendererComponent={OnboardingCell}
          contentContainerStyle={styles.carouselContent}
          data={slides}
          decelerationRate="fast"
          horizontal
          getItemLayout={(_, index) => ({
            index,
            length: contentWidth,
            offset: contentWidth * index,
          })}
          keyExtractor={(item) => item.id}
          onMomentumScrollEnd={handleMomentumEnd}
          onScroll={Animated.event([{ nativeEvent: { contentOffset: { x: scrollX } } }], {
            useNativeDriver: Platform.OS !== 'web',
          })}
          pagingEnabled
          ref={listRef}
          renderItem={({ item, index }) => {
            const inputRange = [
              (index - 1) * contentWidth,
              index * contentWidth,
              (index + 1) * contentWidth,
            ];
            const opacity = scrollX.interpolate({
              inputRange,
              outputRange: [0.35, 1, 0.35],
              extrapolate: 'clamp',
            });
            const scale = scrollX.interpolate({
              inputRange,
              outputRange: [0.9, 1, 0.9],
              extrapolate: 'clamp',
            });

            return (
              <View
                accessibilityElementsHidden={index !== activeIndex}
                aria-hidden={index !== activeIndex}
                importantForAccessibility={
                  index === activeIndex ? 'auto' : 'no-hide-descendants'
                }
                pointerEvents={index === activeIndex ? 'auto' : 'none'}
                style={[styles.slide, { width: contentWidth }]}>
                <Animated.View style={[styles.visualWrap, { opacity, transform: [{ scale }] }]}>
                  <SlideVisual scale={visualScale} type={item.visual} />
                </Animated.View>

                <View style={styles.sheet}>
                  <FadeSlide key={`${item.id}-${activeIndex}`} distance={12}>
                    <Text style={styles.eyebrow}>{item.eyebrow}</Text>
                    <Text style={styles.title}>{item.title}</Text>
                    <Text style={styles.description}>{item.description}</Text>
                  </FadeSlide>

                  <View style={styles.dots}>
                    {slides.map((slide, dotIndex) => (
                      <View
                        key={slide.id}
                        style={[
                          styles.dot,
                          {
                            backgroundColor:
                              dotIndex === activeIndex ? '#146237' : '#D8E5DD',
                            width: dotIndex === activeIndex ? 24 : 8,
                          },
                        ]}
                      />
                    ))}
                  </View>

                  <AppButton
                    icon={activeIndex === slides.length - 1 ? 'sparkles' : 'arrow-forward'}
                    label={activeIndex === slides.length - 1 ? 'Create my account' : 'Continue'}
                    onPress={goNext}
                    testID="onboarding-next"
                  />
                  <Pressable
                    accessibilityRole="button"
                    onPress={() => void leaveOnboarding('/(auth)/sign-in')}
                    style={styles.signInLink}>
                    <Text style={styles.signInMuted}>Already use Billy? </Text>
                    <Text style={styles.signInStrong}>Sign in</Text>
                  </Pressable>
                </View>
              </View>
            );
          }}
          scrollEventThrottle={16}
          showsHorizontalScrollIndicator={false}
          style={[styles.carousel, { maxWidth: contentWidth }]}
        />
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  safeArea: {
    alignItems: 'center',
    flex: 1,
  },
  topBar: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    position: 'relative',
    width: '100%',
    zIndex: 20,
    elevation: 20,
  },
  carousel: {
    alignSelf: 'stretch',
    flex: 1,
    width: '100%',
  },
  carouselContent: {
    height: '100%',
  },
  carouselCell: {
    height: '100%',
  },
  skipText: {
    color: 'rgba(255,255,255,0.84)',
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '700',
    paddingVertical: spacing.sm,
  },
  slide: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
  },
  visualWrap: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  visualStage: {
    alignItems: 'center',
    height: 290,
    justifyContent: 'center',
    position: 'relative',
    width: '100%',
    maxWidth: 390,
  },
  orbit: {
    borderColor: 'rgba(255,255,255,0.16)',
    borderRadius: radii.pill,
    borderWidth: 1,
    position: 'absolute',
  },
  orbitLarge: {
    height: 250,
    width: 250,
  },
  orbitSmall: {
    height: 220,
    width: 220,
  },
  spark: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 48,
    height: 96,
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0 18px 48px rgba(8, 46, 28, 0.28)' },
      default: {
        shadowColor: '#082E1C',
        shadowOffset: { height: 18, width: 0 },
        shadowOpacity: 0.28,
        shadowRadius: 24,
      },
    }),
    width: 96,
  },
  sparkEmoji: {
    fontSize: 44,
  },
  serviceTile: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: radii.lg,
    gap: 3,
    minWidth: 96,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    position: 'absolute',
    ...Platform.select({
      web: { boxShadow: '0 10px 36px rgba(8, 46, 28, 0.2)' },
      default: {
        shadowColor: '#082E1C',
        shadowOffset: { height: 10, width: 0 },
        shadowOpacity: 0.2,
        shadowRadius: 18,
      },
    }),
  },
  serviceEmoji: {
    fontSize: 23,
  },
  serviceLabel: {
    color: '#146237',
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
  },
  tileLeft: {
    left: 18,
    top: 46,
    transform: [{ rotate: '-5deg' }],
  },
  tileRight: {
    right: 12,
    top: 64,
    transform: [{ rotate: '5deg' }],
  },
  tileBottom: {
    bottom: 22,
    minWidth: 126,
    transform: [{ rotate: '-2deg' }],
  },
  walletCard: {
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: radii.xl,
    padding: spacing.lg,
    ...Platform.select({
      web: { boxShadow: '0 18px 56px rgba(7, 43, 25, 0.28)' },
      default: {
        shadowColor: '#072B19',
        shadowOffset: { height: 18, width: 0 },
        shadowOpacity: 0.28,
        shadowRadius: 28,
      },
    }),
    width: '88%',
  },
  walletTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  walletLabel: {
    color: '#66756C',
    fontFamily: typography.family,
    fontSize: 12,
  },
  walletAmount: {
    color: '#102419',
    fontFamily: typography.familyRounded,
    fontSize: 28,
    fontVariant: ['tabular-nums'],
    fontWeight: '800',
    marginTop: 6,
  },
  eyeBubble: {
    alignItems: 'center',
    backgroundColor: '#E8F5EC',
    borderRadius: radii.pill,
    height: 42,
    justifyContent: 'center',
    width: 42,
  },
  walletDivider: {
    backgroundColor: '#E4EBE7',
    height: 1,
    marginVertical: spacing.lg,
  },
  walletBottomRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  miniAction: {
    alignItems: 'center',
    backgroundColor: '#146237',
    borderRadius: radii.md,
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    justifyContent: 'center',
    paddingVertical: 11,
  },
  miniActionText: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '700',
  },
  floatingBadge: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 13,
    paddingVertical: 10,
    position: 'absolute',
    ...Platform.select({
      web: { boxShadow: '0 8px 28px rgba(8, 46, 28, 0.2)' },
      default: {
        shadowColor: '#082E1C',
        shadowOffset: { height: 8, width: 0 },
        shadowOpacity: 0.2,
        shadowRadius: 14,
      },
    }),
  },
  badgeRight: {
    bottom: 28,
    right: 4,
  },
  badgeText: {
    color: '#146237',
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
  },
  securityHalo: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 94,
    height: 188,
    justifyContent: 'center',
    width: 188,
  },
  securityCore: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 66,
    height: 132,
    justifyContent: 'center',
    ...Platform.select({
      web: { boxShadow: '0 16px 48px rgba(7, 43, 25, 0.25)' },
      default: {
        shadowColor: '#072B19',
        shadowOffset: { height: 16, width: 0 },
        shadowOpacity: 0.25,
        shadowRadius: 24,
      },
    }),
    width: 132,
  },
  securityPill: {
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: radii.pill,
    flexDirection: 'row',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 11,
    position: 'absolute',
    ...Platform.select({
      web: { boxShadow: '0 8px 28px rgba(7, 43, 25, 0.18)' },
      default: {
        shadowColor: '#072B19',
        shadowOffset: { height: 8, width: 0 },
        shadowOpacity: 0.18,
        shadowRadius: 14,
      },
    }),
  },
  pinPill: {
    left: 12,
    top: 56,
    transform: [{ rotate: '-5deg' }],
  },
  bioPill: {
    bottom: 40,
    right: 6,
    transform: [{ rotate: '4deg' }],
  },
  securityPillText: {
    color: '#146237',
    fontFamily: typography.familyRounded,
    fontSize: 12,
    fontWeight: '800',
  },
  sheet: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 34,
    borderTopRightRadius: 34,
    gap: spacing.md,
    minHeight: 365,
    paddingBottom: spacing.xl,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.xxl,
  },
  eyebrow: {
    color: '#146237',
    fontFamily: typography.familyRounded,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.8,
  },
  title: {
    color: '#142019',
    fontFamily: typography.familyRounded,
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: -0.9,
    lineHeight: 36,
    marginTop: 7,
  },
  description: {
    color: '#657169',
    fontFamily: typography.family,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 8,
    maxWidth: 430,
  },
  dots: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    height: 12,
    marginBottom: spacing.xs,
    marginTop: spacing.xs,
  },
  dot: {
    borderRadius: radii.pill,
    height: 8,
  },
  signInLink: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: 38,
  },
  signInMuted: {
    color: '#657169',
    fontFamily: typography.family,
    fontSize: 14,
  },
  signInStrong: {
    color: '#146237',
    fontFamily: typography.familyRounded,
    fontSize: 14,
    fontWeight: '800',
  },
});
