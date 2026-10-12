import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AlertTriangle, Bell, CheckCircle2, Info, XCircle } from 'lucide-react-native';
import { EmptyState, ScreenHeader } from '../components/ui';
import { Colors } from '../constants/theme';
import { AlertKind, AlertLogEntry } from '../models/types';
import { clearAlertLog, getAlertLog } from '../services/db';
import { useAppStore } from '../store/useAppStore';
import { formatClock } from '../utils/formatters';

const KIND_STYLE: Record<AlertKind, { icon: React.ReactNode; bg: string }> = {
  low20: { icon: <Bell size={16} color="#d97706" />, bg: '#fdf3e1' },
  low10: { icon: <AlertTriangle size={16} color={Colors.critical} />, bg: '#fdeee4' },
  exhausted: { icon: <XCircle size={16} color={Colors.exhausted} />, bg: Colors.exhaustedSoft },
  restored: { icon: <CheckCircle2 size={16} color={Colors.normal} />, bg: Colors.normalSoft },
  reauth: { icon: <Info size={16} color={Colors.ringBlue} />, bg: '#e8ecfb' },
};

export default function NotificationsScreen() {
  const accounts = useAppStore((s) => s.accounts);
  const [items, setItems] = useState<AlertLogEntry[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await getAlertLog(100));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} />}
      >
        <ScreenHeader
          title="Уведомления"
          right={
            items.length ? (
              <TouchableOpacity
                onPress={async () => {
                  await clearAlertLog();
                  setItems([]);
                }}
              >
                <Text style={styles.clear}>Очистить</Text>
              </TouchableOpacity>
            ) : null
          }
        />

        {items.map((n) => {
          const k = KIND_STYLE[n.kind] || KIND_STYLE.reauth;
          const accountName = accounts.find((a) => a.id === n.accountId)?.name;
          return (
            <View key={n.id} style={styles.row}>
              <View style={[styles.icon, { backgroundColor: k.bg }]}>{k.icon}</View>
              <View style={{ flex: 1 }}>
                <Text style={styles.title}>{n.title}</Text>
                <Text style={styles.body}>{n.body}</Text>
                {accountName && !n.title.includes(accountName) ? <Text style={styles.account}>{accountName}</Text> : null}
              </View>
              <Text style={styles.time}>{formatClock(n.createdAt)}</Text>
            </View>
          );
        })}

        {!items.length && !loading && (
          <EmptyState
            title="Уведомлений нет"
            text="Здесь появятся предупреждения о низком лимите, исчерпании, восстановлении и необходимости войти заново."
          />
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
  clear: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: '600',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  icon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 13.5,
    fontWeight: '700',
    color: Colors.text,
  },
  body: {
    fontSize: 12.5,
    color: Colors.textMuted,
    marginTop: 2,
    lineHeight: 17,
  },
  account: {
    fontSize: 11.5,
    color: Colors.textSubtle,
    marginTop: 3,
  },
  time: {
    fontSize: 11,
    color: Colors.textSubtle,
  },
});
