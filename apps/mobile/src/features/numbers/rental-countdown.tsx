import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import type { NumberOrder } from './repository';

export function rentalClock(order: NumberOrder, now: number) {
  const end = Date.parse(order.expires_at ?? order.rental_end ?? '');
  if (order.rental_kind !== 'short' || !Number.isFinite(end) || order.rental_closed || ['cancelled', 'failed'].includes(order.status)) return null;
  const seconds = Math.max(0, Math.ceil((end - now) / 1000));
  return { seconds, label: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`, progress: Math.min(1, seconds / 1200) };
}

export function RentalCountdown({ order }: { order: NumberOrder }) {
  const { colors: c } = useBillyTheme();
  const [now, setNow] = useState(Date.now);
  const clock = rentalClock(order, now);
  const ticking = !!clock && clock.seconds > 0;
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);
  if (!clock) return null;
  return <View style={{ padding: 16, gap: 10, borderRadius: 18, backgroundColor: c.surfaceMuted }}>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
      <Text style={{ color: c.text, fontWeight: '700', flexShrink: 1 }}>{clock.seconds ? (order.sms_code ? 'Code received' : 'Waiting for SMS') : order.sms_code ? 'Rental ended' : 'Confirming refund'}</Text>
      <Text style={{ color: c.brand, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{clock.label}</Text>
    </View>
    <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 1200, now: Math.min(1200, clock.seconds) }} accessibilityLabel="Rental time remaining" style={{ height: 5, borderRadius: 4, overflow: 'hidden', backgroundColor: c.border }}>
      <View style={{ height: 5, width: `${clock.progress * 100}%`, backgroundColor: c.brand }} />
    </View>
    {!clock.seconds && !order.sms_code ? <Text style={{ color: c.textMuted }}>Your rental has ended. We’re checking the final status before returning eligible funds.</Text> : null}
  </View>;
}
