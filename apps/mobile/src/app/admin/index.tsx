import Ionicons from '@expo/vector-icons/Ionicons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAuth } from '@/features/auth/auth-provider';
import {
  AdminButton,
  AdminInput,
  AdminText,
  Badge,
  Panel,
  adminColors as c,
} from '@/features/admin/components';
import {
  adminMoney,
  adminSections,
  inputTwoDecimals,
  parseTwoDecimals,
  type AdminPage,
  type AdminRow,
  type AdminSection,
  type AdminSettings,
  type Pricing,
} from '@/features/admin/domain';
import { invokeAction } from '@/features/services/supabase-service-repository';

const sectionDetails: Record<AdminSection, string> = {
  overview: 'A clear view of Billy, from payments to customer support.',
  transactions: 'Follow the ledger. Every movement has a reference.',
  users: 'Customer accounts, wallet access and onboarding progress.',
  numbers: 'Number allocation, code delivery and confirmed refunds.',
  social: 'Track delivery, cancellation and order reconciliation.',
  catalog: 'Control the services available in the live catalogue.',
  funding: 'Permanent deposit accounts, with bank details masked.',
  kyc: 'Verification status only. Sensitive identity documents stay private.',
  support: 'Review and resolve customer requests.',
  settings: 'Set your pricing and control service availability.',
  audit: 'An immutable record of administrator changes.',
};
type Change = { title: string; input: Record<string, unknown> };
const valueText = (value: unknown) =>
  value == null
    ? '—'
    : typeof value === 'object'
      ? JSON.stringify(value)
      : String(value);

