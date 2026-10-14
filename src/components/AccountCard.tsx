import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Clock } from 'lucide-react-native';
import { Colors } from '../constants/theme';
import { AccountEntity, UsageSnapshot } from '../models/types';
import { getHistoryFromDb } from '../services/db';
import { headlineBucket } from '../services/notificationService';
import { formatClock, formatTimeRemaining } from '../utils/formatters';
import { MiniBars } from './Charts';
import { CircularProgress } from './CircularProgress';
import { ProviderLogo } from './ProviderLogo';
import { accountStatus, Card, StatusDot } from './ui';

interface AccountCardProps {
  account: AccountEntity;
  snapshot?: UsageSnapshot;
}

export const AccountCard: React.FC<AccountCardProps> = ({ account, snapshot }) => {
  const router = useRouter();
  const [bars, setBars] = useState<Array<number | null>>([]);

  useEffect(() => {
    let alive = true;
    getHistoryFromDb(account.id, 10)
      .then((h) => alive && setBars(h.map((p) => p.primaryUtilization)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [account.id, snapshot?.fetchedAt]);

  const bucket = headlineBucket(snapshot);
  const status = accountStatus(account, snapshot);
  const subtitle = [snapshot?.planName || account.plan, account.email].filter(Boolean).join(' · ');
  // Show the reset countdown only when something is actually used (not at 100% left)
  const showReset =
    bucket != null &&
    bucket.remainingPercent != null &&
    bucket.remainingPercent < 100 &&
    Boolean(bucket.resetsAt);

  return (
    <Card
      style={styles.card}
      onPress={() => router.push({ pathname: '/account/[id]', params: { id: account.id } })}
    >
      <View style={styles.left}>
        <ProviderLogo type={account.providerType} size={44} />
        <View style={styles.meta}>
          <Text style={styles.name} numberOfLines={1}>
            {account.name}
          </Text>
          <Text style={styles.plan} numberOfLines={1}>
            {subtitle || '—'}
          </Text>
          <StatusDot status={status} />
        </View>
      </View>

      <CircularProgress
        size={72}
        strokeWidth={6.5}
        remainingPercent={bucket?.remainingPercent ?? null}
        providerType={account.providerType}
        dimmed={snapshot?.isStale}
      />

      <View style={styles.right}>
        {showReset && (
          <>
            <Text style={styles.resetLabel}>Сброс через</Text>
            <View style={styles.countdownRow}>
              <Clock size={12} color={Colors.text} strokeWidth={2.4} />
              <Text style={styles.countdown}>{formatTimeRemaining(bucket?.resetsAt)}</Text>
            </View>
          </>
        )}
        {snapshot?.isStale ? (
          <Text style={styles.stale}>данные от {formatClock(snapshot.fetchedAt)}</Text>
        ) : (
          <MiniBars values={bars} />
        )}
      </View>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 14,
    marginBottom: 12,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginRight: 6,
  },
  meta: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontSize: 15.5,
    fontWeight: '700',
    color: Colors.text,
    letterSpacing: -0.3,
  },
  plan: {
    fontSize: 12,
    color: Colors.textMuted,
    marginBottom: 3,
  },
  right: {
    width: 92,
    alignItems: 'flex-end',
    gap: 3,
  },
  resetLabel: {
    fontSize: 11,
    color: Colors.textMuted,
  },
  countdownRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 4,
  },
  countdown: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.text,
  },
  stale: {
    fontSize: 10,
    color: Colors.warning,
    textAlign: 'right',
  },
});
