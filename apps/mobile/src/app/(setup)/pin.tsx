import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { PinEntry } from '@/components/ui/pin-entry';
import { SetupShell } from '@/components/ui/setup-shell';
import { friendlyAuthError } from '@/features/auth/form-utils';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { supabase } from '@/lib/supabase/client';
import { spacing, typography } from '@/theme/tokens';

export default function PinSetupScreen() {
  const theme = useBillyTheme();
  const [stage, setStage] = useState<'create' | 'confirm'>('create');
  const [pin, setPin] = useState('');
  const [createdPin, setCreatedPin] = useState('');
  const [feedback, setFeedback] = useState('');
  const [loading, setLoading] = useState(false);

  async function continueFlow() {
    setFeedback('');
    if (pin.length !== 6) {
      setFeedback('Enter all six digits.');
      return;
    }
    if (stage === 'create') {
      setCreatedPin(pin);
      setPin('');
      setStage('confirm');
      if (Platform.OS !== 'web') {
        await Haptics.selectionAsync();
      }
      return;
    }
    if (pin !== createdPin) {
      setPin('');
      setFeedback('Those PINs do not match. Try the confirmation again.');
      if (Platform.OS !== 'web') {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      }
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.rpc('set_transaction_pin', { p_pin: pin });
      if (error) throw error;
      router.push('/(setup)/biometrics');
    } catch (error) {
      setFeedback(friendlyAuthError(error));
    } finally {
      setLoading(false);
    }
  }

  return (
    <SetupShell
      eyebrow="TRANSACTION SECURITY"
      onBack={() => {
        if (stage === 'confirm') {
          setStage('create');
          setPin('');
          setCreatedPin('');
          setFeedback('');
        } else {
          router.back();
        }
      }}
      step={2}
      subtitle={
        stage === 'create'
          ? 'Use a PIN you can remember but others cannot guess.'
          : 'Enter the same six digits once more to confirm.'
      }
      title={stage === 'create' ? 'Create your Billy PIN' : 'Confirm your PIN'}>
      <View style={[styles.iconCircle, { backgroundColor: theme.colors.brandMist }]}>
        <Ionicons color={theme.colors.brand} name="keypad-outline" size={38} />
      </View>
      {feedback ? <FeedbackBanner message={feedback} tone="error" /> : null}
      <PinEntry
        autoFocus
        onChange={(value) => {
          setPin(value);
          if (feedback) setFeedback('');
        }}
        testID="pin-entry"
        value={pin}
      />
      <View style={styles.reassurance}>
        <Ionicons color={theme.colors.textSoft} name="eye-off-outline" size={16} />
        <Text style={[styles.reassuranceText, { color: theme.colors.textMuted }]}>
          Billy never displays or stores your PIN as readable text.
        </Text>
      </View>
      <AppButton
        disabled={pin.length !== 6}
        icon={stage === 'create' ? 'arrow-forward' : 'shield-checkmark-outline'}
        label={stage === 'create' ? 'Continue' : 'Secure my account'}
        loading={loading}
        onPress={continueFlow}
        testID="pin-continue"
      />
    </SetupShell>
  );
}

const styles = StyleSheet.create({
  iconCircle: {
    alignItems: 'center',
    alignSelf: 'center',
    borderRadius: 42,
    height: 84,
    justifyContent: 'center',
    marginBottom: spacing.md,
    width: 84,
  },
  reassurance: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: spacing.xs,
    justifyContent: 'center',
  },
  reassuranceText: {
    flexShrink: 1,
    fontFamily: typography.family,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
});
