import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  AdminButton,
  AdminText,
  Badge,
  Panel,
  adminColors as c,
} from './components';
import {
  adminMoney,
  adminRecordAmount,
  type AdminRow,
  type AdminSection,
  type AdminSettings,
} from './domain';

type Props = {
  data: AdminRow;
  wide: boolean;
  recent: AdminRow[] | undefined;
  recentError: boolean;
  services: AdminSettings['services'] | undefined;
  servicesError: boolean;
  onNavigate: (section: AdminSection) => void;
  onRetryRecent: () => void;
};

export function AdminOverview({
  data,
  wide,
  recent,
  recentError,
  services,
  servicesError,
  onNavigate,
  onRetryRecent,
}: Props) {
  return (
    <>
      <View style={[s.summary, wide && s.horizontal]}>
        <View style={s.balanceCard}>
          <View style={s.cardTop}>
            <Text style={s.label}>CUSTOMER FUNDS</Text>
            <Ionicons name="wallet-outline" color={c.green} size={23} />
          </View>
          <Text style={s.balance} adjustsFontSizeToFit numberOfLines={1}>
            {adminMoney(data.wallet_balance_minor)}
          </Text>
          <View style={s.balanceFooter}>
            <Text style={s.muted}>Held in customer wallets</Text>
            <Text style={s.reserved}>
              {adminMoney(data.wallet_reserved_minor)} reserved
            </Text>
          </View>
        </View>
        <View style={s.smallMetrics}>
          <Metric
            label="Customers"
            value={String(data.users ?? '—')}
            icon="people-outline"
            onPress={() => onNavigate('users')}
          />
          <Metric
            label="Pending payments"
            value={String(data.pending_transactions ?? '—')}
            icon="time-outline"
            onPress={() => onNavigate('transactions')}
          />
        </View>
      </View>
      <View style={[s.columns, wide && s.horizontal]}>
        <View style={s.mainColumn}>
          <Panel>
            <View style={s.panelHeading}>
              <AdminText large>Payments overview</AdminText>
              <Text style={s.period}>ALL TIME</Text>
            </View>
            <View style={s.paymentMetrics}>
              <View style={s.paymentMetric}>
                <Text style={s.muted}>Completed payments</Text>
                <Text style={s.paymentValue}>
                  {adminMoney(data.settled_volume_minor)}
                </Text>
              </View>
              <View style={s.paymentMetric}>
                <Text style={s.muted}>Service fees collected</Text>
                <Text style={[s.paymentValue, { color: c.gold }]}>
                  {adminMoney(data.settled_fees_minor)}
                </Text>
              </View>
            </View>
            <Text style={s.note}>
              Customer funds are not revenue. Fees shown are before costs and
              refunds.
            </Text>
          </Panel>
          <Panel>
            <View style={s.panelHeading}>
              <AdminText large>Recent transactions</AdminText>
              <Pressable
                accessibilityRole="button"
                onPress={() => onNavigate('transactions')}
                style={s.textButton}
              >
                <Text style={s.link}>View all</Text>
                <Ionicons name="arrow-forward" size={16} color={c.green} />
              </Pressable>
            </View>
            {recentError ? (
              <View style={s.empty}>
                <AdminText muted>Transactions couldn’t load.</AdminText>
                <AdminButton
                  label="Try again"
                  secondary
                  onPress={onRetryRecent}
                />
              </View>
            ) : !recent ? (
              <AdminText muted>Loading transactions…</AdminText>
            ) : recent.length === 0 ? (
              <View style={s.empty}>
                <Ionicons name="receipt-outline" size={28} color={c.muted} />
                <AdminText muted>No transactions yet</AdminText>
              </View>
            ) : (
              recent.slice(0, 5).map((row) => (
                <Pressable
                  key={String(row.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`View transaction ${String(row.reference ?? '')}`}
                  onPress={() => onNavigate('transactions')}
                  style={s.transaction}
                >
                  <View style={s.transactionIcon}>
                    <Ionicons
                      name={
                        row.direction === 'credit'
                          ? 'arrow-down-outline'
                          : 'arrow-up-outline'
                      }
                      color={c.green}
                      size={18}
                    />
                  </View>
                  <View style={s.transactionCopy}>
                    <Text style={s.transactionTitle} numberOfLines={1}>
                      {String(row.title ?? 'Payment')}
                    </Text>
                    <Text style={s.transactionDate}>
                      {new Date(String(row.created_at)).toLocaleDateString(
                        'en-GB',
                        { day: 'numeric', month: 'short' },
                      )}{' '}
                      · {String(row.reference ?? '').slice(-10)}
                    </Text>
                  </View>
                  <View style={s.transactionValue}>
                    <Text style={s.transactionTitle}>
                      {adminRecordAmount(row)}
                    </Text>
                    <Badge value={row.status} />
                  </View>
                </Pressable>
              ))
            )}
          </Panel>
        </View>
        <View style={[s.sideColumn, wide && { maxWidth: 310 }]}>
          <Panel>
            <View style={s.panelHeading}>
              <AdminText large>Needs attention</AdminText>
              <Ionicons name="ellipse" size={7} color={c.gold} />
            </View>
            {[
              ['support', 'Support cases', data.open_support],
              ['numbers', 'SMS orders', data.number_reviews],
              ['social', 'Social orders', data.social_reviews],
            ].map(([id, label, count]) => (
              <Pressable
                key={String(id)}
                accessibilityRole="button"
                onPress={() => onNavigate(id as AdminSection)}
                style={s.attentionRow}
              >
                <Text style={s.rowLabel}>{String(label)}</Text>
                <Text style={s.count}>{String(count ?? '—')}</Text>
                <Ionicons name="chevron-forward" color={c.muted} size={16} />
              </Pressable>
            ))}
          </Panel>
          <Panel>
            <AdminText large>Service status</AdminText>
            {servicesError ? (
              <AdminText muted>
                Service status couldn’t load. Open Manage services to retry.
              </AdminText>
            ) : !services ? (
              <AdminText muted>Loading services…</AdminText>
            ) : services.length ? (
              services.map((service) => (
                <View style={s.serviceRow} key={String(service.service_key)}>
                  <Text style={s.rowLabel}>{String(service.label)}</Text>
                  <Badge
                    value={
                      service.rollout_mode === 'off' ||
                      service.enabled === false
                        ? 'off'
                        : service.rollout_mode === 'testers'
                          ? 'testers'
                          : service.status
                    }
                  />
                </View>
              ))
            ) : (
              <AdminText muted>No service status available.</AdminText>
            )}
            <AdminButton
              label="Manage services"
              secondary
              onPress={() => onNavigate('settings')}
            />
          </Panel>
        </View>
      </View>
    </>
  );
}

function Metric({
  label,
  value,
  icon,
  onPress,
}: {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={s.metric}>
      <Ionicons name={icon} color={c.green} size={20} />
      <Text style={s.metricValue}>{value}</Text>
      <Text style={s.muted}>{label}</Text>
    </Pressable>
  );
}

const s = StyleSheet.create({
  horizontal: { flexDirection: 'row' },
  summary: { gap: 16 },
  balanceCard: {
    flex: 1,
    minWidth: 0,
    borderRadius: 22,
    padding: 24,
    backgroundColor: '#193526',
    borderWidth: 1,
    borderColor: '#365540',
    gap: 24,
  },
  cardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  label: {
    color: '#B9D8C4',
    fontSize: 10,
    letterSpacing: 1.8,
    fontWeight: '600',
  },
  balance: {
    color: '#F3F9F3',
    fontSize: 40,
    fontWeight: '600',
    letterSpacing: -1.5,
    fontVariant: ['tabular-nums'],
  },
  balanceFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  reserved: { fontSize: 12, color: '#C1D5C6' },
  smallMetrics: { flex: 1, flexDirection: 'row', gap: 16, minWidth: 0 },
  metric: {
    flex: 1,
    minWidth: 0,
    backgroundColor: c.paper,
    borderColor: c.line,
    borderWidth: 1,
    borderRadius: 20,
    padding: 20,
    justifyContent: 'space-between',
    gap: 14,
  },
  metricValue: {
    color: c.ink,
    fontSize: 32,
    fontWeight: '600',
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  muted: { color: c.muted, fontSize: 12, lineHeight: 18 },
  columns: { gap: 20, alignItems: 'stretch' },
  mainColumn: { flex: 1.8, gap: 20, minWidth: 0 },
  sideColumn: { flex: 1, gap: 20, minWidth: 0 },
  panelHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap',
  },
  period: { fontSize: 9, letterSpacing: 1, color: c.muted },
  paymentMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
    paddingVertical: 8,
  },
  paymentMetric: { flex: 1, minWidth: 150, gap: 8 },
  paymentValue: {
    color: c.ink,
    fontSize: 26,
    fontWeight: '600',
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },
  note: {
    color: c.muted,
    fontSize: 11,
    lineHeight: 17,
    borderTopWidth: 1,
    borderTopColor: c.line,
    paddingTop: 16,
  },
  textButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
  },
  link: { color: c.green, fontSize: 12, fontWeight: '600' },
  empty: { alignItems: 'center', gap: 12, paddingVertical: 28 },
  transaction: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: c.line,
  },
  transactionIcon: {
    width: 36,
    height: 36,
    backgroundColor: c.raised,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
  },
  transactionCopy: { flex: 1, minWidth: 0, gap: 6 },
  transactionTitle: {
    fontSize: 12,
    color: c.ink,
    fontWeight: '500',
    fontVariant: ['tabular-nums'],
  },
  transactionDate: { fontSize: 10, color: c.muted },
  transactionValue: { alignItems: 'flex-end', gap: 6, maxWidth: '45%' },
  attentionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    minHeight: 48,
  },
  rowLabel: { flex: 1, color: c.muted, fontSize: 13 },
  count: { color: c.ink, fontSize: 14, fontWeight: '600' },
  serviceRow: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    minHeight: 38,
  },
});
