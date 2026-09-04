import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { BillyLogo } from '@/components/ui/billy-logo';
import { AppButton } from '@/components/ui/button';
import { FadeSlide, ScalePressable } from '@/components/ui/motion';
import {
  hasSeenOnboarding,
} from '@/features/onboarding/onboarding-storage';
import { radii, spacing, typography } from '@/theme/tokens';

export default function WelcomeScreen() {
  const [loading, setLoading] = useState(false);

  async function createAccount() {
    setLoading(true);
    const hasSeenIntro = await hasSeenOnboarding();
    router.push(hasSeenIntro ? '/(auth)/sign-up' : '/(onboarding)');
    setLoading(false);
  }

  return (
    <LinearGradient
      colors={['#082F1D', '#0B4829', '#146237']}
      end={{ x: 0.9, y: 1 }}
      start={{ x: 0.1, y: 0 }}
      style={styles.screen}>
      <StatusBar style="light" />
      <SafeAreaView style={styles.safeArea}>
        <View pointerEvents="none" style={styles.decoration}>
          <View style={[styles.orbit, styles.orbitLarge]} />
          <View style={[styles.orbit, styles.orbitSmall]} />
          <View style={[styles.glow, styles.glowTop]} />
          <View style={[styles.glow, styles.glowBottom]} />
        </View>

        <FadeSlide delay={60} distance={12} style={styles.brand}>
          <BillyLogo size={246} variant="wordmark" />
          <Text style={styles.tagline}>Everyday possibilities, all in one place.</Text>
        </FadeSlide>

        <FadeSlide delay={150} distance={16} style={styles.actions}>
          <AppButton
            accessibilityHint="Starts Billy’s short introduction before account creation."
            icon="arrow-forward"
            label="Create account"
            loading={loading}
            onPress={() => void createAccount()}
            testID="welcome-create-account"
            variant="light"
          />
          <ScalePressable
            accessibilityLabel="Sign in"
            accessibilityRole="button"
            onPress={() => router.push('/(auth)/sign-in')}
            style={styles.signInButton}
            testID="welcome-sign-in">
            <Text style={styles.signInText}>Sign in</Text>
          </ScalePressable>
          <View style={styles.securityNote}>
            <Ionicons color="rgba(255,255,255,0.72)" name="shield-checkmark" size={15} />
            <Text style={styles.securityText}>Secure access. Clear control.</Text>
          </View>
        </FadeSlide>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    justifyContent: 'space-between',
    overflow: 'hidden',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xxl,
  },
  decoration: {
    bottom: 0,
    left: 0,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  orbit: {
    borderColor: 'rgba(255,255,255,0.08)',
    borderRadius: radii.pill,
    borderWidth: 1,
    position: 'absolute',
  },
  orbitLarge: {
    height: 430,
    left: '50%',
    marginLeft: -215,
    marginTop: -215,
    top: '47%',
    width: 430,
  },
  orbitSmall: {
    height: 300,
    left: '50%',
    marginLeft: -150,
    marginTop: -150,
    top: '47%',
    width: 300,
  },
  glow: {
    backgroundColor: 'rgba(70, 190, 123, 0.12)',
    borderRadius: radii.pill,
    height: 220,
    position: 'absolute',
    width: 220,
  },
  glowTop: {
    right: -110,
    top: -70,
  },
  glowBottom: {
    bottom: 40,
    left: -140,
  },
  brand: {
    alignItems: 'center',
    flex: 1,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  tagline: {
    color: 'rgba(255,255,255,0.78)',
    fontFamily: typography.family,
    fontSize: 15,
    lineHeight: 23,
    maxWidth: 290,
    textAlign: 'center',
  },
  actions: {
    alignSelf: 'center',
    gap: spacing.sm,
    maxWidth: 430,
    width: '100%',
  },
  signInButton: {
    alignItems: 'center',
    borderColor: 'rgba(255,255,255,0.42)',
    borderRadius: radii.lg,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: 56,
  },
  signInText: {
    color: '#FFFFFF',
    fontFamily: typography.familyRounded,
    fontSize: 16,
    fontWeight: '700',
  },
  securityNote: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
    minHeight: 38,
  },
  securityText: {
    color: 'rgba(255,255,255,0.68)',
    fontFamily: typography.family,
    fontSize: 12,
  },
});
