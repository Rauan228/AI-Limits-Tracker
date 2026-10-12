import { ProviderRecipe, ProviderType } from '../../models/types';

/**
 * Best-effort recipes for recipe-driven providers. Every entry is flagged
 * `needsVerification: true` until confirmed against a real account's cURL —
 * the endpoint URL, auth and JSON paths are then corrected here (only this
 * file changes; the engine and UI stay the same).
 *
 * To finalize one: open the service in a browser, DevTools → Network →
 * Copy as cURL of the request that returns usage, and adjust the recipe.
 */
export const RECIPES: Partial<Record<ProviderType, ProviderRecipe>> = {
  // Cursor — dashboard usage. Cookie: WorkosCursorSessionToken.
  // Shape (observed): { "gpt-4": { numRequests, maxRequestUsage }, "gpt-3.5-turbo": {...} }
  cursor: {
    usageUrl: 'https://cursor.com/api/usage',
    auth: 'cookie',
    extraHeaders: { Origin: 'https://cursor.com', Referer: 'https://cursor.com/' },
    windows: [
      {
        id: 'premium',
        label: 'Premium (fast) запросы',
        windowType: 'monthly_30d',
        usedPath: 'gpt-4.numRequests',
        limitPath: 'gpt-4.maxRequestUsage',
      },
    ],
    needsVerification: true,
  },

  // GitHub Copilot — premium-request usage. Endpoint not public; confirm with cURL.
  copilot: {
    usageUrl: 'https://api.github.com/copilot_internal/user',
    auth: 'bearer',
    extraHeaders: { Accept: 'application/vnd.github+json' },
    windows: [
      {
        id: 'premium',
        label: 'Premium-запросы',
        windowType: 'monthly_30d',
        usedPath: 'quota_snapshots.premium_interactions.entitlement_used',
        limitPath: 'quota_snapshots.premium_interactions.entitlement',
      },
    ],
    needsVerification: true,
  },

  // Perplexity — Pro search quota. Endpoint/shape to confirm with cURL.
  perplexity: {
    usageUrl: 'https://www.perplexity.ai/rest/user/settings',
    auth: 'cookie',
    extraHeaders: { Origin: 'https://www.perplexity.ai', Referer: 'https://www.perplexity.ai/' },
    windows: [
      {
        id: 'pro',
        label: 'Pro-запросы (день)',
        windowType: 'monthly_30d',
        usedPath: 'pro_search_used_today',
        limitPath: 'pro_search_limit',
      },
    ],
    needsVerification: true,
  },

  // Grok (grok.com) — POST rate-limits with a request kind. Cookie auth.
  grok: {
    usageUrl: 'https://grok.com/rest/rate-limits',
    method: 'POST',
    body: JSON.stringify({ requestKind: 'DEFAULT', modelName: 'grok-4' }),
    auth: 'cookie',
    extraHeaders: { Origin: 'https://grok.com', Referer: 'https://grok.com/' },
    windows: [
      {
        id: 'window',
        label: 'Окно запросов',
        windowType: 'sliding_window',
        remainingPath: 'remainingQueries',
        limitPath: 'totalQueries',
        resetPath: 'windowSizeSeconds',
        resetFormat: 'seconds_from_now',
      },
    ],
    needsVerification: true,
  },

  // Mistral (Le Chat) — quota endpoint to confirm with cURL.
  mistral: {
    usageUrl: 'https://chat.mistral.ai/api/usage',
    auth: 'cookie',
    extraHeaders: { Origin: 'https://chat.mistral.ai', Referer: 'https://chat.mistral.ai/' },
    windows: [
      { id: 'daily', label: 'Дневной лимит', windowType: 'sliding_window', usedPercentPath: 'used_percent' },
    ],
    needsVerification: true,
  },

  // DeepSeek — currently mostly free with soft limits; confirm if a usage endpoint exists.
  deepseek: {
    usageUrl: 'https://chat.deepseek.com/api/v0/users/current',
    auth: 'bearer',
    windows: [
      { id: 'window', label: 'Лимит', windowType: 'sliding_window', usedPercentPath: 'usage.used_percent' },
    ],
    needsVerification: true,
  },

  // Poe — GraphQL settings query returns message-point balance. Needs poe-formkey header (confirm with cURL).
  poe: {
    usageUrl: 'https://poe.com/api/gql_POST',
    method: 'POST',
    body: JSON.stringify({ queryName: 'settingsPageQuery', variables: {}, query: '' }),
    auth: 'cookie',
    extraHeaders: { Origin: 'https://poe.com', Referer: 'https://poe.com/' },
    windows: [
      {
        id: 'points',
        label: 'Compute points',
        windowType: 'monthly_30d',
        remainingPath: 'data.viewer.messagePointInfo.messagePointBalance',
        limitPath: 'data.viewer.messagePointInfo.totalMessagePointAllotment',
      },
    ],
    needsVerification: true,
  },
};

export function getRecipe(type: ProviderType): ProviderRecipe | null {
  return RECIPES[type] || null;
}
