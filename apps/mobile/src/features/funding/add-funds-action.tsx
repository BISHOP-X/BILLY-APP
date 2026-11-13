import { lazy, Suspense, useState } from 'react';
import { ActivityIndicator, Keyboard, Modal, Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { AppButton } from '@/components/ui/button';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { loadFundingScreen } from './load-funding-screen';

const AddMoneyScreen = lazy(loadFundingScreen);

export function isInsufficientFunds(message: string) {
  // Customer wallet errors only. A provider's depleted account cannot be fixed by a customer top-up.
  return !/provider|supplier|sale proceeds|crypto balance/i.test(message) &&
    /insufficient (?:available |wallet |available wallet )?(?:funds|balance)|not enough (?:money|funds|balance)|wallet balance is too low/i.test(message);
}

export function AddFundsAction({ message }: { message: string }) {
  const [open, setOpen] = useState(false);
  const { colors } = useBillyTheme();
  const qc = useQueryClient();
  if (!isInsufficientFunds(message)) return null;
  function close() {
    setOpen(false);
    void qc.invalidateQueries({ queryKey: ['main'] });
    // The purchase stays mounted. No automatic retry or payment is performed.
  }
  return <View style={{ gap: 8, marginTop: 8 }}>
    <Text style={{ color: colors.textMuted, fontSize: 13 }}>Top up your balance, then return here to confirm your purchase.</Text>
    <AppButton label="Add money" icon="add" onPress={() => { Keyboard.dismiss(); setOpen(true); }} />
    <Modal visible={open} animationType="slide" onRequestClose={close} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: colors.canvas }}>
        <Suspense fallback={<View style={{ padding: 24, gap: 16 }}><ActivityIndicator color={colors.brand} /><AppButton label="Return to purchase" onPress={close} /></View>}>
          {open ? <AddMoneyScreen onReturnToPurchase={close} /> : null}
        </Suspense>
      </View>
    </Modal>
  </View>;
}
