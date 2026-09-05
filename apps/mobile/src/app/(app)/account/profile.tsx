import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { DemoDataBanner } from '@/components/ui/demo-data-banner';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { ScreenHeader } from '@/components/ui/screen-header';
import { SkeletonBlock } from '@/components/ui/skeleton';
import { StatePanel } from '@/components/ui/state-panel';
import { TextField } from '@/components/ui/text-field';
import { getMyProfile, updateMyProfile } from '@/features/auth/auth-api';
import { useAuth } from '@/features/auth/auth-provider';
import {
  friendlyAuthError,
  validatePhoneNumber,
} from '@/features/auth/form-utils';
import { isBillyDevDemo } from '@/features/main/repository';
import type { Profile } from '@/lib/supabase/database.types';
import { spacing } from '@/theme/tokens';

export default function ProfileScreen() {
  const { user } = useAuth();
  const userId = user?.id ?? 'signed-out';
  const profile = useQuery({
    enabled: Boolean(user) && !isBillyDevDemo,
    queryFn: getMyProfile,
    queryKey: ['profile', userId],
  });
  return (
    <AppScreen bottomSafe testID="profile-screen">
      <ScreenHeader
        subtitle="Keep your Billy profile accurate and recognisable."
        title="Profile"
      />

      {isBillyDevDemo ? (
        <>
          <DemoDataBanner />
          <StatePanel
            icon="person-outline"
            message="The demo reviewer profile is deterministic and cannot be written to Supabase. Switch explicitly to Supabase mode to edit a signed-in account."
            title="Profile editing is off in demo"
            tone="brand"
          />
        </>
      ) : profile.isLoading ? (
        <View style={styles.loading}>
          {Array.from({ length: 5 }).map((_, index) => (
            <SkeletonBlock key={index} style={styles.fieldSkeleton} />
          ))}
        </View>
      ) : profile.isError || !profile.data ? (
        <StatePanel
          actionLabel="Try again"
          icon="person-outline"
          message={profile.error?.message ?? 'Billy could not load your profile.'}
          onAction={() => void profile.refetch()}
          title="Profile unavailable"
          tone="danger"
        />
      ) : (
        <ProfileForm profile={profile.data} userId={userId} />
      )}
    </AppScreen>
  );
}

function ProfileForm({ profile, userId }: { profile: Profile; userId: string }) {
  const queryClient = useQueryClient();
  const [firstName, setFirstName] = useState(profile.first_name ?? '');
  const [lastName, setLastName] = useState(profile.last_name ?? '');
  const [displayName, setDisplayName] = useState(profile.display_name ?? '');
  const [phone, setPhone] = useState(profile.phone ?? '');
  const [country, setCountry] = useState(profile.country_code ?? 'NG');
  const [validationError, setValidationError] = useState('');
  const [saved, setSaved] = useState(false);

  const update = useMutation({
    mutationFn: () =>
      updateMyProfile({
        country_code: country.trim().toUpperCase(),
        display_name: displayName.trim() || null,
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        phone: phone.trim() || null,
      }),
    onSuccess: async (updated) => {
      setSaved(true);
      queryClient.setQueryData(['profile', userId], updated);
      await queryClient.invalidateQueries({ queryKey: ['main'] });
    },
  });

  function submit() {
    setSaved(false);
    setValidationError('');
    if (firstName.trim().length < 2 || lastName.trim().length < 2) {
      setValidationError('Enter your legal first and last name.');
      return;
    }
    if (!/^[A-Za-z]{2}$/.test(country.trim())) {
      setValidationError('Country must be a two-letter code such as NG.');
      return;
    }
    if (phone.trim()) {
      const phoneError = validatePhoneNumber(phone);
      if (phoneError) {
        setValidationError(phoneError);
        return;
      }
    }
    update.mutate();
  }

  return (
    <>
      {validationError || update.isError ? (
        <FeedbackBanner
          message={validationError || friendlyAuthError(update.error)}
          tone="error"
        />
      ) : null}
      {saved ? (
        <FeedbackBanner message="Your Billy profile was updated." tone="success" />
      ) : null}

      <View style={styles.form}>
        <TextField
          autoCapitalize="words"
          icon="person-outline"
          label="Legal first name"
          onChangeText={setFirstName}
          value={firstName}
        />
        <TextField
          autoCapitalize="words"
          icon="person-outline"
          label="Legal last name"
          onChangeText={setLastName}
          value={lastName}
        />
        <TextField
          autoCapitalize="words"
          icon="happy-outline"
          label="Display name"
          onChangeText={setDisplayName}
          value={displayName}
        />
        <TextField
          autoComplete="tel"
          icon="call-outline"
          keyboardType="phone-pad"
          label="Phone number"
          onChangeText={setPhone}
          placeholder="090 0000 0000 or +234 900 000 0000"
          value={phone}
        />
        <TextField
          autoCapitalize="characters"
          icon="flag-outline"
          label="Country code"
          maxLength={2}
          onChangeText={setCountry}
          value={country}
        />
      </View>

      <AppButton label="Save profile" loading={update.isPending} onPress={submit} />
    </>
  );
}

const styles = StyleSheet.create({
  fieldSkeleton: {
    height: 78,
  },
  form: {
    gap: spacing.lg,
  },
  loading: {
    gap: spacing.lg,
  },
});
