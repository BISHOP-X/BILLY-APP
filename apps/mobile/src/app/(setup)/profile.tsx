import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { SetupShell } from '@/components/ui/setup-shell';
import { TextField } from '@/components/ui/text-field';
import {
  getMyProfile,
  updateMyProfile,
  updateOnboardingStep,
} from '@/features/auth/auth-api';
import { friendlyAuthError } from '@/features/auth/form-utils';
import { useAuth } from '@/features/auth/auth-provider';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';

export default function ProfileSetupScreen() {
  const theme = useBillyTheme();
  const { user } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    let active = true;
    async function hydrate() {
      try {
        const profile = await getMyProfile();
        if (!active) return;
        const metadata = user?.user_metadata ?? {};
        setFirstName(profile?.first_name || String(metadata.first_name || ''));
        setLastName(profile?.last_name || String(metadata.last_name || ''));
        setDisplayName(profile?.display_name || String(metadata.first_name || ''));
        setPhone(profile?.phone || '');
      } catch {
        if (!active) return;
        const metadata = user?.user_metadata ?? {};
        setFirstName(String(metadata.first_name || ''));
        setLastName(String(metadata.last_name || ''));
        setDisplayName(String(metadata.first_name || ''));
      } finally {
        if (active) setHydrating(false);
      }
    }
    hydrate();
    return () => {
      active = false;
    };
  }, [user?.user_metadata]);

  async function submit() {
    const nextErrors: Record<string, string> = {};
    if (!firstName.trim()) nextErrors.firstName = 'Enter your first name.';
    if (!lastName.trim()) nextErrors.lastName = 'Enter your last name.';
    if (!displayName.trim()) nextErrors.displayName = 'Choose the name Billy should use.';
    const phoneDigits = phone.replace(/\D/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      nextErrors.phone = 'Enter a complete phone number with country code.';
    }
    setErrors(nextErrors);
    setFeedback('');
    if (Object.keys(nextErrors).length) return;

    setLoading(true);
    try {
      await updateMyProfile({
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        display_name: displayName.trim(),
        phone: phone.trim(),
      });
      await updateOnboardingStep('pin');
      router.push('/(setup)/pin');
    } catch (error) {
      setFeedback(friendlyAuthError(error));
    } finally {
      setLoading(false);
    }
  }

  if (hydrating) {
    return (
      <SetupShell
        eyebrow="MAKE IT YOURS"
        step={1}
        subtitle="We’re securely preparing the details already connected to your account."
        title="Tell us about you">
        <View style={styles.hydrating}>
          <ActivityIndicator color={theme.colors.brand} size="large" />
          <Text style={[styles.hydratingText, { color: theme.colors.textMuted }]}>
            Loading your profile…
          </Text>
        </View>
      </SetupShell>
    );
  }

  return (
    <SetupShell
      eyebrow="MAKE IT YOURS"
      step={1}
      subtitle="These details help us personalise your experience. You can update them later."
      title="Tell us about you">
      {feedback ? <FeedbackBanner message={feedback} tone="error" /> : null}
      <View style={[styles.avatar, { backgroundColor: theme.colors.brandMist }]}>
        <Text accessible={false} style={styles.avatarEmoji}>
          👋
        </Text>
        <View style={[styles.avatarBadge, { backgroundColor: theme.colors.brand }]}>
          <Ionicons color="#FFFFFF" name="sparkles" size={13} />
        </View>
      </View>
      <TextField
        autoCapitalize="words"
        autoComplete="given-name"
        error={errors.firstName}
        icon="person-outline"
        label="First name"
        onChangeText={(value) => {
          setFirstName(value);
          setErrors((current) => ({ ...current, firstName: '' }));
        }}
        placeholder="Your first name"
        value={firstName}
      />
      <TextField
        autoCapitalize="words"
        autoComplete="family-name"
        error={errors.lastName}
        icon="person-outline"
        label="Last name"
        onChangeText={(value) => {
          setLastName(value);
          setErrors((current) => ({ ...current, lastName: '' }));
        }}
        placeholder="Your last name"
        value={lastName}
      />
      <TextField
        autoCapitalize="words"
        error={errors.displayName}
        icon="happy-outline"
        label="What should Billy call you?"
        onChangeText={(value) => {
          setDisplayName(value);
          setErrors((current) => ({ ...current, displayName: '' }));
        }}
        placeholder="Your preferred name"
        value={displayName}
      />
      <TextField
        autoComplete="tel"
        error={errors.phone}
        icon="call-outline"
        keyboardType="phone-pad"
        label="Phone number"
        onChangeText={(value) => {
          setPhone(value);
          setErrors((current) => ({ ...current, phone: '' }));
        }}
        placeholder="+234 800 000 0000"
        value={phone}
      />
      <View style={[styles.note, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons color={theme.colors.brand} name="lock-closed" size={17} />
        <Text style={[styles.noteText, { color: theme.colors.brand }]}>
          Your information stays protected and is never used as an authorization shortcut.
        </Text>
      </View>
      <AppButton
        icon="arrow-forward"
        label="Continue"
        loading={loading}
        onPress={submit}
        testID="profile-continue"
      />
    </SetupShell>
  );
}

const styles = StyleSheet.create({
  avatar: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 46,
    height: 92,
    justifyContent: 'center',
    marginBottom: spacing.xs,
    position: 'relative',
    width: 92,
  },
  avatarEmoji: {
    fontSize: 43,
  },
  avatarBadge: {
    alignItems: 'center',
    borderRadius: radii.pill,
    bottom: 0,
    height: 28,
    justifyContent: 'center',
    position: 'absolute',
    right: 0,
    width: 28,
  },
  note: {
    alignItems: 'flex-start',
    borderRadius: radii.md,
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.md,
  },
  noteText: {
    flex: 1,
    fontFamily: typography.family,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 18,
  },
  hydrating: {
    alignItems: 'center',
    gap: spacing.md,
    justifyContent: 'center',
    minHeight: 220,
  },
  hydratingText: {
    fontFamily: typography.family,
    fontSize: 14,
  },
});
