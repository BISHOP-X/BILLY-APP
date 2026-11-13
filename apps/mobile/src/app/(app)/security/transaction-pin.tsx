import { goBackSafely } from '@/lib/back-navigation';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { AppScreen } from '@/components/layout/app-screen';
import { AppButton } from '@/components/ui/button';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { PinEntry } from '@/components/ui/pin-entry';
import { ScreenHeader } from '@/components/ui/screen-header';
import { friendlyAuthError } from '@/features/auth/form-utils';
import { isCompleteNewTransactionPin } from '@/features/security/transaction-pin';
import { supabase } from '@/lib/supabase/client';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { useAuth } from '@/features/auth/auth-provider';

export default function TransactionPinScreen() {
  const theme = useBillyTheme();
  const { user } = useAuth();
  const [checking, setChecking] = useState(true);
  const [exists, setExists] = useState(false);
  const [stage, setStage] = useState<'create' | 'confirm'>('create');
  const [pin, setPin] = useState('');
  const [firstPin, setFirstPin] = useState('');
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [checkFailed, setCheckFailed] = useState(false);
  useEffect(() => {
    let active = true;
    if (!user) return;
    void Promise.resolve(
      supabase.from('user_security_settings').select('transaction_pin_set_at').eq(
        'user_id',
        user.id,
      ).single(),
    ).then(({ data, error }) => {
      if (!active) return;
      if (error) throw error;
      setExists(!!data.transaction_pin_set_at);
    }).catch(() => {
      if (active) {
        setCheckFailed(true);
        setFeedback('Could not check your PIN. Please try again.');
      }
    })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [user, retry]);
  async function submit() {
    if (busy || checking || checkFailed || !isCompleteNewTransactionPin(pin)) return;
    setFeedback('');
    if (stage === 'create') {
      setFirstPin(pin);
      setPin('');
      setStage('confirm');
      return;
    }
    if (pin !== firstPin) {
      setFeedback('Those PINs do not match. Try again.');
      setPin('');
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.rpc('set_transaction_pin', { p_pin: pin });
      if (error) throw error;
      setPin('');
      setFirstPin('');
      setExists(true);
    } catch (error) {
      setFeedback(friendlyAuthError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AppScreen bottomSafe>
      <ScreenHeader
        title='Transaction PIN'
        onBack={() => {
          if (stage === 'confirm' && !exists) {
            setStage('create');
            setPin('');
            setFirstPin('');
            setFeedback('');
          } else goBackSafely();
        }}
      />
      <Text style={{ color: theme.colors.textMuted, fontSize: 15, lineHeight: 23 }}>
        {exists
          ? 'Your PIN is ready. Use it for withdrawals and sending crypto outside Billy.'
          : stage === 'create'
          ? 'Choose four digits for withdrawals and sending crypto outside Billy. You do not need a PIN for purchases.'
          : 'Enter those four digits again to confirm.'}
      </Text>
      {feedback ? <FeedbackBanner message={feedback} tone='error' /> : null}
      {checkFailed
        ? (
          <AppButton
            label='Try again'
            onPress={() => {
              setFeedback('');
              setChecking(true);
              setCheckFailed(false);
              setRetry((r) => r + 1);
            }}
          />
        )
        : exists
        ? <AppButton label='Done' onPress={goBackSafely} />
        : (
          <>
            <PinEntry length={4} value={pin} onChange={setPin} testID='security-pin-entry' />
            <AppButton
              label={stage === 'create' ? 'Continue' : 'Save PIN'}
              onPress={() => void submit()}
              loading={busy || checking}
              disabled={!isCompleteNewTransactionPin(pin) || checking}
            />
          </>
        )}
    </AppScreen>
  );
}
