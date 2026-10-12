import React, { useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ArrowDown, ArrowUp, Bell, Plus } from 'lucide-react-native';
import { AccountCard } from '../../components/AccountCard';
import { Card, EmptyState, PrimaryButton } from '../../components/ui';
import { Colors, PROVIDER_NAMES, Radius } from '../../constants/theme';
import { ProviderType } from '../../models/types';
import { getHistorySince } from '../../services/db';
import { bindingBucket } from '../../services/notificationService';
import { useAppStore } from '../../store/useAppStore';
import { formatTimeRemaining, greeting, plural, useNow } from '../../utils/formatters';

type Filter = 'all' | ProviderType;

export default function DashboardScreen() {
  const router = useRouter();
  const { accounts, snapshots, isSyncing, refreshAll, userName } = useAppStore();
  const [filter, setFilter] = useState<Filter>('all');
  const [trend, setTrend] = useState<number | null>(null);
  useNow(30000);

  const stats = useMemo(() => {
    let sum = 0;
    let count = 0;
    let healthy = 0;
    let low = 0;
    let nearestReset: string | null = null;
    for (const acc of accounts) {
      const snap = snapshots[acc.id];
      if (snap?.status === 'ok') healthy++;
      const b = bindingBucket(snap);
      if (b?.utilizationPercent != null) {
        sum += b.utilizationPercent;
        count++;
        if ((b.remainingPercent ?? 100) <= 20) low++;
        if (b.resetsAt && new Date(b.resetsAt).getTime() > Date.now()) {
          if (!nearestReset || b.resetsAt < nearestReset) nearestReset = b.resetsAt;
        }
      }
    }
    return { avg: count ? Math.round(sum / count) : null, healthy, low, nearestReset };
  }, [accounts, snapshots]);

  // Week-over-week change of the average load, from real measurements
  useEffect(() => {
    const since = new Date(Date.now() - 14 * 86400 * 1000).toISOString();
    const weekAgo = Date.now() - 7 * 86400 * 1000;
    getHistorySince(since)
      .then((points) => {
        const avg = (arr: number[]) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
        const thisWeek: number[] = [];
        const lastWeek: number[] = [];
        for (const p of points) {
          if (p.primaryUtilization == null) continue;
          (new Date(p.fetchedAt).getTime() >= weekAgo ? thisWeek : lastWeek).push(p.primaryUtilization);
        }
        const a = avg(thisWeek);
        const b = avg(lastWeek);
        setTrend(a !== null && b !== null && b > 0 ? Math.round(((a - b) / b) * 100) : null);
      })
      .catch(() => setTrend(null));
  }, [snapshots]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const a of accounts) c[a.providerType] = (c[a.providerType] || 0) + 1;
    return c;
  }, [accounts]);

  const filters: Filter[] = ['all', ...(['claude', 'chatgpt', 'gemini'] as ProviderType[]).filter((p) => counts[p])];
  const visible = accounts.filter((a) => filter === 'all' || a.providerType === filter);
  const needsAttention = accounts.some((a) => {
    const s = snapshots[a.id]?.status || a.lastStatus;
    return s === 'reauth_required' || s === 'error';
  });
  const initials = (userName || '?')
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={isSyncing} onRefresh={refreshAll} tintColor={Colors.ring} colors={[Colors.ring]} />
        }
      >
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.hello}>{greeting()}</Text>
            <Text style={styles.name}>
              {userName || 'друг'} <Text style={styles.wave}>👋</Text>
            </Text>
            <Text style={styles.sub}>Все AI аккаунты в одном месте{'\n'}и под контролем</Text>
          </View>
          <View style={styles.headerRight}>
            <TouchableOpacity onPress={() => router.push('/notifications')} hitSlop={10} style={styles.bell}>
              <Bell size={22} color={Colors.text} />
              {needsAttention && <View style={styles.bellDot} />}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => router.push('/settings')} style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Card style={styles.summary}>
          <View style={styles.summaryTop}>
            <View>
              <Text style={styles.summaryLabel}>Общее использование</Text>
              <Text style={styles.summaryValue}>{stats.avg === null ? '—' : `${stats.avg}%`}</Text>
            </View>
            {trend !== null && (
              <View style={{ alignItems: 'flex-end' }}>
                <View style={[styles.trendPill, trend > 0 && { backgroundColor: Colors.exhaustedSoft }]}>
                  {trend <= 0 ? (
                    <ArrowDown size={12} color={Colors.normal} />
                  ) : (
                    <ArrowUp size={12} color={Colors.exhausted} />
                  )}
                  <Text style={[styles.trendText, trend > 0 && { color: Colors.exhausted }]}>{Math.abs(trend)}%</Text>
                </View>
                <Text style={styles.trendSub}>по сравнению{'\n'}с прошлой неделей</Text>
              </View>
            )}
          </View>
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.min(100, stats.avg ?? 0)}%` }]} />
          </View>
          <View style={styles.statsRow}>
            <Stat value={String(accounts.length)} label={plural(accounts.length, ['аккаунт', 'аккаунта', 'аккаунтов'])} />
            <Stat value={String(stats.healthy)} label="активны" />
            <Stat value={String(stats.low)} label="на исходе" />
            <Stat value={stats.nearestReset ? formatTimeRemaining(stats.nearestReset) : '—'} label="до сброса" />
          </View>
        </Card>

        {accounts.length > 0 && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {filters.map((f) => {
              const active = f === filter;
              const label = f === 'all' ? 'Все' : PROVIDER_NAMES[f];
              const n = f === 'all' ? accounts.length : counts[f];
              return (
                <TouchableOpacity key={f} style={[styles.chip, active && styles.chipActive]} onPress={() => setFilter(f)}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
                  <View style={[styles.chipCount, active && styles.chipCountActive]}>
                    <Text style={[styles.chipCountText, active && { color: Colors.text }]}>{n}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        )}

        {visible.map((account) => (
          <AccountCard key={account.id} account={account} snapshot={snapshots[account.id]} />
        ))}

        {accounts.length === 0 && (
          <EmptyState
            title="Пока нет аккаунтов"
            text="Добавьте аккаунты Claude, ChatGPT или Gemini — можно несколько аккаунтов одного сервиса, у каждого будут свои лимиты."
            action={
              <PrimaryButton
                label="Добавить аккаунт"
                icon={<Plus size={18} color="#fff" />}
                onPress={() => router.push('/create')}
                style={{ alignSelf: 'stretch' }}
              />
            }
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const Stat: React.FC<{ value: string; label: string }> = ({ value, label }) => (
  <View style={styles.stat}>
    <Text style={styles.statValue} numberOfLines={1}>
      {value}
    </Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: 18,
    paddingTop: 14,
    paddingBottom: 30,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 22,
  },
  hello: {
    fontSize: 16,
    color: Colors.text,
  },
  name: {
    fontSize: 32,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -1,
    marginTop: 2,
  },
  wave: {
    fontSize: 26,
  },
  sub: {
    fontSize: 14,
    color: Colors.textMuted,
    marginTop: 8,
    lineHeight: 20,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginTop: 6,
  },
  bell: {
    padding: 4,
  },
  bellDot: {
    position: 'absolute',
    top: 4,
    right: 5,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.exhausted,
    borderWidth: 1.5,
    borderColor: Colors.background,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.ink,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  summary: {
    padding: 20,
    marginBottom: 20,
  },
  summaryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  summaryLabel: {
    fontSize: 13,
    color: Colors.text,
  },
  summaryValue: {
    fontSize: 44,
    fontWeight: '800',
    color: Colors.text,
    letterSpacing: -1.5,
    marginTop: 2,
  },
  trendPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: Colors.normalSoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.full,
    marginBottom: 4,
  },
  trendText: {
    fontSize: 12,
    fontWeight: '700',
    color: Colors.normal,
  },
  trendSub: {
    fontSize: 11,
    color: Colors.textMuted,
    textAlign: 'right',
    lineHeight: 15,
  },
  track: {
    height: 7,
    backgroundColor: Colors.track,
    borderRadius: 4,
    marginTop: 14,
    marginBottom: 18,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: Colors.ring,
    borderRadius: 4,
  },
  statsRow: {
    flexDirection: 'row',
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.4,
  },
  statLabel: {
    fontSize: 11,
    color: Colors.textMuted,
    marginTop: 2,
  },
  chips: {
    gap: 8,
    paddingBottom: 16,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 16,
    paddingRight: 8,
    paddingVertical: 8,
    borderRadius: Radius.md,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipActive: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  chipText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.text,
  },
  chipTextActive: {
    color: '#fff',
  },
  chipCount: {
    minWidth: 20,
    paddingHorizontal: 5,
    height: 20,
    borderRadius: 6,
    backgroundColor: Colors.cardHighlight,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipCountActive: {
    backgroundColor: '#fff',
  },
  chipCountText: {
    fontSize: 11,
    fontWeight: '700',
    color: Colors.textMuted,
  },
});
