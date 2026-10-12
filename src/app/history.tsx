import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LineChart } from '../components/Charts';
import { ProviderLogo } from '../components/ProviderLogo';
import { Card, EmptyState, ScreenHeader, Segmented } from '../components/ui';
import { Colors, Radius } from '../constants/theme';
import { UsageHistoryPoint } from '../models/types';
import { getHistorySince } from '../services/db';
import { useAppStore } from '../store/useAppStore';
import { MONTHS_SHORT } from '../utils/formatters';

type Metric = 'session' | 'weekly';

export default function HistoryScreen() {
  const accounts = useAppStore((s) => s.accounts);
  const [metric, setMetric] = useState<Metric>('session');
  const [accountId, setAccountId] = useState<string | undefined>(accounts[0]?.id);
  const [points, setPoints] = useState<UsageHistoryPoint[]>([]);

  useEffect(() => {
    if (!accountId && accounts[0]) setAccountId(accounts[0].id);
  }, [accounts, accountId]);

  useEffect(() => {
    if (!accountId) return;
    getHistorySince(new Date(Date.now() - 7 * 86400000).toISOString(), accountId)
      .then(setPoints)
      .catch(() => setPoints([]));
  }, [accountId]);

  // One value per ~2h slot keeps the curve readable
  const series = useMemo(() => {
    const slotMs = 2 * 3600 * 1000;
    const slots = new Map<number, { t: number; v: number }>();
    for (const p of points) {
      const v = metric === 'session' ? p.primaryUtilization : p.secondaryUtilization;
      if (v == null) continue;
      const t = new Date(p.fetchedAt).getTime();
      const key = Math.floor(t / slotMs);
      const prev = slots.get(key);
      if (!prev || v > prev.v) slots.set(key, { t, v });
    }
    return [...slots.values()].sort((a, b) => a.t - b.t);
  }, [points, metric]);

  const labels = useMemo(() => {
    const out: string[] = [];
    const today = new Date();
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      out.push(`${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`);
    }
    return out;
  }, []);

  const last = series[series.length - 1];
  const account = accounts.find((a) => a.id === accountId);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title="История использования" />

        {accounts.length === 0 ? (
          <EmptyState title="Нет аккаунтов" text="История появится после подключения аккаунта." />
        ) : (
          <>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
              {accounts.map((a) => {
                const active = a.id === accountId;
                return (
                  <TouchableOpacity
                    key={a.id}
                    style={[styles.chip, active && styles.chipActive]}
                    onPress={() => setAccountId(a.id)}
                  >
                    <ProviderLogo type={a.providerType} size={20} />
                    <Text style={[styles.chipText, active && { color: '#fff' }]} numberOfLines={1}>
                      {a.name}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            <Segmented
              value={metric}
              onChange={setMetric}
              style={{ marginBottom: 16 }}
              options={[
                { key: 'session', label: 'Сессия (5ч)' },
                { key: 'weekly', label: 'Неделя' },
              ]}
            />

            <Card>
              {series.length ? (
                <LineChart
                  labels={labels.map((l, i) => (i % 2 === 0 ? l : ''))}
                  values={series.map((s) => s.v)}
                  color={account ? Colors[account.providerType].chart : Colors.gemini.chart}
                  height={180}
                  highlightIndex={series.length - 1}
                  highlightLabel={
                    last
                      ? `${new Date(last.t).getDate()} ${MONTHS_SHORT[new Date(last.t).getMonth()]}, ${String(
                          new Date(last.t).getHours()
                        ).padStart(2, '0')}:${String(new Date(last.t).getMinutes()).padStart(2, '0')}`
                      : undefined
                  }
                />
              ) : (
                <Text style={styles.empty}>За последние 7 дней замеров нет.</Text>
              )}
            </Card>
            <Text style={styles.note}>% использования окна за 7 дней (максимум за каждые 2 часа)</Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    paddingHorizontal: 18,
    paddingBottom: 30,
  },
  chips: {
    gap: 8,
    paddingBottom: 14,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: Radius.full,
    backgroundColor: Colors.card,
    borderWidth: 1,
    borderColor: Colors.border,
    maxWidth: 200,
  },
  chipActive: {
    backgroundColor: Colors.ink,
    borderColor: Colors.ink,
  },
  chipText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: Colors.text,
    flexShrink: 1,
  },
  empty: {
    fontSize: 12.5,
    color: Colors.textMuted,
    textAlign: 'center',
    paddingVertical: 30,
  },
  note: {
    fontSize: 11,
    color: Colors.textSubtle,
    textAlign: 'center',
    marginTop: 10,
  },
});
