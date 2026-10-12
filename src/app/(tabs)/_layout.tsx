import React from 'react';
import { Pressable, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Tabs, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BarChart3, Home, Plus, Settings, Users } from 'lucide-react-native';
import { CardShadow, Colors, Radius } from '../../constants/theme';

const ICONS: Record<string, React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>> = {
  index: Home,
  analytics: BarChart3,
  accounts: Users,
  settings: Settings,
};

const LABELS: Record<string, string> = {
  index: 'Главная',
  analytics: 'Аналитика',
  accounts: 'Аккаунты',
  settings: 'Настройки',
};

// Minimal shape of the props the tab navigator passes to a custom tab bar
interface TabBarProps {
  state: { index: number; routes: Array<{ key: string; name: string }> };
  navigation: { navigate: (name: string) => void; emit: (e: any) => { defaultPrevented: boolean } };
}

function TabBar({ state, navigation }: TabBarProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const routes = state.routes.filter((r) => ICONS[r.name]);
  const left = routes.slice(0, 2);
  const right = routes.slice(2);

  const renderItem = (route: { key: string; name: string }) => {
    const focused = state.routes[state.index]?.key === route.key;
    const Icon = ICONS[route.name];
    return (
      <Pressable
        key={route.key}
        style={[styles.item, focused && styles.itemActive]}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name);
        }}
      >
        <Icon size={22} color={focused ? Colors.text : Colors.textSubtle} strokeWidth={focused ? 2.4 : 1.9} />
        <Text style={[styles.label, focused && styles.labelActive]}>{LABELS[route.name]}</Text>
      </Pressable>
    );
  };

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {left.map(renderItem)}
      <View style={styles.fabSlot}>
        <TouchableOpacity style={styles.fab} activeOpacity={0.85} onPress={() => router.push('/create')}>
          <Plus size={26} color="#fff" strokeWidth={2.4} />
        </TouchableOpacity>
      </View>
      {right.map(renderItem)}
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs screenOptions={{ headerShown: false }} tabBar={(props: any) => <TabBar {...props} />}>
      <Tabs.Screen name="index" />
      <Tabs.Screen name="analytics" />
      <Tabs.Screen name="accounts" />
      <Tabs.Screen name="settings" />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.card,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingTop: 10,
    paddingHorizontal: 10,
    borderTopWidth: 1,
    borderColor: Colors.border,
    ...CardShadow,
    shadowOffset: { width: 0, height: -3 },
    elevation: 12,
  },
  item: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: Radius.lg,
  },
  itemActive: {
    backgroundColor: Colors.cardHighlight,
  },
  label: {
    fontSize: 10.5,
    color: Colors.textSubtle,
    fontWeight: '500',
  },
  labelActive: {
    color: Colors.text,
    fontWeight: '700',
  },
  fabSlot: {
    width: 74,
    alignItems: 'center',
  },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: Colors.ink,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: -26,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
});
