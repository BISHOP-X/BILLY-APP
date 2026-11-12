import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Crypto from "expo-crypto";
import { useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
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
import { numberRepository, type SmsProduct, type SmsQuote } from "./repository";

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
  );
}

export function NumberStorefront(
  { onDone }: { onDone: (message: string) => void },
) {
  const theme = useBillyTheme(), c = theme.colors, insets = useSafeAreaInsets();
  const { user } = useAuth(), qc = useQueryClient();
  const [country, setCountry] = useState("US"),
    [duration, setDuration] = useState(0);
  const [selection, setSelection] = useState<SmsProduct | null>(null);
  const [sheet, setSheet] = useState<
    "country" | "service" | "location" | "review" | null
  >(null);
  const [search, setSearch] = useState(""), [state, setState] = useState("");
  const [quote, setQuote] = useState<SmsQuote | null>(null),
    [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false), requestKey = useRef("");
  const market = useQuery({
    queryKey: ["numbers", user?.id, "market"],
    queryFn: numberRepository.market,
    staleTime: 180_000,
    retry: 1,
  });
  const locations = useQuery({
    queryKey: ["numbers", user?.id, "locations", selection?.id],
    queryFn: () => numberRepository.locations(selection!.id, duration),
    enabled: sheet === "location" && !!selection && country === "US",
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
  const products = useMemo(
    () => smsProducts(market.data?.services ?? [], country, duration, search),
    [market.data, country, duration, search],
  );
  const visiblePrice = selection?.prices[String(duration)];
  const panel = { backgroundColor: c.surface, borderColor: c.border },
    text = { color: c.text },
    muted = { color: c.textMuted };
  function chooseCountry(code: string) {
    setCountry(code);
    setDuration(0);
    setSelection(null);
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
    if (!selection || lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      setQuote(
        await numberRepository.quote(
          selection.id,
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
      const order = await numberRepository.buy(
        quote.quoteToken,
        requestKey.current,
      );
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["numbers", user?.id, "orders"] }),
        qc.invalidateQueries({ queryKey: ["main"] }),
      ]);
      setSheet(null);
      setQuote(null);
      onDone(order.status_message);
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
            chip(smsDuration(days), duration === days, () => {
              setDuration(days);
              setSelection(null);
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
          {duration
            ? "Keep the same number for this service. One payment, no automatic renewal."
            : "Use this number for one website or app during its 20-minute rental."}
        </Text>
        <View style={[styles.rule, { backgroundColor: c.border }]} />
        <View style={styles.between}>
          <Text style={[styles.label, text]}>Website or app</Text>
          <Text style={[styles.small, muted]}>
            {selection ? "Selected" : "Choose a service"}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Choose website or app"
          disabled={!market.data}
          onPress={() => open("service")}
          style={[styles.field, panel]}
        >
          {selection
            ? <ServiceAvatar name={selection.name} size={40} />
            : <Ionicons name="search-outline" size={22} color={c.textMuted} />}
          <View style={styles.flex}>
            <Text
              style={[styles.fieldText, selection ? text : muted]}
              numberOfLines={2}
            >
              {selection?.name ?? "Search & select website"}
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
        {country === "CA"
          ? (
            <Text style={[styles.small, muted]}>
              Canadian numbers use VoIP. Check that your app accepts them before
              paying.
            </Text>
          )
          : null}
        {country === "US"
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
        {notice && sheet !== "review"
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
            : "Choose a website to start"}
          disabled={!selection}
          loading={busy}
          onPress={() => void review()}
        />
        <Text style={[styles.footnote, muted]}>
          Prices include fees. Pay securely with your Billy balance.
        </Text>
      </View>
      <Modal
        visible={sheet !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!busy) setSheet(null);
        }}
      >
        <KeyboardAvoidingView style={styles.overlay} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <View
            accessibilityViewIsModal
            style={[styles.sheet, {
              backgroundColor: c.canvas,
              paddingBottom: Math.max(20, insets.bottom),
              paddingTop: 20,
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
                  : "Review your number"}
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
                    placeholder="WhatsApp, Google, Telegram…"
                    value={search}
                    onChangeText={setSearch}
                    icon="search-outline"
                    autoFocus
                  />
                  <Text style={[styles.small, muted]}>
                    {smsCountryName(country)} · {smsDuration(duration)} ·{" "}
                    {products.length.toLocaleString()} available
                  </Text>
                  <FlatList
                    data={products}
                    keyExtractor={(item) => item.id}
                    keyboardShouldPersistTaps="handled"
                    initialNumToRender={12}
                    windowSize={5}
                    renderItem={({ item }) => (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`${item.name}, ${
                          formatMinorUnits(item.prices[String(duration)], "NGN")
                        }`}
                        onPress={() => {
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
                      </Pressable>
                    )}
                    ListEmptyComponent={
                      <Text style={[styles.body, muted]}>
                        No services match. Try a different name.
                      </Text>
                    }
                  />
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
                    <ServiceAvatar name={quote.name} size={62} />
                    <Text style={[styles.sheetTitle, text]}>{quote.name}</Text>
                    <View style={styles.inline}>
                      <CountryFlag code={quote.country} />
                      <Text style={[styles.body, muted]}>
                        {smsCountryName(quote.country)} ·{" "}
                        {smsDuration(quote.duration)}
                      </Text>
                    </View>
                  </View>
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
                    This number is for{" "}
                    {quote.name}. Request your SMS after the number appears in
                    My numbers. Eligible cancellations are refunded to your
                    Billy balance after confirmation.
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
                      setQuote(null);
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
