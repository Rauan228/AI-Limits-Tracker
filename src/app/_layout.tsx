import React, { useEffect } from 'react';
import { AppState } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Colors } from '../constants/theme';
import { useAppStore } from '../store/useAppStore';

export default function RootLayout() {
  const initializeStore = useAppStore((s) => s.initializeStore);
  const refreshAll = useAppStore((s) => s.refreshAll);
  const intervalMin = useAppStore((s) => s.refreshIntervalMin);
  const isReady = useAppStore((s) => s.isReady);

  useEffect(() => {
    initializeStore();
  }, []);

  // Periodic refresh while the app is open, plus a refresh when it comes back to the foreground
  useEffect(() => {
    if (!isReady) return;
    const timer = setInterval(() => refreshAll(), intervalMin * 60 * 1000);
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      const last = useAppStore.getState().lastSyncAllAt;
      if (!last || Date.now() - new Date(last).getTime() > 60 * 1000) refreshAll();
    });
    return () => {
      clearInterval(timer);
      sub.remove();
    };
  }, [isReady, intervalMin]);

  return (
    <SafeAreaProvider>
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.background },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="(tabs)" options={{ animation: 'fade' }} />
        <Stack.Screen name="account/[id]" />
        <Stack.Screen name="create" options={{ animation: 'slide_from_bottom' }} />
        <Stack.Screen name="notifications" />
        <Stack.Screen name="history" />
      </Stack>
    </SafeAreaProvider>
  );
}
