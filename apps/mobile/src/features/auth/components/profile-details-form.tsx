import Ionicons from '@expo/vector-icons/Ionicons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { TextField } from '@/components/ui/text-field';
import { getMyProfile, updateMyProfile } from '@/features/auth/auth-api';
import { useAuth } from '@/features/auth/auth-provider';
import { splitFullName, validateFullName } from '@/features/auth/full-name';
import {
  friendlyAuthError,
  validatePhoneNumber,
} from '@/features/auth/form-utils';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import type { Profile } from '@/lib/supabase/database.types';
import { radii, spacing, typography } from '@/theme/tokens';

type ProfileDetailsFormProps = {
  onSaved: (profile: Profile) => Promise<void> | void;
  submitLabel?: string;
};

export function ProfileDetailsForm({
  onSaved,
  submitLabel = 'Continue',
}: ProfileDetailsFormProps) {
  const theme = useBillyTheme();
  const { user } = useAuth();
  const [fullName, setFullName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);
  const [hydrating, setHydrating] = useState(true);

  useEffect(() => {
    let active = true;

    async function hydrate() {
      const metadata = user?.user_metadata ?? {};
      try {
        const profile = await getMyProfile();
        if (!active) return;
        setFullName([profile?.first_name, profile?.last_name].filter(Boolean).join(' ') || String(metadata.full_name || [metadata.first_name, metadata.last_name].filter(Boolean).join(' ')));
        setDisplayName(profile?.display_name || String(metadata.first_name || ''));
        setPhone(profile?.phone || '');
      } catch (error) {
        if (!active) return;
        setFullName(String(metadata.full_name || [metadata.first_name, metadata.last_name].filter(Boolean).join(' ')));
        setDisplayName(String(metadata.first_name || ''));
        setFeedback(friendlyAuthError(error));
      } finally {
        if (active) setHydrating(false);
      }
    }

    void hydrate();
    return () => {
      active = false;
    };
  }, [user?.user_metadata]);

  async function submit() {
    const nextErrors: Record<string, string> = {};
    const nameError = validateFullName(fullName);
    if (nameError) nextErrors.fullName = nameError;
    if (!displayName.trim()) nextErrors.displayName = 'Choose the name Billy should use.';
    const phoneError = validatePhoneNumber(phone);
    if (phoneError) nextErrors.phone = phoneError;
    setErrors(nextErrors);
    setFeedback('');
    if (Object.keys(nextErrors).length) return;

    setLoading(true);
    try {
      const profile = await updateMyProfile({
        first_name: splitFullName(fullName).firstName,
        last_name: splitFullName(fullName).lastName || null,
        display_name: displayName.trim(),
        phone: phone.trim(),
      });
      await onSaved(profile);
    } catch (error) {
      setFeedback(friendlyAuthError(error));
    } finally {
      setLoading(false);
    }
  }

  if (hydrating) {
    return (
      <View style={styles.hydrating}>
        <ActivityIndicator color={theme.colors.brand} size="large" />
        <Text style={[styles.hydratingText, { color: theme.colors.textMuted }]}>Loading your profile…</Text>
      </View>
    );
  }

  return (
    <>
      {feedback ? <FeedbackBanner message={feedback} tone="error" /> : null}
      <View style={[styles.avatar, { backgroundColor: theme.colors.brandMist }]}>
        <Text accessible={false} style={styles.avatarEmoji}>👋</Text>
        <View style={[styles.avatarBadge, { backgroundColor: theme.colors.brand }]}>
          <Ionicons color="#FFFFFF" name="sparkles" size={13} />
        </View>
      </View>
      <TextField
        autoCapitalize="words"
        autoComplete="name"
        error={errors.fullName}
        icon="person-outline"
        label="Full name"
        onChangeText={(value) => {
          setFullName(value);
          setErrors((current) => ({ ...current, fullName: '' }));
        }}
        placeholder="Your full name"
        value={fullName}
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
        placeholder="090 0000 0000 or +234 900 000 0000"
        value={phone}
      />
      <View style={[styles.note, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons color={theme.colors.brand} name="lock-closed" size={17} />
        <Text style={[styles.noteText, { color: theme.colors.brand }]}>You can update these details in Account.</Text>
      </View>
      <AppButton
        icon="arrow-forward"
        label={submitLabel}
        loading={loading}
        onPress={submit}
        testID="profile-continue"
      />
    </>
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
