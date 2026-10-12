export type ProviderType =
  | 'claude'
  | 'chatgpt'
  | 'gemini'
  | 'cursor'
  | 'copilot'
  | 'perplexity'
  | 'grok'
  | 'mistral'
  | 'deepseek'
  | 'poe'
  | 'custom';

/** The providers that have a dedicated adapter (not the generic recipe engine). */
export const NATIVE_PROVIDERS: ProviderType[] = ['claude', 'chatgpt', 'gemini'];

/** Providers driven by the generic recipe engine (src/services/providers/recipe.ts). */
export const RECIPE_PROVIDERS: ProviderType[] = [
  'cursor',
  'copilot',
  'perplexity',
  'grok',
  'mistral',
  'deepseek',
  'poe',
];

export type QuotaWindowType = 'session_5h' | 'weekly_7d' | 'monthly_30d' | 'sliding_window' | 'balance';

export type LimitSeverity = 'normal' | 'warning' | 'critical' | 'exhausted' | 'unavailable';

export type SyncStatus = 'ok' | 'error' | 'reauth_required' | 'rate_limited' | 'not_configured';

export interface QuotaBucket {
  id: string;
  label: string;
  windowType: QuotaWindowType;
  utilizationPercent: number | null; // 0-100 or null if unavailable
  remainingPercent: number | null;   // 100 - utilizationPercent
  resetsAt: string | null;          // ISO 8601 string
  resetSecondsRemaining?: number;
  isExhausted: boolean;
  severity: LimitSeverity;
  details?: Record<string, any>;
}

export interface BalanceCredits {
  balance: number;
  currency: string;
  expiresAt?: string;
}

export interface SubscriptionInfo {
  planTitle: string;
  isActive: boolean;
  willRenew?: boolean;
  expiresAt?: string;
}

export interface UsageSnapshot {
  accountId: string;
  providerType: ProviderType;
  planName: string;
  status: SyncStatus;
  errorMessage?: string;
  fetchedAt: string; // ISO 8601
  buckets: QuotaBucket[];
  credits?: BalanceCredits;
  subscription?: SubscriptionInfo;
  /** Identity of the logged-in account (used to keep accounts apart). */
  email?: string;
  /** True when the numbers come from the previous successful sync (temporary failure). */
  isStale?: boolean;
}

export interface AccountEntity {
  id: string;
  name: string;
  providerType: ProviderType;
  plan: string;
  /** Email of the real provider account bound to this slot. */
  email?: string;
  orderIndex: number;
  isActive: boolean;
  lastSyncAt?: string;
  lastStatus: SyncStatus | 'idle';
  lastError?: string;
  latestSnapshot?: UsageSnapshot;
  createdAt: string;
}

export type AuthType = 'oauth' | 'cookie' | 'token';

export interface AccountCredentials {
  /**
   * oauth  – per-account OAuth tokens (Claude Code / Codex login), fully isolated, auto-refreshed.
   * cookie – raw browser cookies imported via cURL / sessionKey.
   * token  – bare bearer access token (ChatGPT), no refresh.
   */
  authType?: AuthType;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  /** Access token expiry, epoch ms. */
  expiresAt?: number;
  email?: string;
  /** Cached plan title and when the profile was last fetched (epoch ms). */
  plan?: string;
  profileFetchedAt?: number;

  cookies?: string;
  sessionKey?: string;
  orgId?: string;
  orgUrl?: string;
  atToken?: string;
  bl?: string;
  sid?: string;
  apiKey?: string;
  /** Legacy flag from the old in-app browser login; such sessions must be reconnected. */
  webSessionActive?: boolean;
  /** For 'custom' accounts: the user-defined recipe describing the usage endpoint. */
  recipe?: ProviderRecipe;
}

/** How to read a reset timestamp out of the API response. */
export type ResetFormat = 'iso' | 'unix_s' | 'unix_ms' | 'seconds_from_now' | 'ms_from_now';

/** Describes one limit window within a recipe-driven provider's response. */
export interface WindowMapping {
  id: string;
  label: string;
  windowType: QuotaWindowType;
  /** JSON path to a percentage already in 0-100 (or 0-1 with percentScale: 1). */
  usedPercentPath?: string;
  /** Or: remaining count + total, to derive the percentage. */
  remainingPath?: string;
  usedPath?: string;
  limitPath?: string;
  /** 1 means the source value is a 0..1 fraction; 100 means it is already 0..100. */
  percentScale?: 1 | 100;
  /** When true the mapped value is "remaining %" rather than "used %". */
  valueIsRemaining?: boolean;
  resetPath?: string;
  resetFormat?: ResetFormat;
  /** Optional money/credit details for display. */
  unit?: string;
}

/**
 * A declarative description of how to read usage from one service.
 * Built-in recipes live in services/providers/recipes.ts; 'custom' accounts
 * carry their own recipe in credentials.recipe.
 */
export interface ProviderRecipe {
  /** Shown in the UI for custom accounts. */
  title?: string;
  usageUrl: string;
  method?: 'GET' | 'POST';
  body?: string;
  /** How stored credentials authenticate the request. */
  auth: 'cookie' | 'bearer';
  extraHeaders?: Record<string, string>;
  planPath?: string;
  emailPath?: string;
  windows: WindowMapping[];
  /** true until the endpoint has been confirmed against a real account's cURL. */
  needsVerification?: boolean;
}

export interface NotificationSettings {
  accountId: string;
  notifyAt20: boolean;
  notifyAt10: boolean;
  notifyAt0: boolean;
  notifyOnRestore: boolean;
  notifyOnReauth: boolean;
  isArmed20: boolean;
  isArmed10: boolean;
  isArmed0: boolean;
}

export interface UsageHistoryPoint {
  id: number;
  accountId: string;
  primaryUtilization: number | null;
  secondaryUtilization: number | null;
  fetchedAt: string;
}

export type AlertKind = 'low20' | 'low10' | 'exhausted' | 'restored' | 'reauth';

export interface AlertLogEntry {
  id: number;
  accountId: string;
  kind: AlertKind;
  title: string;
  body: string;
  createdAt: string;
}
