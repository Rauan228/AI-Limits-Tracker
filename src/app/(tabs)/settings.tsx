import React, { useEffect, useState } from 'react';
import { Alert, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Bell, Download, History, Palette, RefreshCw, Shield, Trash2, User } from 'lucide-react-native';
import { Card, MenuRow, ScreenHeader } from '../../components/ui';
import { Colors, Radius } from '../../constants/theme';
import { useAppStore } from '../../store/useAppStore';
import { formatRelative, plural } from '../../utils/formatters';

const INTERVALS = [5, 15, 30, 60];

export default function SettingsScreen() {
  const router = useRouter();
  const {
    accounts,
    snapshots,
    refreshIntervalMin,
    setRefreshInterval,
    deleteAllAccounts,
    userName,
    setUserName,
    lastSyncAllAt,
  } = useAppStore();
  const [name, setName] = useState(userName);
  useEffect(() => setName(userName), [userName]);

  const pickInterval = () =>
    Alert.alert('Обновление данных', 'Как часто обновлять лимиты, пока приложение открыто', [
      ...INTERVALS.map((m) => ({
        text: `${m === refreshIntervalMin ? '✓ ' : ''}Каждые ${m} ${plural(m, ['минуту', 'минуты', 'минут'])}`,
        onPress: () => setRefreshInterval(m),
      })),
      { text: 'Отмена', style: 'cancel' as const },
    ]);

  const exportData = async () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      accounts: accounts.map((a) => ({
        name: a.name,
        provider: a.providerType,
        plan: a.plan,
        email: a.email,
        status: a.lastStatus,
        lastSyncAt: a.lastSyncAt,
        limits: (snapshots[a.id]?.buckets || []).map((b) => ({
          label: b.label,
          usedPercent: b.utilizationPercent,
          resetsAt: b.resetsAt,
        })),
      })),
    };
    try {
      await Share.share({ message: JSON.stringify(payload, null, 2), title: 'AI Limits — экспорт' });
    } catch {}
  };

  const deleteAll = () =>
    Alert.alert('Удалить все аккаунты?', 'Токены, cookie и история всех аккаунтов будут удалены с устройства.', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить всё', style: 'destructive', onPress: () => deleteAllAccounts() },
    ]);

  const privacy = () =>
    Alert.alert(
      'Конфиденциальность',
      'Токены и cookie хранятся только на этом устройстве в защищённом хранилище (Keychain / Keystore). ' +
        'Запросы идут напрямую на серверы Anthropic, OpenAI и Google — без сторонних серверов. ' +
        'Каждый аккаунт изолирован: его данные никогда не отправляются вместе с данными другого аккаунта.'
    );

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'left', 'right']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader large title="Настройки" subtitle={`Последнее обновление: ${formatRelative(lastSyncAllAt)}`} />

        <Card style={styles.nameCard}>
          <User size={18} color={Colors.textMuted} />
          <TextInput
            style={styles.nameInput}
            value={name}
            onChangeText={setName}
            onBlur={() => name !== userName && setUserName(name)}
            onSubmitEditing={() => setUserName(name)}
            placeholder="Ваше имя для приветствия"
            placeholderTextColor={Colors.textSubtle}
            returnKeyType="done"
          />
        </Card>

        <Card style={styles.menu}>
          <MenuRow icon={<Palette size={18} color={Colors.textMuted} />} title="Внешний вид" value="Светлая тема" onPress={() => {}} />
          <MenuRow
            icon={<RefreshCw size={18} color={Colors.textMuted} />}
            title="Обновление данных"
            value={`Каждые ${refreshIntervalMin} мин`}
            onPress={pickInterval}
          />
          <MenuRow icon={<Bell size={18} color={Colors.textMuted} />} title="Уведомления" onPress={() => router.push('/notifications')} />
          <MenuRow icon={<History size={18} color={Colors.textMuted} />} title="История использования" onPress={() => router.push('/history')} />
          <MenuRow icon={<Shield size={18} color={Colors.textMuted} />} title="Конфиденциальность" onPress={privacy} />
          <MenuRow icon={<Download size={18} color={Colors.textMuted} />} title="Экспорт данных" onPress={exportData} />
          <MenuRow
            icon={<Trash2 size={18} color={Colors.exhausted} />}
            title="Удалить все аккаунты"
            danger
            onPress={deleteAll}
            last
          />
        </Card>

        <Text style={styles.footer}>
          AI Limits Tracker · {accounts.length} {plural(accounts.length, ['аккаунт', 'аккаунта', 'аккаунтов'])}
        </Text>
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
  nameCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 6,
    marginBottom: 12,
  },
  nameInput: {
    flex: 1,
    fontSize: 14.5,
    color: Colors.text,
    paddingVertical: 10,
  },
  menu: {
    paddingVertical: 0,
    borderRadius: Radius.xl,
  },
  footer: {
    fontSize: 11.5,
    color: Colors.textSubtle,
    textAlign: 'center',
    marginTop: 18,
  },
});
