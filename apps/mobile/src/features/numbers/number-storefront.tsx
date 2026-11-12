import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppButton } from "@/components/ui/button";
import { CountryFlag } from "@/components/ui/country-flag";
import { TextField } from "@/components/ui/text-field";
import { useAuth } from "@/features/auth/auth-provider";
import { formatMinorUnits } from "@/features/wallet/money";
import { useBillyTheme } from "@/hooks/use-billy-theme";
import { ServiceAvatar } from "./service-card";
import { compareSmsServices, popularSmsRank } from "./popular-services";
import { numberRepository, type SmsProduct, type SmsQuote, type SmsBasketQuote } from "./repository";

const labels: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  CA: "Canada",
  AU: "Australia",
  HK: "Hong Kong",
  ID: "Indonesia",
  AR: "Argentina",
  BR: "Brazil",
  CL: "Chile",
  CO: "Colombia",
  PH: "Philippines",
  TR: "Türkiye",
  ZA: "South Africa",
};
export const smsCountryName = (code: string) => labels[code] ?? code;
export const smsDuration = (days: number) =>
  days === 0 ? "20 minutes" : `${days} days`;
export function smsProducts(
  services: SmsProduct[],
  country: string,
  duration: number,
  query: string,
) {
  const term = query.trim().toLowerCase();
  return services.filter((s) =>
    s.country === country && s.prices[String(duration)] &&
    (!term || s.name.toLowerCase().includes(term))
  ).sort(compareSmsServices);
}

