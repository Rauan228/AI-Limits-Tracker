import { Platform } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { AccountEntity, AlertKind, UsageSnapshot } from '../models/types';
import { getNotificationSettings, logAlert, updateNotificationSettings } from './db';

const isExpoGo =
  Constants.appOwnership === 'expo' ||
  Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

function getNotificationsModule() {
  if (Platform.OS === 'web') return null;
  // Expo Go on Android removed native push notification emitter in SDK 53+
  if (isExpoGo && Platform.OS === 'android') {
    return null;
  }
  try {
    return require('expo-notifications');
  } catch {
    return null;
  }
}

// Safely configure notification handler if supported in current runtime
try {
  const Notifications = getNotificationsModule();
  if (Notifications && typeof Notifications.setNotificationHandler === 'function') {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }
} catch {}

export async function requestNotificationPermissions(): Promise<boolean> {
  const Notifications = getNotificationsModule();
  if (!Notifications) {
    // In Expo Go on Android or web, local UI alerts are used instead of native background tokens
    return true;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    return finalStatus === 'granted';
  } catch {
    return false;
  }
}

export async function sendLocalAlert(title: string, body: string): Promise<void> {
  const Notifications = getNotificationsModule();

  if (Notifications && typeof Notifications.scheduleNotificationAsync === 'function') {
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title,
          body,
          sound: true,
        },
        trigger: null,
      });
      return;
    } catch {}
  }

  // Fallback for Expo Go on Android / Web: in-app notification Alert
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && 'Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, { body });
        return;
      }
    }
  }

  // Expo Go on Android has no local notifications; the alert is still in the in-app log.
}

export { bindingBucket } from './providers/common';
import { bindingBucket } from './providers/common';

async function alert(account: AccountEntity, kind: AlertKind, title: string, body: string) {
  await logAlert(account.id, kind, title, body);
  await sendLocalAlert(title, body);
}

export async function checkThresholdsAndNotify(
  account: AccountEntity,
  snapshot: UsageSnapshot,
  previousStatus?: AccountEntity['lastStatus']
): Promise<void> {
  const settings = await getNotificationSettings(account.id);

  if (snapshot.status === 'reauth_required') {
    if (settings.notifyOnReauth && previousStatus !== 'reauth_required') {
      await alert(
        account,
        'reauth',
        'Требуется авторизация',
        `${account.name}: сессия истекла, войдите в аккаунт заново.`
      );
    }
    return;
  }
  if (snapshot.status !== 'ok' || snapshot.isStale) return;

  const bucket = bindingBucket(snapshot);
  if (!bucket || bucket.utilizationPercent === null) return;

  const used = bucket.utilizationPercent;
  const left = Math.max(0, Math.round(100 - used));
  const next = { ...settings };
  let changed = false;

  if (used >= 100) {
    if (settings.notifyAt0 && settings.isArmed0) {
      await alert(account, 'exhausted', `Лимит исчерпан: ${account.name}`, `${bucket.label}: 0% осталось.`);
    }
    if (settings.isArmed0) {
      next.isArmed0 = false;
      changed = true;
    }
  } else if (!settings.isArmed0) {
    next.isArmed0 = true;
    changed = true;
    if (settings.notifyOnRestore) {
      await alert(account, 'restored', `Лимит восстановлен: ${account.name}`, `${bucket.label}: доступно ${left}%.`);
    }
  }

  if (used >= 90) {
    if (used < 100 && settings.notifyAt10 && settings.isArmed10) {
      await alert(account, 'low10', `Низкий лимит: ${account.name}`, `${bucket.label}: осталось менее 10% (${left}%).`);
    }
    if (settings.isArmed10) {
      next.isArmed10 = false;
      changed = true;
    }
  } else if (used < 90 && !settings.isArmed10) {
    next.isArmed10 = true;
    changed = true;
  }

  if (used >= 80) {
    if (used < 90 && settings.notifyAt20 && settings.isArmed20) {
      await alert(account, 'low20', `Низкий лимит: ${account.name}`, `${bucket.label}: осталось менее 20% (${left}%).`);
    }
    if (settings.isArmed20) {
      next.isArmed20 = false;
      changed = true;
    }
  } else if (used < 80 && !settings.isArmed20) {
    next.isArmed20 = true;
    changed = true;
  }

  if (changed) {
    await updateNotificationSettings(next);
  }
}
