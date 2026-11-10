import Ionicons from '@expo/vector-icons/Ionicons';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { AppButton } from '@/components/ui/button';
import { CountryFlag } from '@/components/ui/country-flag';
import { FeedbackBanner } from '@/components/ui/feedback-banner';
import { TextField } from '@/components/ui/text-field';
import { invokeAction } from '@/features/services/supabase-service-repository';
import { useBillyTheme } from '@/hooks/use-billy-theme';
import { radii, spacing, typography } from '@/theme/tokens';
import type { CommerceProduct, TopupRecipient } from './domain';

export type TopupDraft = { phone: string; result: TopupRecipient | null };
export function TopupRecipientPicker(
  { kind, draft, onDraft, onChoose, onStepChange }: {
    kind: 'airtime' | 'data';
    draft: TopupDraft;
    onDraft: (draft: TopupDraft) => void;
    onChoose: (product: CommerceProduct, phone: string) => void;
    onStepChange?: () => void;
  },
) {
  const theme = useBillyTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState('');
  const [regional, setRegional] = useState<CommerceProduct | null>(null);
  const flight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const text = { color: theme.colors.text };
  const muted = { color: theme.colors.textMuted };
  const panel = {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
  };
  async function run(work: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      await work();
    } catch (e) {
      if (mounted.current) {
        setError(e instanceof Error ? e.message : 'Please try again.');
      }
    } finally {
      flight.current = false;
      if (mounted.current) setBusy(false);
    }
  }
  function lookup(country?: string) {
    Keyboard.dismiss();
    void run(async () => {
      const result = await invokeAction<TopupRecipient>('commerce.recipient', {
        kind,
        phone: draft.phone,
        ...(country ? { country } : {}),
      });
      if (!mounted.current) return;
      onDraft({ phone: result.phone, result });
      setShowAll(false);
      setSearch('');
      onStepChange?.();
    });
  }
  function edit() {
    onDraft({ ...draft, result: null });
    setRegional(null);
    setError('');
    onStepChange?.();
  }
  function choose(product: CommerceProduct, region?: string) {
    void run(async () => {
      const full = await invokeAction<CommerceProduct>('commerce.product', {
        selectionToken: product.selectionToken,
        ...(region ? { region } : {}),
      });
      if (!mounted.current) return;
      if (full.regions.length && !full.region) {
        setRegional(full);
        setSearch('');
        onStepChange?.();
      } else onChoose(full, draft.result!.phone);
    });
  }
  const result = draft.result;
  const recommended = result?.products.filter((p) => p.recommended) ?? [];
  const choices =
    (showAll || !recommended.length ? result?.products ?? [] : recommended)
      .filter((p) =>
        p.name.toLowerCase().includes(search.trim().toLowerCase())
      );
  return (
    <View style={styles.stack}>
      {!result
        ? (
          <View style={[styles.card, panel]}>
            <View
              style={[styles.icon, { backgroundColor: theme.colors.brandMist }]}
            >
              <Ionicons
                name='phone-portrait-outline'
                size={26}
                color={theme.colors.brand}
              />
            </View>
            <Text accessibilityRole='header' style={[styles.heading, text]}>
              Who’s it for?
            </Text>
            <Text style={[styles.body, muted]}>
              Enter a number. We’ll find its country and network.
            </Text>
            <TextField
              label='Phone number'
              icon='call-outline'
              value={draft.phone}
              onChangeText={(phone) => {
                onDraft({ phone, result: null });
                setError('');
              }}
              keyboardType='phone-pad'
              autoComplete='tel'
              textContentType='telephoneNumber'
              placeholder='+234 803 123 4567'
              disabled={busy}
              maxLength={40}
              returnKeyType='done'
              onSubmitEditing={() => {
                if (draft.phone.trim()) lookup();
              }}
            />
            <Text style={[styles.caption, muted]}>
              Include the country code, e.g. +234 for Nigeria or +44 for the UK.
            </Text>
            {error ? <FeedbackBanner tone='error' message={error} /> : null}
            <AppButton
              label={busy ? 'Finding network' : 'Continue'}
              loading={busy}
              disabled={!draft.phone.trim()}
              onPress={() => lookup()}
            />
          </View>
        )
        : (
          <>
            <View style={[styles.card, panel]}>
              <View style={styles.row}>
                <CountryFlag
                  code={result.country?.code ?? ''}
                  name={result.country?.name}
                />
                <View style={{ flex: 1, gap: 4 }}>
                  <Text selectable style={[styles.label, text]}>
                    {result.formattedPhone}
                  </Text>
                  <Text style={[styles.caption, muted]}>
                    {result.country?.name || 'Confirm country'}
                    {result.network ? ` · ${result.network}` : ''}
                  </Text>
                </View>
                <AppButton
                  label='Edit number'
                  variant='ghost'
                  disabled={busy}
                  onPress={edit}
                />
              </View>
            </View>
            {result.needsCountry
              ? (
                <>
                  <Text style={[styles.body, text]}>
                    This calling code covers more than one country. Choose the
                    recipient’s country.
                  </Text>
                  {result.countries.map((c) => (
                    <Pressable
                      key={c.code}
                      accessibilityRole='button'
                      accessibilityLabel={c.name}
                      disabled={busy}
                      onPress={() => lookup(c.code)}
                      style={[styles.option, panel]}
                    >
                      <CountryFlag code={c.code} name={c.name} />
                      <Text style={[styles.label, text]}>{c.name}</Text>
                    </Pressable>
                  ))}
                  {!result.countries.length
                    ? (
                      <FeedbackBanner message='This number’s country is not supported. Check the number and try again.' />
                    )
                    : null}
                </>
              )
              : regional
              ? (
                <>
                  <AppButton
                    label='Back to networks'
                    icon='arrow-back'
                    variant='ghost'
                    disabled={busy}
                    onPress={() => {
                      setRegional(null);
                      setSearch('');
                    }}
                  />
                  <Text style={[styles.heading, text]}>
                    Choose the recipient’s region
                  </Text>
                  <TextField
                    label='Find region'
                    value={search}
                    onChangeText={setSearch}
                  />
                  {regional.regions.filter((r) =>
                    r.toLowerCase().includes(search.toLowerCase())
                  ).map((r) => (
                    <AppButton
                      key={r}
                      label={r}
                      variant='secondary'
                      disabled={busy}
                      onPress={() => choose(regional, r)}
                    />
                  ))}
                </>
              )
              : (
                <>
                  <View style={styles.row}>
                    <Text
                      accessibilityRole='header'
                      style={[styles.heading, text, { flex: 1 }]}
                    >
                      {showAll || !recommended.length
                        ? 'Choose network'
                        : kind === 'data'
                        ? 'Data & bundles'
                        : 'Your network'}
                    </Text>
                    {recommended.length
                      ? (
                        <AppButton
                          label={showAll
                            ? 'Use detected network'
                            : 'Change network'}
                          variant='ghost'
                          disabled={busy}
                          onPress={() => {
                            setShowAll(!showAll);
                            setSearch('');
                          }}
                        />
                      )
                      : null}
                  </View>
                  <Text style={[styles.caption, muted]}>
                    {recommended.length && !showAll
                      ? 'Check the network is right, especially if the number has switched networks.'
                      : 'Choose the recipient’s current network. Only options for their country are shown.'}
                  </Text>
                  {(showAll || !recommended.length) &&
                      (result.products.length > 5)
                    ? (
                      <TextField
                        label='Find network'
                        icon='search-outline'
                        value={search}
                        onChangeText={setSearch}
                        placeholder='Type to filter'
                      />
                    )
                    : null}
                  {choices.map((p) => (
                    <Pressable
                      key={p.selectionToken}
                      accessibilityRole='button'
                      accessibilityLabel={`Choose ${p.name}`}
                      disabled={busy}
                      onPress={() => choose(p)}
                      style={[styles.option, panel]}
                    >
                      {p.image
                        ? (
                          <Image
                            source={{ uri: p.image }}
                            contentFit='contain'
                            style={styles.logo}
                            accessibilityLabel={`${p.name} logo`}
                          />
                        )
                        : (
                          <Ionicons
                            name='cellular-outline'
                            size={28}
                            color={theme.colors.brand}
                          />
                        )}
                      <View style={{ flex: 1, gap: 4 }}>
                        <Text style={[styles.label, text]}>{p.name}</Text>
                        <Text style={[styles.caption, muted]}>
                          {kind === 'data'
                            ? 'View plans & naira prices'
                            : 'Choose an amount'}
                        </Text>
                      </View>
                      <Ionicons
                        name='chevron-forward'
                        size={18}
                        color={theme.colors.textMuted}
                      />
                    </Pressable>
                  ))}
                  {!choices.length
                    ? (
                      <FeedbackBanner
                        message={search
                          ? 'No matching network.'
                          : 'No options are available for this country right now.'}
                      />
                    )
                    : null}
                </>
              )}
            {busy
              ? (
                <Text
                  accessibilityLiveRegion='polite'
                  style={[styles.caption, muted]}
                >
                  Loading options…
                </Text>
              )
              : null}
            {error ? <FeedbackBanner tone='error' message={error} /> : null}
          </>
        )}
    </View>
  );
}
const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  card: { padding: 20, borderWidth: 1, borderRadius: radii.xl, gap: 16 },
  icon: {
    width: 52,
    height: 52,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },
  option: {
    padding: 16,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 76,
  },
  logo: { width: 46, height: 46, borderRadius: 12, backgroundColor: '#FFFFFF' },
  heading: {
    fontFamily: typography.familyRounded,
    fontSize: 22,
    fontWeight: '800',
  },
  label: {
    fontFamily: typography.familyRounded,
    fontSize: 15,
    fontWeight: '700',
  },
  body: { fontFamily: typography.family, fontSize: 15, lineHeight: 23 },
  caption: { fontFamily: typography.family, fontSize: 12, lineHeight: 19 },
});
