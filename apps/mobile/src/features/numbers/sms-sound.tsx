import { useQueries } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { numberRepository, type NumberOrder } from './repository';

export function unseenMessages(seen: Set<string>, ids: string[], initialized: boolean) {
  const fresh = initialized && ids.some((id) => !seen.has(id));
  ids.forEach((id) => seen.add(id));
  return fresh;
}

export function SmsSound({ orders }: { orders: NumberOrder[] }) {
  const { user } = useAuth();
  const { colors } = useBillyTheme();
  const [enabled, setEnabled] = useState(false);
  const [error, setError] = useState('');
  const audio = useRef<AudioContext | null>(null);
  const seen = useRef(new Map<string, Set<string>>());
  const ids = orders.filter((o) => o.phone_number && !o.rental_closed).map((o) => o.id);
  const results = useQueries({ queries: ids.map((id) => ({
    queryKey: ['numbers', user?.id, 'messages', id, 1],
    queryFn: () => numberRepository.messages(id, 1),
    enabled: enabled && Platform.OS === 'web',
    refetchInterval: enabled ? 10_000 : false,
  })) });
  function chime(context: AudioContext) {
    const oscillator = context.createOscillator(), gain = context.createGain();
    oscillator.connect(gain); gain.connect(context.destination);
    oscillator.frequency.setValueAtTime(740, context.currentTime);
    oscillator.frequency.setValueAtTime(988, context.currentTime + 0.12);
    gain.gain.setValueAtTime(0.0001, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.4);
    oscillator.start(); oscillator.stop(context.currentTime + 0.42);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }
  useEffect(() => {
    let fresh = false;
    results.forEach((result, index) => {
      if (!result.data) return;
      const previous = seen.current.get(ids[index]);
      const set = previous ?? new Set<string>();
      if (unseenMessages(set, result.data.messages.map((m) => m.id), !!previous)) fresh = true;
      seen.current.set(ids[index], set);
    });
    if (enabled && fresh && audio.current?.state === 'running') chime(audio.current);
  });
  useEffect(() => () => { void audio.current?.close(); }, []);
  if (Platform.OS !== 'web') return null;
  async function toggle() {
    if (enabled) { setEnabled(false); return; }
    try {
      const Constructor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audio.current ??= new Constructor();
      await audio.current.resume();
      if (audio.current.state !== 'running') throw new Error('blocked');
      seen.current.clear(); chime(audio.current); setEnabled(true); setError('');
    } catch { setError('Sound could not start. Tap to try again.'); }
  }
  return <View><AppButton label={enabled ? 'SMS sound on · mute' : 'Enable SMS sound'} variant="ghost" icon={enabled ? 'volume-high-outline' : 'volume-mute-outline'} onPress={() => void toggle()} />{error ? <Text style={{ color: colors.textMuted }}>{error}</Text> : null}</View>;
}
