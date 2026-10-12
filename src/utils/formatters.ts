import { useEffect, useState } from 'react';

export function formatTimeRemaining(resetsAt: string | null | undefined): string {
  if (!resetsAt) return '—';
  const target = new Date(resetsAt).getTime();
  if (isNaN(target)) return '—';
  const diffSec = Math.floor((target - Date.now()) / 1000);

  if (diffSec <= 0) return 'Сброшен';

  const days = Math.floor(diffSec / 86400);
  const hours = Math.floor((diffSec % 86400) / 3600);
  const minutes = Math.floor((diffSec % 3600) / 60);

  if (days > 0) return `${days}д ${hours}ч`;
  if (hours > 0) return `${hours}ч ${minutes}м`;
  return `${minutes}м`;
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'никогда';
  const diffSec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return 'только что';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} мин назад`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} ч назад`;
  return `${Math.floor(diffSec / 86400)} д назад`;
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now.getTime() - 86400000).toDateString() === d.toDateString();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (sameDay) return `${hh}:${mm}`;
  if (yesterday) return 'Вчера';
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

export const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
export const WEEKDAYS_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export function greeting(date = new Date()): string {
  const h = date.getHours();
  if (h < 5) return 'Доброй ночи,';
  if (h < 12) return 'Доброе утро,';
  if (h < 18) return 'Добрый день,';
  return 'Добрый вечер,';
}

/** Russian plural: plural(4, ['аккаунт', 'аккаунта', 'аккаунтов']) → 'аккаунта' */
export function plural(n: number, forms: [string, string, string]): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
  return forms[2];
}

/** Re-renders the caller every `intervalMs` so countdowns stay live. */
export function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
