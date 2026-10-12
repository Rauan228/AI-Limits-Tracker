/**
 * Usage statistics derived purely from the history of limit measurements.
 * No provider exposes message or token counts for subscriptions, so every
 * number here is computed from how the "% used" of each window changes over time.
 *
 * Pure TypeScript — shared by the mobile app, the self-hosted server and the web panel.
 */

export interface StatPoint {
  accountId: string;
  /** epoch ms */
  t: number;
  /** % used of the session (5h) window */
  session: number | null;
  /** % used of the weekly window */
  weekly: number | null;
}

export interface AccountStats {
  accountId: string;
  avgSession: number | null;
  peakSession: number | null;
  limitHits: number;
  redZoneMinutes: number;
  activeDays: number;
  /** share of all detected activity, 0-100 */
  activityShare: number;
}

export interface UsageStats {
  currentStreak: number;
  longestStreak: number;
  activeDays: number;
  totalDays: number;
  /** YYYY-MM-DD (in the requested time zone) → activity intensity */
  calendar: Record<string, number>;
  limitHits: number;
  redZoneMinutes: number;
  /** activity by local hour 0-23 */
  byHour: number[];
  /** activity by weekday, 0 = Monday … 6 = Sunday */
  byWeekday: number[];
  busiestHour: number | null;
  busiestWeekday: number | null;
  perAccount: AccountStats[];
  measurements: number;
}

export interface Forecast {
  /** % per hour, null when not enough recent data or usage is flat */
  burnRatePerHour: number | null;
  /** epoch ms when the window would hit 100% at the current pace */
  exhaustAt: number | null;
  /** true when the window resets before it would run out */
  safeUntilReset: boolean;
}

/** Gaps longer than this are not counted as continuous time in the red zone. */
const MAX_GAP_MS = 30 * 60 * 1000;
const RED_ZONE = 80;

function localParts(t: number, timeZone?: string): { date: string; hour: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
    weekday: 'short',
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(new Date(t))) parts[p.type] = p.value;
  const weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) % 24,
    weekday: Math.max(0, weekdays.indexOf(parts.weekday)),
  };
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Activity = growth of "% used" between two consecutive measurements of one account.
 * A drop means the window reset; the new value itself is then the activity since the reset.
 */
function increase(prev: number | null, next: number | null): number {
  if (next === null) return 0;
  if (prev === null) return 0;
  if (next >= prev) return next - prev;
  return next; // window reset in between
}