export function NumberStorefront(
  { onDone }: { onDone: (message: string) => void },
) {
  const theme = useBillyTheme(), c = theme.colors, insets = useSafeAreaInsets();
  const { user } = useAuth(), qc = useQueryClient();
  const [country, setCountry] = useState("US"),
    [duration, setDuration] = useState(0);
  const [singleSelection, setSelection] = useState<SmsProduct | null>(null);
  const [basket, setBasket] = useState<SmsProduct[]>([]);
  const checkboxes = duration === 0;
  const multiple = checkboxes && basket.length > 1;
  const selection = checkboxes ? basket[0] ?? null : singleSelection;
  const [sheet, setSheetContent] = useState<
    "country" | "service" | "location" | "review" | null
  >(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Preserve sheet contents during the native dismissal animation, rather than
  // briefly painting an empty review screen as the modal slides away.
  function setSheet(next: typeof sheet) {
    if (next !== null) setSheetContent(next);
    setSheetOpen(next !== null);
  }
  const [search, setSearch] = useState(""), [state, setState] = useState("");
  const [quote, setQuote] = useState<SmsQuote | SmsBasketQuote | null>(null),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false), requestKey = useRef("");
  const serviceList = useRef<FlatList<SmsProduct>>(null);
  const market = useQuery({
    queryKey: ["numbers", user?.id, "market"],
    queryFn: numberRepository.market,
    staleTime: 180_000,
    retry: 1,
  });
  const locations = useQuery({
    queryKey: ["numbers", user?.id, "locations", selection?.id, duration],
    queryFn: () => numberRepository.locations(selection!.id, duration),
    enabled: sheetOpen && sheet === "location" && !!selection && selection.kind !== 'general' && country === "US",
    staleTime: 300_000,
    retry: false,
  });
  const durations = useMemo(
    () =>
      [
        ...new Set(
          (market.data?.services ?? []).filter((s) => s.country === country)
            .flatMap((s) => Object.keys(s.prices).map(Number)),
        ),
      ].sort((a, b) => a - b),
    [market.data, country],
  );
  const sortedProducts = useMemo(
    () => smsProducts(market.data?.services ?? [], country, duration, '').filter((s) => s.kind !== 'general'),
    [market.data, country, duration],
  );
  const products = useMemo(
    () => sortedProducts.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())),
    [sortedProducts, search],
  );
  const visiblePrice = multiple ? basket.reduce((total, p) => total + p.prices['0'], 0) : selection?.prices[String(duration)];
  const hasSelection = multiple ? basket.length > 0 : !!selection;
  const popularCount = products.filter((p) => Number.isFinite(popularSmsRank(p.name))).length;
  const allServices = market.data?.services.find((s) => s.country === country && s.kind === 'general' && s.prices[String(duration)]);
  const durationLabel = (days: number) => market.data?.services.find((s) => s.country === country && s.prices[String(days)] && s.periodLabel)?.periodLabel ?? smsDuration(days);
  const panel = { backgroundColor: c.surface, borderColor: c.border },
    text = { color: c.text },
    muted = { color: c.textMuted };
  function chooseCountry(code: string) {
    setCountry(code);
    const available = (market.data?.services ?? []).filter((s) => s.country === code).flatMap((s) => Object.keys(s.prices).map(Number));
    setDuration(available.length ? Math.min(...available) : 0);
    setSelection(null);
    setBasket([]);
    setState("");
    setQuote(null);
    setNotice("");
    setSheet(null);
  }
  function open(next: typeof sheet) {
    setSearch("");
    setNotice("");
    setSheet(next);
  }
  async function review() {
    if (!hasSelection || lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      setQuote(
        multiple ? await numberRepository.basketQuote(basket.map((p) => p.id)) : await numberRepository.quote(
          selection!.id,
          duration,
          state || undefined,
        ),
      );
      requestKey.current = `sms-${Crypto.randomUUID()}`;
      setSheet("review");
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "Could not check this price. Please try again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function pay() {
    if (!quote || lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      let message: string;
      if ('items' in quote) {
        const checkout = await numberRepository.checkout(quote.quoteToken, requestKey.current).catch(async (error) => {
          // Recover a lost HTTP acknowledgement without creating a new basket.
          const recovered = await numberRepository.checkoutStatus(requestKey.current).catch(() => null);
          if (!recovered) throw error;
          return recovered;
        });
        message = `${checkout.orders.length} number request${checkout.orders.length === 1 ? '' : 's'} saved. Track each one below.`;
      } else {
        const order = await numberRepository.buy(quote.quoteToken, requestKey.current);
        message = order.status_message;
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["numbers", user?.id, "orders"] }),
        qc.invalidateQueries({ queryKey: ["main"] }),
      ]);
      setSheet(null);
      onDone(message);
    } catch (e) {
      setNotice(
        e instanceof Error
          ? e.message
          : "Check My numbers before trying again.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  function toggleService(item: SmsProduct) {
    setQuote(null);
    setState('');
    setNotice('');
    if (basket.some((p) => p.id === item.id)) setBasket(basket.filter((p) => p.id !== item.id));
    else if (basket.length < 10) setBasket([...basket, item]);
    else setNotice('You can choose up to 10 services per checkout.');
  }
  function chip(
    label: string,
    selected: boolean,
    onPress: () => void,
    flag?: string,
  ) {
    return (
      <Pressable
        key={flag ?? label}
        accessibilityRole="button"
        accessibilityLabel={flag ? smsCountryName(flag) : label}
        accessibilityState={{ selected }}
        onPress={onPress}
        style={[styles.chip, {
          backgroundColor: selected ? c.brandMist : c.surfaceMuted,
          borderColor: selected ? c.brand : c.border,
        }]}
      >
        {flag ? <CountryFlag code={flag} /> : null}
        <Text
          style={[styles.chipText, { color: selected ? c.brand : c.textMuted }]}
        >
          {label}
        </Text>
      </Pressable>
    );
  }
  return (
    <>
      <View style={[styles.panel, panel]}>
        <View style={styles.intro}>
          <View style={[styles.mark, { backgroundColor: c.brandMist }]}>
            <Ionicons name="chatbubbles-outline" size={23} color={c.brand} />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.title, text]}>
              Get your SMS number
            </Text>
            <Text style={[styles.body, muted]}>
              Choose a country. Get your SMS here.
            </Text>
          </View>
        </View>
        <Text style={[styles.label, text]}>Country</Text>
        <View style={styles.wrap}>
          {["US", "GB"].filter((code) =>
            !market.data || market.data.countries.includes(code)
          ).map((code) =>
            chip(
              code === "GB" ? "UK" : code,
              country === code,
              () => chooseCountry(code),
              code,
            )
          )}
          {chip(
            ["US", "GB"].includes(country) ? "More" : country,
            !["US", "GB"].includes(country),
            () => open("country"),
            !["US", "GB"].includes(country) ? country : undefined,
          )}
        </View>
        <Text style={[styles.label, text]}>Duration</Text>
        <View style={styles.wrap}>
          {durations.map((days) =>
            chip(durationLabel(days), duration === days, () => {
              setDuration(days);
              setSelection(null);
              setBasket([]);
              setState("");
              setQuote(null);
            })
          )}
        </View>
        {market.isPending
          ? (
            <View style={styles.inline}>
              <ActivityIndicator color={c.brand} />
              <Text style={[styles.body, muted]}>
                Checking available numbers…
              </Text>
            </View>
          )
          : null}
        {market.error
          ? (
            <>
              <Text style={[styles.body, muted]}>{market.error.message}</Text>
              <AppButton
                label="Try again"
                variant="ghost"
                onPress={() => void market.refetch()}
              />
            </>
          )
          : null}
        <Text style={[styles.small, muted]}>
          {selection?.kind === 'general' ? 'One number for different websites and apps. No automatic renewal.' : duration
            ? "Keep the same number for this service. One payment, no automatic renewal."
            : "Use this number for one website or app during its 20-minute rental."}
        </Text>
        <View style={[styles.rule, { backgroundColor: c.border }]} />
        {allServices ? <Pressable
          accessibilityRole="button"
          accessibilityLabel={`All services, ${durationLabel(duration)}, ${formatMinorUnits(allServices.prices[String(duration)], 'NGN')}`}
          accessibilityState={{selected:selection?.id === allServices.id}}
          onPress={() => { setSelection(allServices); setState(''); setQuote(null); setNotice(''); }}
          style={[styles.field, {backgroundColor:c.brandMist, borderColor:selection?.id === allServices.id ? c.brand : c.border}]}
        >
          <Ionicons name="apps-outline" size={28} color={c.brand} />
          <View style={styles.flex}>
            <Text style={[styles.fieldText, text]}>All services</Text>
            <Text style={[styles.small, muted]}>One number · {durationLabel(duration)}</Text>
            <Text style={[styles.price, {color:c.brand}]}>{formatMinorUnits(allServices.prices[String(duration)], 'NGN')}</Text>
          </View>
          <Ionicons name={selection?.id === allServices.id ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={c.brand} />
        </Pressable> : null}
        {sortedProducts.length > 0 || !market.data ? <>
        <View style={styles.between}>
          <Text style={[styles.label, text]}>Website or app</Text>
          <Text style={[styles.small, muted]}>
            {checkboxes && basket.length ? `${basket.length} selected` : selection ? "Selected" : "Choose a service"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose website or app"
          disabled={!market.data}
          onPress={() => open("service")}
          style={[styles.field, panel]}
        >
          {selection && !multiple
            ? <ServiceAvatar name={selection.name} size={40} />
            : <Ionicons name="search-outline" size={22} color={c.textMuted} />}
          <View style={styles.flex}>
            <Text
              style={[styles.fieldText, hasSelection ? text : muted]}
              numberOfLines={2}
            >
              {multiple ? (basket.length ? basket.map((p) => p.name).join(', ') : 'Choose your services') : selection?.name ?? "Search & select website"}
            </Text>
            {visiblePrice
              ? (
                <Text style={[styles.price, { color: c.brand }]}>
                  {formatMinorUnits(visiblePrice, "NGN")}
                </Text>
              )
              : null}
          </View>
          <Ionicons name="chevron-forward" size={19} color={c.textMuted} />
        </Pressable>
        </> : null}
        {country === "CA" && duration === 0
          ? (
            <Text style={[styles.small, muted]}>
              Canadian numbers use VoIP. Check that your app accepts them before
              paying.
            </Text>
          )
          : null}
        {country === "US" && !multiple && selection?.kind !== 'general' && sortedProducts.length > 0
          ? (
            <>
              <View style={styles.between}>
                <Text style={[styles.label, text]}>Location</Text>
                <Text style={[styles.small, muted]}>Optional</Text>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={!selection}
                onPress={() => open("location")}
                style={[styles.field, {
                  backgroundColor: c.surfaceMuted,
                  borderColor: c.border,
                  opacity: selection ? 1 : 0.55,
                }]}
              >
                <Ionicons
                  name="location-outline"
                  size={21}
                  color={c.textMuted}
                />
                <Text style={[styles.fieldText, styles.flex, muted]}>
                  {state
                    ? locations.data?.locations.find((l) => l.code === state)
                      ?.name ?? state
                    : "Any available location"}
                </Text>
                <Ionicons name="chevron-down" size={19} color={c.textMuted} />
              </Pressable>
            </>
          )
          : null}
        {notice && (!sheetOpen || sheet !== "review")
          ? (
            <Text
              accessibilityLiveRegion="polite"
              style={[styles.body, { color: c.text }]}
            >
              {notice}
            </Text>
          )
          : null}
        <AppButton
          label={visiblePrice
            ? `Review · ${formatMinorUnits(visiblePrice, "NGN")}`
            : allServices && !sortedProducts.length ? "Choose your rental to start" : "Choose a website to start"}
          disabled={!hasSelection}
          loading={busy}
          onPress={() => void review()}
        />
        <Text style={[styles.footnote, muted]}>
          Prices include fees. Pay securely with your Billy balance.
        </Text>
      </View>
      <Modal
        visible={sheetOpen}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setSheet(null);
        }}
      >
        <KeyboardAvoidingView
          testID="sms-keyboard-overlay"
          nativeID="billy-sms-keyboard-overlay"
          style={styles.overlay}
          behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
        >
          <View
            testID="sms-picker-sheet"
            accessibilityViewIsModal
            style={[styles.sheet, sheet === 'service' && styles.serviceSheet, {
              backgroundColor: c.canvas,
              paddingBottom: Math.max(sheet === 'service' ? 12 : 20, insets.bottom),
              paddingTop: sheet === 'service' ? 12 : 20,
              marginTop: Math.max(28, insets.top),
            }]}
          >
            <View style={styles.between}>
              <Text style={[styles.sheetTitle, text]}>
                {sheet === "country"
                  ? "Choose a country"
                  : sheet === "service"
                  ? "Choose your service"
                  : sheet === "location"
                  ? "Choose a location"
                  : quote && 'items' in quote ? "Review your numbers" : "Review your number"}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                disabled={busy}
                hitSlop={8}
                onPress={() => setSheet(null)}
                style={[styles.close, { backgroundColor: c.surfaceMuted }]}
              >
                <Ionicons name="close" size={23} color={c.text} />
              </Pressable>
            </View>
            {sheet === "country"
              ? (
                <ScrollView>
                  {market.data?.countries.map((code) => (
                    <Pressable
                      key={code}
                      onPress={() => chooseCountry(code)}
                      accessibilityRole="button"
                      style={[styles.row, { borderBottomColor: c.border }]}
                    >
                      <CountryFlag code={code} />
                      <Text style={[styles.fieldText, styles.flex, text]}>
                        {smsCountryName(code)}
                      </Text>
                      {country === code
                        ? (
                          <Ionicons
                            name="checkmark"
                            color={c.brand}
                            size={22}
                          />
                        )
                        : null}
                    </Pressable>
                  ))}
                </ScrollView>
              )
              : null}
            {sheet === "service"
              ? (
                <>
                  <TextField
                    label="Search services"
                    hideLabel
                    placeholder="WhatsApp, Google, Telegram…"
                    value={search}
                    onChangeText={(value) => {
                      setSearch(value);
                      serviceList.current?.scrollToOffset({ offset: 0, animated: false });
                    }}
                    icon="search-outline"
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={Keyboard.dismiss}
                    autoFocus
                  />
                  <View style={styles.between}>
                    <Text style={[styles.small, muted]}>{checkboxes ? `${basket.length} selected` : durationLabel(duration)}</Text>
                    <Text style={[styles.small, muted]}>{products.length.toLocaleString()} available</Text>
                  </View>
                  <FlatList
                    ref={serviceList}
                    testID="sms-service-results"
                    style={styles.results}
                    data={products}
                    keyExtractor={(item) => item.id}
                    keyboardShouldPersistTaps="handled"
                    initialNumToRender={12}
                    windowSize={5}
                    renderItem={({ item, index }) => (
                      <View>
                        {!search.trim() && (index === 0 || index === popularCount) ? (
                          <Text style={[styles.sectionLabel, muted]}>
                            {index === 0 && popularCount > 0 ? 'Popular services' : 'All services · A–Z'}
                          </Text>
                        ) : null}
                        <Pressable
                          accessibilityRole={checkboxes ? "checkbox" : "button"}
                          accessibilityState={checkboxes ? {checked:basket.some((p) => p.id === item.id)} : undefined}
                          accessibilityLabel={`${item.name}, ${
                            formatMinorUnits(item.prices[String(duration)], "NGN")
                          }`}
                          onPress={() => {
                            if (checkboxes) { toggleService(item); return; }
                            Keyboard.dismiss();
                            setSelection(item);
                            setState("");
                            setQuote(null);
                            setSheet(null);
                          }}
                          style={[styles.row, { borderBottomColor: c.border }]}
                        >
                          <ServiceAvatar name={item.name} size={42} />
                          <Text
                            numberOfLines={2}
                            style={[styles.fieldText, styles.flex, text]}
                          >
                            {item.name}
                          </Text>
                          <Text style={[styles.price, { color: c.brand }]}>
                            {formatMinorUnits(
                              item.prices[String(duration)],
                              "NGN",
                            )}
                          </Text>
                          {checkboxes ? <Ionicons name={basket.some((p) => p.id === item.id) ? 'checkbox' : 'square-outline'} color={c.brand} size={23} /> : null}
                        </Pressable>
                      </View>
                    )}
                    ListEmptyComponent={
                      <Text style={[styles.body, muted]}>
                        No services match. Try a different name.
                      </Text>
                    }
                  />
                  {checkboxes ? <View style={styles.basketFooter}>
                    {notice ? <Text accessibilityLiveRegion="polite" style={[styles.small, text]}>{notice}</Text> : null}
                    <AppButton
                      label={basket.length ? `Use ${basket.length} service${basket.length === 1 ? '' : 's'} · ${formatMinorUnits(visiblePrice ?? 0, 'NGN')}` : 'Choose your services'}
                      disabled={!basket.length}
                      onPress={() => { Keyboard.dismiss(); setSheet(null); }}
                    />
                  </View> : null}
                </>
              )
              : null}
            {sheet === "location"
              ? (
                <ScrollView>
                  <Pressable
                    accessibilityRole="button"
                    style={styles.row}
                    onPress={() => {
                      setState("");
                      setSheet(null);
                    }}
                  >
                    <Ionicons name="globe-outline" size={22} color={c.brand} />
                    <Text style={[styles.fieldText, text]}>
                      Any available location
                    </Text>
                  </Pressable>
                  {locations.isPending
                    ? <ActivityIndicator color={c.brand} />
                    : null}
                  {locations.error
                    ? (
                      <Text style={[styles.body, muted]}>
                        Locations are temporarily unavailable. You can still
                        choose any available location.
                      </Text>
                    )
                    : null}
                  {locations.data?.locations.map((l) => (
                    <Pressable
                      key={l.code}
                      accessibilityRole="button"
                      style={[styles.row, { borderBottomColor: c.border }]}
                      onPress={() => {
                        setState(l.code);
                        setSheet(null);
                      }}
                    >
                      <Text style={[styles.fieldText, text]}>{l.name}</Text>
                    </Pressable>
                  ))}
                </ScrollView>
              )
              : null}
            {sheet === "review" && quote
              ? (
                <ScrollView contentContainerStyle={styles.review}>
                  <View style={styles.reviewBrand}>
                    {'items' in quote || quote.kind === 'general' ? <Ionicons name="chatbubbles-outline" size={42} color={c.brand} /> : <ServiceAvatar name={quote.name} size={62} />}
                    <Text style={[styles.sheetTitle, text]}>{'items' in quote ? `${quote.items.length} SMS numbers` : quote.name}</Text>
                    <View style={styles.inline}>
                      <CountryFlag code={quote.country} />
                      <Text style={[styles.body, muted]}>
                        {smsCountryName(quote.country)} ·{" "}
                        {quote.periodLabel ?? smsDuration(quote.duration)}
                      </Text>
                    </View>
                  </View>
                  {'items' in quote ? quote.items.map((item) => <View key={item.productId} style={[styles.row, {borderBottomColor:c.border}]}>
                    <ServiceAvatar name={item.name} size={36} />
                    <Text style={[styles.fieldText, styles.flex, text]}>{item.name}</Text>
                    <Text style={[styles.price, {color:c.brand}]}>{formatMinorUnits(item.totalMinor, 'NGN')}</Text>
                  </View>) : null}
                  <View style={[styles.summary, panel]}>
                    <Text style={[styles.body, muted]}>
                      Total from your Billy balance
                    </Text>
                    <Text style={[styles.total, text]}>
                      {formatMinorUnits(quote.totalMinor, "NGN")}
                    </Text>
                    <Text style={[styles.small, muted]}>
                      All fees included · One-time payment
                    </Text>
                  </View>
                  <Text style={[styles.body, muted]}>
                    {'items' in quote ? 'You’ll receive a separate number for each service. Each rental is processed independently.' : quote.kind === 'general' ? 'Use this number with different websites and apps. Some apps may not accept every number.' : `This number is for ${quote.name}.`} Request your SMS after the number appears in My numbers.
                    {quote.periodLabel === '1 month' ? ' Eligible unused rentals can be cancelled within 20 minutes. After that, this rental is non-refundable. Exact expiry appears in My numbers.' : quote.kind === 'general' ? ' Long rentals are not automatically refundable if you do not receive a code. Cancellation is available only when eligible.' : ' Eligible cancellations are refunded to your Billy balance after confirmation.'}
                  </Text>
                  {notice
                    ? (
                      <Text
                        accessibilityLiveRegion="polite"
                        style={[styles.body, text]}
                      >
                        {notice}
                      </Text>
                    )
                    : null}
                  <AppButton
                    label={`Pay ${formatMinorUnits(quote.totalMinor, "NGN")}`}
                    loading={busy}
                    onPress={() => void pay()}
                  />
                  <AppButton
                    label="Change selection"
                    variant="ghost"
                    disabled={busy}
                    onPress={() => {
                      setSheet(null);
                    }}
                  />
                </ScrollView>
              )
              : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </>
  );
}
const styles = StyleSheet.create({
  panel: { borderWidth: 1, borderRadius: 28, padding: 20, gap: 16 },
  intro: {
    flexDirection: "row",
    gap: 12,
    alignItems: "center",
    marginBottom: 6,
  },
  mark: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  title: { fontSize: 18, fontWeight: "700", lineHeight: 25 },
  body: { fontSize: 14, lineHeight: 22 },
  label: { fontSize: 15, fontWeight: "700" },
  small: { fontSize: 12, lineHeight: 19 },
  footnote: { fontSize: 11, lineHeight: 17, textAlign: "center" },
  flex: { flex: 1, minWidth: 0 },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 9 },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    minHeight: 46,
    paddingHorizontal: 17,
    paddingVertical: 9,
    borderWidth: 1,
    borderRadius: 24,
  },
  chipText: { fontWeight: "700", fontSize: 14 },
  between: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    flexWrap: "wrap",
  },
  rule: { height: 1, marginVertical: 4 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 17,
    padding: 15,
    minHeight: 64,
  },
  fieldText: { fontSize: 15, lineHeight: 21, fontWeight: "600" },
  price: { fontSize: 14, fontWeight: "700", marginTop: 3 },
  overlay: {
    flex: 1,
    minHeight: 0,
    backgroundColor: "#00000080",
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "93%",
    minHeight: "50%",
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    gap: 16,
    alignSelf: "center",
    width: "100%",
    maxWidth: 680,
  },
  sheetTitle: { fontSize: 22, fontWeight: "700", flexShrink: 1 },
  // A filtering result count must never determine the picker height.
  serviceSheet: { height: '93%', minHeight: 0, flexShrink: 1, gap: 8 },
  results: { flex: 1, minHeight: 0 },
  basketFooter: {gap:6},
  sectionLabel: { fontSize: 12, fontWeight: '700', paddingTop: 8, paddingBottom: 5 },
  close: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 15,
    borderBottomWidth: StyleSheet.hairlineWidth,
    minHeight: 70,
  },
  review: { gap: 22, paddingBottom: 12 },
  reviewBrand: { alignItems: "center", gap: 12, paddingVertical: 8 },
  summary: {
    padding: 20,
    borderWidth: 1,
    borderRadius: 20,
    gap: 8,
    alignItems: "center",
  },
  total: { fontSize: 32, fontWeight: "700" },
});
