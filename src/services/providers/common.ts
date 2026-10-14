import { LimitSeverity, ProviderType, QuotaBucket, QuotaWindowType, SyncStatus, UsageSnapshot } from '../../models/types';

export function calculateSeverity(utilization: number | null): LimitSeverity {
  if (utilization === null || isNaN(utilization)) return 'unavailable';
  if (utilization >= 100) return 'exhausted';
  if (utilization >= 90) return 'critical';
  if (utilization >= 70) return 'warning';
  return 'normal';
}

export function secondsUntil(resetsAtIso: string | null): number | undefined {
  if (!resetsAtIso) return undefined;
  const t = new Date(resetsAtIso).getTime();
  if (isNaN(t)) return undefined;
  return Math.max(0, Math.floor((t - Date.now()) / 1000));
}

export function makeBucket(
  id: string,
  label: string,
  windowType: QuotaWindowType,
  utilization: number | null,
  resetsAt: string | null,
  details?: Record<string, any>
): QuotaBucket {
  const used =
    utilization === null || isNaN(utilization)
      ? null
      : Math.min(100, Math.max(0, Math.round(utilization * 10) / 10));
  return {
    id,
    label,
    windowType,
    utilizationPercent: used,
    remainingPercent: used === null ? null : Math.round((100 - used) * 10) / 10,
    resetsAt,
    resetSecondsRemaining: secondsUntil(resetsAt),
    isExhausted: used !== null && used >= 100,
    severity: calculateSeverity(used),
    details,
  };
}

export function failureSnapshot(
  accountId: string,
  providerType: ProviderType,
  status: SyncStatus,
  errorMessage: string,
  planName = ''
): UsageSnapshot {
  return {
    accountId,
    providerType,
    planName,
    status,
    errorMessage,
    fetchedAt: new Date().toISOString(),
    buckets: [],
  };
}

/** Access tokens are refreshed when they expire within this window. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

export function needsRefresh(expiresAt: number | undefined): boolean {
  if (!expiresAt) return false;
  return expiresAt - Date.now() < TOKEN_REFRESH_MARGIN_MS;
}

/**
 * When a sync fails temporarily we keep showing the last real numbers,
 * flagged as stale, instead of blanking the card.
 */
export function mergeWithPrevious(
  fresh: UsageSnapshot,
  previous: UsageSnapshot | undefined
): UsageSnapshot {
  if (fresh.status === 'ok' || fresh.status === 'not_configured') return fresh;
  if (!previous || !previous.buckets.length) return fresh;
  return {
    ...previous,
    status: fresh.status,
    errorMessage: fresh.errorMessage,
    fetchedAt: previous.fetchedAt,
    isStale: true,
  };
}

/** The window that runs out first is the one that actually limits the account. */
export function bindingBucket(snapshot: UsageSnapshot | undefined) {
  if (!snapshot) return undefined;
  const withNumbers = snapshot.buckets.filter(
    (b) => b.utilizationPercent !== null && b.windowType !== 'monthly_30d'
  );
  if (!withNumbers.length) return undefined;
  return withNumbers.reduce((a, b) => ((b.utilizationPercent ?? 0) > (a.utilizationPercent ?? 0) ? b : a));
}

/**
 * The headline window shown on the dashboard: the short (5-hour) session if the
 * provider has one, otherwise whatever limit actually binds. This keeps the main
 * card number focused on "how much of my current session is left" rather than the
 * weekly window, which is what people glance at most.
 */
export function headlineBucket(snapshot: UsageSnapshot | undefined) {
  if (!snapshot) return undefined;
  const session = snapshot.buckets.find(
    (b) => b.windowType === 'session_5h' && b.utilizationPercent !== null
  );
  return session || bindingBucket(snapshot);
}