export function computeStats(
  points: StatPoint[],
  accountIds: string[],
  options: { timeZone?: string; now?: number; days?: number } = {}
): UsageStats {
  const now = options.now ?? Date.now();
  const tz = options.timeZone;
  const byAccount = new Map<string, StatPoint[]>();
  for (const id of accountIds) byAccount.set(id, []);
  for (const p of points) {
    if (!byAccount.has(p.accountId)) byAccount.set(p.accountId, []);
    byAccount.get(p.accountId)!.push(p);
  }

  const calendar: Record<string, number> = {};
  const byHour = new Array(24).fill(0);
  const byWeekday = new Array(7).fill(0);
  let limitHits = 0;
  let redZoneMinutes = 0;
  const perAccount: AccountStats[] = [];
  let totalActivity = 0;
  const activityByAccount: Record<string, number> = {};

  for (const [accountId, list] of byAccount) {
    list.sort((a, b) => a.t - b.t);
    let sum = 0;
    let count = 0;
    let peak: number | null = null;
    let hits = 0;
    let red = 0;
    let activity = 0;
    const days = new Set<string>();

    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (p.session !== null) {
        sum += p.session;
        count++;
        peak = peak === null ? p.session : Math.max(peak, p.session);
      }
      if (i === 0) continue;
      const prev = list[i - 1];

      // Limit hit: crossing into 100% on either window
      const hitNow = (p.session ?? 0) >= 100 || (p.weekly ?? 0) >= 100;
      const hitBefore = (prev.session ?? 0) >= 100 || (prev.weekly ?? 0) >= 100;
      if (hitNow && !hitBefore) hits++;

      const gap = p.t - prev.t;
      if (gap <= MAX_GAP_MS && (prev.session ?? 0) >= RED_ZONE) red += gap / 60000;

      // Weekly growth catches activity even when the phone/server synced rarely
      const grow = Math.max(increase(prev.session, p.session), increase(prev.weekly, p.weekly));
      if (grow > 0) {
        const lp = localParts(p.t, tz);
        calendar[lp.date] = (calendar[lp.date] || 0) + grow;
        byHour[lp.hour] += grow;
        byWeekday[lp.weekday] += grow;
        days.add(lp.date);
        activity += grow;
      }
    }

    limitHits += hits;
    redZoneMinutes += red;
    totalActivity += activity;
    activityByAccount[accountId] = activity;
    perAccount.push({
      accountId,
      avgSession: count ? Math.round((sum / count) * 10) / 10 : null,
      peakSession: peak,
      limitHits: hits,
      redZoneMinutes: Math.round(red),
      activeDays: days.size,
      activityShare: 0,
    });
  }

  for (const a of perAccount) {
    a.activityShare = totalActivity > 0 ? Math.round((activityByAccount[a.accountId] / totalActivity) * 100) : 0;
  }

  // Streaks over local calendar days
  const activeDates = Object.keys(calendar).sort();
  let longest = 0;
  let run = 0;
  let prevDate: string | null = null;
  for (const d of activeDates) {
    run = prevDate && shiftDate(prevDate, 1) === d ? run + 1 : 1;
    longest = Math.max(longest, run);
    prevDate = d;
  }
  const today = localParts(now, tz).date;
  let current = 0;
  // Today may simply not have activity yet — the streak is still alive if yesterday was active
  let cursor = calendar[today] ? today : shiftDate(today, -1);
  while (calendar[cursor]) {
    current++;
    cursor = shiftDate(cursor, -1);
  }

  const maxIndex = (arr: number[]) => {
    let best = -1;
    let idx: number | null = null;
    arr.forEach((v, i) => {
      if (v > best && v > 0) {
        best = v;
        idx = i;
      }
    });
    return idx;
  };

  return {
    currentStreak: current,
    longestStreak: longest,
    activeDays: activeDates.length,
    totalDays: options.days ?? 0,
    calendar,
    limitHits,
    redZoneMinutes: Math.round(redZoneMinutes),
    byHour: byHour.map((v) => Math.round(v * 10) / 10),
    byWeekday: byWeekday.map((v) => Math.round(v * 10) / 10),
    busiestHour: maxIndex(byHour),
    busiestWeekday: maxIndex(byWeekday),
    perAccount,
    measurements: points.length,
  };
}

/**
 * Pace-based forecast for one window: how fast "% used" grew over the last
 * `lookbackMs`, and when it would reach 100% if that pace continues.
 */
export function forecastWindow(
  points: Array<{ t: number; value: number | null }>,
  current: number | null,
  resetsAt: string | null,
  options: { now?: number; lookbackMs?: number } = {}
): Forecast {
  const now = options.now ?? Date.now();
  const lookback = options.lookbackMs ?? 90 * 60 * 1000;
  const recent = points.filter((p) => p.value !== null && p.t >= now - lookback).sort((a, b) => a.t - b.t);
  const resetT = resetsAt ? new Date(resetsAt).getTime() : null;

  if (current === null || recent.length < 2) {
    return { burnRatePerHour: null, exhaustAt: null, safeUntilReset: true };
  }
  // Only use the part after the last reset
  let start = 0;
  for (let i = 1; i < recent.length; i++) if (recent[i].value! < recent[i - 1].value!) start = i;
  const seg = recent.slice(start);
  if (seg.length < 2) return { burnRatePerHour: null, exhaustAt: null, safeUntilReset: true };

  const first = seg[0];
  const last = seg[seg.length - 1];
  const hours = (last.t - first.t) / 3600000;
  const rate = hours > 0 ? (last.value! - first.value!) / hours : 0;
  if (rate <= 0.5) return { burnRatePerHour: rate > 0 ? Math.round(rate * 10) / 10 : 0, exhaustAt: null, safeUntilReset: true };

  const exhaustAt = now + ((100 - current) / rate) * 3600000;
  return {
    burnRatePerHour: Math.round(rate * 10) / 10,
    exhaustAt: current >= 100 ? now : exhaustAt,
    safeUntilReset: resetT !== null && resetT <= exhaustAt,
  };
}
