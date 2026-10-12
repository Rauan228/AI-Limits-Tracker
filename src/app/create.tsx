import React, { useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { ChevronRight, Info } from 'lucide-react-native';
import { AccountLoginSheet } from '../components/AccountLoginSheet';
import { ProviderLogo } from '../components/ProviderLogo';
import { Card, ScreenHeader } from '../components/ui';
import { Colors, PROVIDER_COMPANY, PROVIDER_NAMES, Radius } from '../constants/theme';
import { ProviderType } from '../models/types';
import { useAppStore } from '../store/useAppStore';

const PROVIDERS: Array<{ type: ProviderType; note: string }> = [
  { type: 'claude', note: 'Сессия 5ч, неделя, Opus/Sonnet, доп. расход' },
  { type: 'chatgpt', note: 'Лимиты Codex 5ч и неделя, кредиты' },
  { type: 'gemini', note: 'Сессия и неделя (через cURL)' },
];

export default function AddAccountScreen() {
  const router = useRouter();
  const accounts = useAppStore((s) => s.accounts);
  const [provider, setProvider] = useState<ProviderType | null>(null);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content}>
        <ScreenHeader title="Добавить аккаунт" />

        {PROVIDERS.map(({ type, note }) => {
          const existing = accounts.filter((a) => a.providerType === type).length;
          return (
            <Card key={type} style={styles.row} onPress={() => setProvider(type)}>
              <ProviderLogo type={type} size={42} />
              <View style={{ flex: 1 }}>
                <Text style={styles.name}>{PROVIDER_NAMES[type]}</Text>
                <Text style={styles.company}>{PROVIDER_COMPANY[type]}</Text>
                <Text style={styles.note}>{note}</Text>
              </View>
              {existing > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>+{existing === 1 ? '2-й' : `${existing + 1}-й`}</Text>
                </View>
              )}
              <ChevronRight size={20} color={Colors.textMuted} />
            </Card>
          );
        })}

        <View style={styles.info}>
          <Info size={16} color={Colors.textMuted} />
          <Text style={styles.infoText}>
            Можно подключить сколько угодно аккаунтов одного сервиса — например, два Claude и два ChatGPT. Каждый вход
            открывается в чистой сессии и получает собственный токен, поэтому аккаунты не мешают друг другу и
            обновляются в фоне независимо. Один и тот же аккаунт дважды подключить нельзя.
          </Text>
        </View>
      </ScrollView>

      {provider && (
        <AccountLoginSheet
          visible
          providerType={provider}
          onClose={() => setProvider(null)}
          onConnected={(id) => router.replace({ pathname: '/account/[id]', params: { id } })}
        />
      )}
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 12,
  },
  name: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.text,
  },
  company: {
    fontSize: 12.5,
    color: Colors.textMuted,
    marginTop: 1,
  },
  note: {
    fontSize: 11.5,
    color: Colors.textSubtle,
    marginTop: 4,
  },
  badge: {
    backgroundColor: Colors.cardHighlight,
    borderRadius: Radius.full,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
    color: Colors.textMuted,
  },
  info: {
    flexDirection: 'row',
    gap: 10,
    padding: 14,
    marginTop: 8,
    borderRadius: Radius.lg,
    backgroundColor: Colors.cardHighlight,
  },
  infoText: {
    flex: 1,
    fontSize: 12.5,
    lineHeight: 18,
    color: Colors.textMuted,
  },
});