export default function BillyAdmin() {
  const auth = useAuth();
  const qc = useQueryClient();
  const { width } = useWindowDimensions();
  const wide = width >= 1000;
  const params = useLocalSearchParams<{ section?: string }>();
  const section: AdminSection = adminSections.some(
    (s) => s[0] === params.section,
  )
    ? (params.section as AdminSection)
    : 'overview';
  const [message, setMessage] = useState('');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [change, setChange] = useState<Change | null>(null);
  const [reason, setReason] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  const access = useQuery({
    queryKey: ['admin', auth.user?.id, 'session'],
    queryFn: () => invokeAction<{ admin: boolean }>('admin.session', {}),
    enabled: auth.status === 'authenticated',
    retry: false,
    staleTime: 60_000,
  });
  const view = useQuery({
    queryKey: ['admin', auth.user?.id, section, page, query, status],
    queryFn: () =>
      invokeAction<AdminPage & AdminSettings & Record<string, unknown>>(
        'admin.read',
        { section, page, query, status },
      ),
    enabled: access.data?.admin === true,
    retry: false,
  });
  const mutation = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      invokeAction('admin.change', input),
    retry: false,
    onSuccess: async () => {
      setChange(null);
      setReason('');
      setMessage('Change saved. The audit trail has been updated.');
      await qc.invalidateQueries({ queryKey: ['admin', auth.user?.id] });
      await qc.invalidateQueries({ queryKey: ['main'] });
    },
  });
  const reconcile = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      invokeAction('admin.refresh', input),
    retry: false,
    onSuccess: async () => {
      setMessage('Status checked against the provider.');
      await view.refetch();
    },
  });
  function navigate(next: AdminSection) {
    router.setParams({ section: next });
    setPage(1);
    setSearch('');
    setQuery('');
    setStatus('');
    setMessage('');
    setExpanded(null);
    setChange(null);
  }
  function propose(title: string, input: Record<string, unknown>) {
    setChange({ title, input });
    setReason('');
    setMessage('');
  }
  async function logout() {
    try {
      await auth.signOut();
      qc.removeQueries({ queryKey: ['admin'] });
    } catch {
      setMessage('Sign-out failed. Please try again.');
    }
  }
  async function save() {
    if (!change) return;
    try {
      await mutation.mutateAsync({ ...change.input, reason });
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Change could not be saved.');
    }
  }
  const title = adminSections.find((s) => s[0] === section)![1];
  const navigation = adminSections.map(([id, label, icon]) => (
    <Pressable
      key={id}
      accessibilityRole="button"
      accessibilityState={{ selected: section === id }}
      onPress={() => navigate(id)}
      style={[
        styles.navItem,
        section === id && styles.navActive,
        !wide && styles.navMobile,
      ]}
    >
      <Ionicons
        name={icon}
        size={18}
        color={section === id ? '#DAF3CB' : '#ADC2B5'}
      />
      <Text style={[styles.navText, section === id && { color: '#F5F8F1' }]}>
        {label}
      </Text>
    </Pressable>
  ));
  if (
    auth.status === 'loading' ||
    (auth.status === 'authenticated' && access.isPending)
  )
    return (
      <SafeAreaView style={styles.loading}>
        <ActivityIndicator color={c.green} />
        <AdminText>Opening Billy Operations…</AdminText>
      </SafeAreaView>
    );
  if (auth.status !== 'authenticated')
    return <Redirect href="/(auth)/sign-in" />;
  if (access.error || access.data?.admin !== true)
    return <Redirect href="/(app)/home" />;
  return (
    <SafeAreaView
      edges={['top', 'left', 'right', 'bottom']}
      style={styles.root}
    >
      <View style={[styles.workspace, wide && { flexDirection: 'row' }]}>
        {wide ? (
          <View style={styles.sidebar}>
            <View style={styles.brand}>
              <View style={styles.smallMark}>
                <Ionicons name="layers-outline" size={22} color="#DCF9CE" />
              </View>
              <View>
                <Text style={styles.brandName}>billy</Text>
                <Text style={styles.brandSub}>OPERATIONS</Text>
              </View>
            </View>
            <ScrollView contentContainerStyle={styles.navList}>
              {navigation}
            </ScrollView>
            <View style={styles.sidebarFooter}>
              <Text style={styles.adminEmail}>support@billyapp.org</Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => void logout()}
                style={styles.navItem}
              >
                <Ionicons name="log-out-outline" size={18} color="#CDE0D1" />
                <Text style={styles.navText}>Sign out</Text>
              </Pressable>
            </View>
          </View>
        ) : (
          <View style={styles.mobileTop}>
            <View style={styles.mobileBrand}>
              <Text style={styles.brandName}>
                billy{' '}
                <Text style={{ fontSize: 13, color: '#ADBFAC' }}>
                  {' '}
                  / operations
                </Text>
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Sign out"
                onPress={() => void logout()}
                style={{ padding: 10 }}
              >
                <Ionicons name="log-out-outline" color="#E4F1E2" size={23} />
              </Pressable>
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                gap: 5,
                paddingHorizontal: 12,
                paddingBottom: 12,
              }}
            >
              {navigation}
            </ScrollView>
          </View>
        )}
        <ScrollView
          style={styles.main}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={[
            styles.mainContent,
            !wide && { padding: 16, gap: 20 },
          ]}
        >
          <View style={styles.actions}>
            <AdminButton
              label="User Section"
              secondary
              onPress={() => router.replace('/(app)/home')}
            />
          </View>
          <View style={styles.header}>
            <View style={{ flex: 1, gap: 7 }}>
              <Text style={styles.eyebrow}>BILLY / {title.toUpperCase()}</Text>
              <Text
                accessibilityRole="header"
                style={[styles.title, !wide && { fontSize: 28 }]}
              >
                {title}
              </Text>
              <AdminText muted>{sectionDetails[section]}</AdminText>
            </View>
            <AdminButton
              label="Refresh"
              secondary
              busy={view.isFetching}
              onPress={() => void view.refetch()}
            />
          </View>
          {message ? (
            <Panel>
              <View accessibilityLiveRegion="polite">
                <AdminText>{message}</AdminText>
              </View>
              <AdminButton
                label="Dismiss"
                secondary
                onPress={() => setMessage('')}
              />
            </Panel>
          ) : null}
          {change ? (
            <Panel>
              <AdminText large>{change.title}</AdminText>
              <AdminText muted>
                Review this action and record why it is needed. The change will
                be attributed to your administrator account.
              </AdminText>
              <AdminInput
                label="Reason for this change"
                value={reason}
                onChangeText={setReason}
                maxLength={240}
                placeholder="Explain the operational reason"
              />
              <View style={styles.actions}>
                <AdminButton
                  label="Confirm change"
                  disabled={reason.trim().length < 5}
                  busy={mutation.isPending}
                  onPress={() => void save()}
                />
                <AdminButton
                  label="Cancel"
                  secondary
                  disabled={mutation.isPending}
                  onPress={() => setChange(null)}
                />
              </View>
            </Panel>
          ) : null}
          {view.isPending ? (
            <Panel>
              <ActivityIndicator color={c.green} />
              <AdminText>Loading current records…</AdminText>
            </Panel>
          ) : view.error ? (
            <Panel>
              <AdminText large>Could not load this view</AdminText>
              <AdminText muted>{view.error.message}</AdminText>
              <AdminButton
                label="Try again"
                onPress={() => void view.refetch()}
              />
            </Panel>
          ) : null}
          {view.data && section === 'overview' ? (
            <>
              <View style={styles.metrics}>
                {[
                  ['Customers', view.data.users],
                  [
                    'Wallet balances',
                    adminMoney(view.data.wallet_balance_minor),
                  ],
                  [
                    'Reserved funds',
                    adminMoney(view.data.wallet_reserved_minor),
                  ],
                  [
                    'Settled service volume',
                    adminMoney(view.data.settled_volume_minor),
                  ],
                  [
                    'Settled service fees',
                    adminMoney(view.data.settled_fees_minor),
                  ],
                  ['Pending transactions', view.data.pending_transactions],
                ].map(([label, value]) => (
                  <View
                    key={String(label)}
                    style={[styles.metric, { minWidth: wide ? 240 : 135 }]}
                  >
                    <Text style={styles.metricLabel}>{String(label)}</Text>
                    <Text style={styles.metricValue}>{valueText(value)}</Text>
                  </View>
                ))}
              </View>
              <Panel>
                <Text style={styles.eyebrow}>NEEDS ATTENTION</Text>
                <AdminText large>Keep the customer journey moving.</AdminText>
                <View style={styles.attention}>
                  {[
                    ['support', 'Open support cases', view.data.open_support],
                    [
                      'numbers',
                      'SMS orders to review',
                      view.data.number_reviews,
                    ],
                    [
                      'social',
                      'Social orders to review',
                      view.data.social_reviews,
                    ],
                  ].map(([id, label, value]) => (
                    <Pressable
                      key={String(id)}
                      accessibilityRole="button"
                      onPress={() => navigate(id as AdminSection)}
                      style={styles.attentionItem}
                    >
                      <Text style={styles.attentionCount}>
                        {valueText(value)}
                      </Text>
                      <AdminText>{String(label)}</AdminText>
                      <Ionicons
                        name="arrow-forward"
                        color={c.green}
                        size={18}
                      />
                    </Pressable>
                  ))}
                </View>
              </Panel>
              <Panel>
                <AdminText>
                  Wallet balances are customer funds, not revenue. Service fees
                  shown here are settled fees, not net profit; provider costs,
                  refunds and operating expenses must also be reconciled.
                </AdminText>
              </Panel>
            </>
          ) : null}
          {view.data && section === 'settings' ? (
            <>
              <Panel>
                <Text style={styles.eyebrow}>SELLING PRICES</Text>
                <AdminText large>Explicit rates. No hidden defaults.</AdminText>
                <AdminText muted>
                  NGN per US dollar converts the provider cost; markup is added
                  on top. New quotes use saved settings. Provider keys stay in
                  Supabase secrets, never in this panel.
                </AdminText>
              </Panel>
              {view.data.pricing.map((p) => (
                <PricingCard
                  key={`${p.service_key}:${p.version}`}
                  pricing={p}
                  propose={propose}
                />
              ))}
              <Panel>
                <Text style={styles.eyebrow}>SERVICE CONTROLS</Text>
                <AdminText muted>
                  Turning a service off blocks new purchases. Existing orders
                  continue to reconcile. Testers mode uses the server-managed
                  tester list; it does not grant access to every account.
                </AdminText>
              </Panel>
              {view.data.services.map((s) => (
                <Panel key={s.service_key}>
                  <View style={styles.settingTitle}>
                    <AdminText large>{s.label}</AdminText>
                    <Badge value={s.rollout_mode} />
                  </View>
                  <AdminText muted>
                    {s.status_message}{' '}
                    {s.requires_kyc
                      ? 'Existing identity requirements stay enforced.'
                      : ''}
                  </AdminText>
                  <AdminText muted>
                    {view.data!.readyServices[s.service_key]
                      ? 'Provider configuration is present. Run a small tester purchase before general availability.'
                      : 'Activation is blocked until this provider is configured.'}
                  </AdminText>
                  <View style={styles.actions}>
                    {['off', 'testers', 'all'].map((mode) => (
                      <AdminButton
                        key={mode}
                        label={
                          mode === 'off'
                            ? 'Turn off'
                            : mode === 'testers'
                              ? 'Testers only'
                              : 'Everyone'
                        }
                        secondary
                        disabled={
                          s.rollout_mode === mode ||
                          (mode !== 'off' &&
                            !view.data!.readyServices[s.service_key])
                        }
                        onPress={() =>
                          propose(`${s.label}: ${mode}`, {
                            change: 'service',
                            serviceKey: s.service_key,
                            rolloutMode: mode,
                          })
                        }
                      />
                    ))}
                  </View>
                </Panel>
              ))}
            </>
          ) : null}
          {section !== 'overview' && section !== 'settings' ? (
            <>
              <Panel>
                <View style={styles.filters}>
                  <AdminInput
                    label="Search records"
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Name, email or reference"
                    autoCapitalize="none"
                  />
                  <AdminInput
                    label="Status (optional)"
                    value={status}
                    onChangeText={(v) => {
                      setStatus(v);
                      setPage(1);
                    }}
                    placeholder="e.g. pending"
                    autoCapitalize="none"
                  />
                </View>
              </Panel>
              {view.data?.rows?.length === 0 ? (
                <Panel>
                  <AdminText large>No matching records</AdminText>
                  <AdminText muted>
                    Try another search or clear your filters. This view uses
                    actual Billy records only.
                  </AdminText>
                </Panel>
              ) : null}
              {view.data?.rows?.map((row) => (
                <RecordCard
                  key={valueText(row.id)}
                  section={section}
                  row={row}
                  expanded={expanded === valueText(row.id)}
                  onExpand={() =>
                    setExpanded(
                      expanded === valueText(row.id) ? null : valueText(row.id),
                    )
                  }
                  propose={propose}
                  busy={reconcile.isPending}
                  refresh={() =>
                    void reconcile
                      .mutateAsync({ service: section, orderId: row.id })
                      .catch((e) => setMessage(e.message))
                  }
                />
              ))}
              {view.data ? (
                <View style={styles.pagination}>
                  <AdminButton
                    label="Previous"
                    secondary
                    disabled={page === 1}
                    onPress={() => setPage((p) => p - 1)}
                  />
                  <AdminText muted>Page {page}</AdminText>
                  <AdminButton
                    label="Next"
                    secondary
                    disabled={!view.data.hasMore}
                    onPress={() => setPage((p) => p + 1)}
                  />
                </View>
              ) : null}
            </>
          ) : null}
          <Text style={styles.footer}>
            Billy Internet Solutions · Private operations workspace
          </Text>
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}
function PricingCard({
  pricing: p,
  propose,
}: {
  pricing: Pricing;
  propose: (title: string, input: Record<string, unknown>) => void;
}) {
  const [rate, setRate] = useState(
    inputTwoDecimals(p.exchange_rate_minor_per_usd),
  );
  const [markup, setMarkup] = useState(inputTwoDecimals(p.markup_bps));
  const r = parseTwoDecimals(rate),
    m = parseTwoDecimals(markup);
  const name =
    p.service_key === 'social_boost' ? 'Social Boost' : 'US SMS numbers';
  return (
    <Panel>
      <View style={styles.settingTitle}>
        <AdminText large>{name}</AdminText>
        <Badge
          value={
            p.exchange_rate_minor_per_usd === null
              ? 'not configured'
              : 'configured'
          }
        />
      </View>
      <View style={styles.filters}>
        <AdminInput
          label="NGN per USD"
          inputMode="decimal"
          value={rate}
          onChangeText={setRate}
          placeholder="Enter your exchange rate"
        />
        <AdminInput
          label="Markup (%)"
          inputMode="decimal"
          value={markup}
          onChangeText={setMarkup}
          placeholder="0.00 – 50.00"
        />
      </View>
      <AdminButton
        label="Review pricing change"
        disabled={
          r === null ||
          r <= 0 ||
          r > 100000000 ||
          m === null ||
          m < 0 ||
          m > 5000
        }
        onPress={() =>
          propose(`Update ${name} pricing`, {
            change: 'pricing',
            serviceKey: p.service_key,
            exchangeRateMinorPerUsd: r,
            markupBps: m,
            version: p.version,
          })
        }
      />
    </Panel>
  );
}
function RecordCard({
  section,
  row,
  expanded,
  onExpand,
  propose,
  refresh,
  busy,
}: {
  section: AdminSection;
  row: AdminRow;
  expanded: boolean;
  onExpand: () => void;
  propose: (title: string, input: Record<string, unknown>) => void;
  refresh: () => void;
  busy: boolean;
}) {
  const title =
    row.title ??
    row.service_name ??
    row.product_title ??
    row.display_name ??
    row.subject ??
    row.bank_name ??
    row.action ??
    row.email ??
    row.reference ??
    row.id;
  const status =
    row.status ??
    row.wallet_status ??
    (row.enabled !== undefined ? (row.enabled ? 'active' : 'off') : null);
  return (
    <Panel>
      <View style={styles.recordTitle}>
        <View style={{ flex: 1, gap: 5 }}>
          <AdminText large>{valueText(title)}</AdminText>
          {row.email ? (
            <Text selectable style={styles.recordMeta}>
              {valueText(row.email)}
            </Text>
          ) : null}
          <Text selectable style={styles.recordMeta}>
            {valueText(row.reference ?? row.id)}
          </Text>
        </View>
        {status ? <Badge value={status} /> : null}
      </View>
      <View style={styles.recordSummary}>
        {row.total_minor !== undefined || row.amount_minor !== undefined ? (
          <AdminText>
            {adminMoney(
              row.total_minor ??
                Number(row.amount_minor ?? 0) + Number(row.fee_minor ?? 0),
            )}
          </AdminText>
        ) : null}
        {row.balance_minor !== undefined ? (
          <AdminText>Balance {adminMoney(row.balance_minor)}</AdminText>
        ) : null}
        {row.created_at ? (
          <AdminText muted>
            {new Date(String(row.created_at)).toLocaleString()}
          </AdminText>
        ) : null}
      </View>
      {row.status_message ? (
        <AdminText muted>{valueText(row.status_message)}</AdminText>
      ) : null}
      {section === 'users' ? (
        <View style={styles.actions}>
          <AdminButton
            label={
              row.wallet_status === 'frozen'
                ? 'Unfreeze wallet'
                : 'Freeze wallet'
            }
            secondary
            disabled={
              row.wallet_status === 'closed' ||
              row.email === 'support@billyapp.org'
            }
            onPress={() =>
              propose('Change wallet access', {
                change: 'wallet',
                userId: row.id,
                status: row.wallet_status === 'frozen' ? 'active' : 'frozen',
              })
            }
          />
        </View>
      ) : null}
      {section === 'support' ? (
        <View style={styles.actions}>
          <AdminButton
            label="Mark resolved"
            secondary
            disabled={row.status === 'resolved'}
            onPress={() =>
              propose('Resolve support case', {
                change: 'support',
                caseId: row.id,
                status: 'resolved',
              })
            }
          />
          <AdminButton
            label="Awaiting customer"
            secondary
            disabled={row.status === 'waiting_on_customer'}
            onPress={() =>
              propose('Update support case', {
                change: 'support',
                caseId: row.id,
                status: 'waiting_on_customer',
              })
            }
          />
        </View>
      ) : null}
      {section === 'catalog' ? (
        <AdminButton
          label={row.enabled ? 'Disable service' : 'Enable service'}
          secondary
          onPress={() =>
            propose('Update catalogue availability', {
              change: 'catalog',
              serviceKey: 'social_boost',
              itemId: row.id,
              enabled: !row.enabled,
            })
          }
        />
      ) : null}
      {section === 'numbers' || section === 'social' ? (
        <AdminButton
          label="Check provider status"
          secondary
          busy={busy}
          onPress={refresh}
        />
      ) : null}
      <AdminButton
        label={expanded ? 'Hide details' : 'View details'}
        secondary
        onPress={onExpand}
      />
      {expanded ? (
        <View style={styles.details}>
          {Object.entries(row).map(([key, value]) => (
            <View key={key} style={styles.detailRow}>
              <Text style={styles.detailLabel}>{key.replaceAll('_', ' ')}</Text>
              <Text selectable style={styles.detailValue}>
                {key.endsWith('_minor') ? adminMoney(value) : valueText(value)}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </Panel>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.canvas },
  workspace: { flex: 1 },
  loading: {
    flex: 1,
    backgroundColor: c.canvas,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
    gap: 16,
  },
  sidebar: { width: 252, backgroundColor: c.nav, paddingTop: 32 },
  brand: {
    paddingHorizontal: 24,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingBottom: 30,
  },
  smallMark: {
    height: 42,
    width: 42,
    backgroundColor: '#244631',
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    color: '#FFF',
    fontSize: 29,
    fontWeight: '800',
    letterSpacing: -1,
  },
  brandSub: {
    color: '#94B19D',
    fontSize: 9,
    letterSpacing: 2.5,
    fontWeight: '700',
  },
  navList: { paddingHorizontal: 14, gap: 5 },
  navItem: {
    minHeight: 46,
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderRadius: 10,
  },
  navActive: { backgroundColor: '#284D37' },
  navText: { fontSize: 13, color: '#C1D1C5', fontWeight: '500' },
  navMobile: { borderRadius: 24, paddingVertical: 9, minHeight: 44 },
  sidebarFooter: {
    padding: 18,
    borderTopWidth: 1,
    borderTopColor: '#284333',
    gap: 10,
  },
  adminEmail: { fontSize: 11, color: '#9CB6A3' },
  mobileTop: { backgroundColor: c.nav },
  mobileBrand: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 14,
    paddingBottom: 12,
  },
  main: { flex: 1 },
  mainContent: {
    padding: 36,
    gap: 24,
    maxWidth: 1400,
    width: '100%',
    alignSelf: 'center',
    paddingBottom: 50,
  },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: 14 },
  eyebrow: {
    fontSize: 10,
    letterSpacing: 2,
    color: c.green,
    fontWeight: '700',
  },
  title: { fontSize: 36, fontWeight: '700', letterSpacing: -1.1, color: c.ink },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  metric: {
    flexBasis: '30%',
    flexGrow: 1,
    padding: 22,
    borderRadius: 16,
    backgroundColor: '#FFF',
    borderWidth: 1,
    borderColor: c.line,
    gap: 16,
  },
  metricLabel: { fontSize: 12, color: c.muted },
  metricValue: {
    fontSize: 27,
    fontWeight: '700',
    letterSpacing: -0.5,
    color: c.ink,
  },
  attention: { gap: 4 },
  attentionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 15,
    borderTopWidth: 1,
    borderTopColor: c.line,
  },
  attentionCount: {
    fontSize: 22,
    fontWeight: '700',
    color: c.green,
    minWidth: 32,
  },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 16 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  settingTitle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  recordTitle: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  recordMeta: { fontSize: 12, lineHeight: 18, color: c.muted },
  recordSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
    flexWrap: 'wrap',
  },
  pagination: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  details: {
    borderTopWidth: 1,
    borderTopColor: c.line,
    paddingTop: 12,
    gap: 12,
  },
  detailRow: { gap: 4 },
  detailLabel: {
    fontSize: 11,
    color: c.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  detailValue: { fontSize: 13, lineHeight: 20, color: c.ink, flexShrink: 1 },
  footer: {
    fontSize: 11,
    color: '#7D8981',
    textAlign: 'center',
    paddingTop: 18,
  },
});
