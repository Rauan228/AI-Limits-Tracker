import { AccountCredentials, ProviderType, RECIPE_PROVIDERS } from '../models/types';

export function extractDelimitedHeaders(curlText: string, headerName: string): string | null {
  const normalized = headerName.toLowerCase();
  const headerRegex = /(?:-H|--header)\s+['"]([^'"]+)['"]/gi;
  let match: RegExpExecArray | null;

  while ((match = headerRegex.exec(curlText)) !== null) {
    const rawHeader = match[1];
    const colonIdx = rawHeader.indexOf(':');
    if (colonIdx > -1) {
      const key = rawHeader.substring(0, colonIdx).trim().toLowerCase();
      if (key === normalized) {
        return rawHeader.substring(colonIdx + 1).trim();
      }
    }
  }
  return null;
}

export function extractUrl(curlText: string): string | null {
  // 1. Explicit --url flag
  const urlFlagMatch = /--url\s+['"]([^'"]+)['"]/i.exec(curlText);
  if (urlFlagMatch) return urlFlagMatch[1];

  // 2. Quoted URL after curl
  const curlQuotedMatch = /curl(?:\.exe)?\s+['"](https?:\/\/[^'"]+)['"]/i.exec(curlText);
  if (curlQuotedMatch) return curlQuotedMatch[1];

  // 3. Any quoted URL
  const anyQuotedMatch = /['"](https?:\/\/[^'"]+)['"]/i.exec(curlText);
  if (anyQuotedMatch) return anyQuotedMatch[1];

  // 4. Any unquoted URL
  const unquotedMatch = /(https?:\/\/[^\s'"]+)/i.exec(curlText);
  if (unquotedMatch) return unquotedMatch[1];

  return null;
}

export function extractCookies(curlText: string): string | null {
  const fromHeader = extractDelimitedHeaders(curlText, 'cookie');
  if (fromHeader) return fromHeader;

  const cookieFlagMatch = /(?:-b|--cookie)\s+['"]([^'"]+)['"]/i.exec(curlText);
  if (cookieFlagMatch) return cookieFlagMatch[1];

  return null;
}

/** Chrome's "Copy as cURL (cmd)" escapes quotes with ^ — normalise to the bash form. */
export function normalizeCurl(text: string): string {
  return text
    .replace(/\^\r?\n/g, ' ')
    .replace(/\\\r?\n/g, ' ')
    .replace(/\^"/g, '"')
    .replace(/\^\^/g, '^')
    .replace(/\^%/g, '%')
    .replace(/\^&/g, '&');
}

export function parseCurlForProvider(
  rawCurlText: string,
  providerType: ProviderType
): AccountCredentials {
  const curlText = normalizeCurl(rawCurlText);
  const url = extractUrl(curlText);
  const cookies = extractCookies(curlText) || undefined;
  const authHeader = extractDelimitedHeaders(curlText, 'authorization');

  let accessToken: string | undefined;
  if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
    accessToken = authHeader.substring(7).trim();
  }

  const credentials: AccountCredentials = {
    cookies,
    accessToken,
  };

  if (providerType === 'claude') {
    if (url) {
      credentials.orgUrl = url;
      const orgMatch = /organizations\/([^/]+)/.exec(url);
      if (orgMatch) {
        credentials.orgId = orgMatch[1];
      }
    }
    // Also extract sessionKey if passed directly in cookies
    if (cookies) {
      const sessionKeyMatch = /sessionKey=([^;]+)/.exec(cookies);
      if (sessionKeyMatch) {
        credentials.sessionKey = sessionKeyMatch[1].trim();
      }
    }
  } else if (providerType === 'chatgpt') {
    const acctHeader = extractDelimitedHeaders(curlText, 'chatgpt-account-id');
    if (acctHeader) {
      credentials.orgId = acctHeader;
    }
    if (url) {
      const acctMatch = /account_id=([^&'"]+)/.exec(url);
      if (acctMatch) {
        credentials.orgId = acctMatch[1];
      }
    }
  } else if (providerType === 'gemini') {
    const blMatch = /bl=([^&'"]+)/.exec(curlText);
    if (blMatch) credentials.bl = decodeURIComponent(blMatch[1]);

    const sidMatch = /f\.sid=([^&'"]+)/.exec(curlText);
    if (sidMatch) credentials.sid = decodeURIComponent(sidMatch[1]);

    const atMatch = /(?:[?&]at=|at=)([^&'"\s]+)/.exec(curlText);
    if (atMatch) credentials.atToken = decodeURIComponent(atMatch[1]);
  }

  return credentials;
}

export type ManualParseResult = { ok: true; credentials: AccountCredentials } | { ok: false; error: string };

/**
 * Accepts whatever the user pasted for manual connection — a cURL command,
 * a raw cookie string, a Claude sessionKey or a ChatGPT access token.
 */
const RECIPE_SET = new Set(RECIPE_PROVIDERS as string[]);

export function parseManualInput(input: string, providerType: ProviderType): ManualParseResult {
  const text = input.trim();
  if (!text) return { ok: false, error: 'Поле пустое' };
  const isCurl = /^curl(\.exe)?\s/i.test(text) || /\s-H\s/.test(text);

  // --- Native providers (bespoke adapters) ---
  if (providerType === 'claude') {
    if (isCurl) {
      const parsed = parseCurlForProvider(text, providerType);
      if (!parsed.sessionKey) return { ok: false, error: 'В cURL нет cookie sessionKey' };
      return { ok: true, credentials: { ...parsed, authType: 'cookie' } };
    }
    const fromCookie = /sessionKey=([^;\s]+)/.exec(text);
    const key = fromCookie ? fromCookie[1] : /^sk-ant-[\w-]+$/.test(text) ? text : null;
    if (!key) return { ok: false, error: 'Ожидается sessionKey (sk-ant-sid…) или cURL' };
    return { ok: true, credentials: { authType: 'cookie', sessionKey: key } };
  }

  if (providerType === 'chatgpt') {
    if (isCurl) {
      const parsed = parseCurlForProvider(text, providerType);
      if (!parsed.accessToken && !parsed.cookies) return { ok: false, error: 'В cURL нет Authorization или cookie' };
      if (parsed.cookies?.includes('next-auth.session-token')) {
        const { accessToken, ...rest } = parsed;
        return { ok: true, credentials: { ...rest, authType: 'cookie' } };
      }
      return { ok: true, credentials: { ...parsed, authType: parsed.accessToken ? 'token' : 'cookie' } };
    }
    const bearer = text.replace(/^bearer\s+/i, '');
    if (/^eyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(bearer)) return { ok: true, credentials: { authType: 'token', accessToken: bearer } };
    if (text.includes('=')) return { ok: true, credentials: { authType: 'cookie', cookies: text } };
    return { ok: false, error: 'Ожидается access token (eyJ…), cookie или cURL' };
  }

  if (providerType === 'gemini') {
    if (isCurl) {
      const parsed = parseCurlForProvider(text, providerType);
      if (!parsed.cookies?.includes('PSID')) return { ok: false, error: 'В cURL нет cookie __Secure-1PSID' };
      return { ok: true, credentials: { ...parsed, authType: 'cookie' } };
    }
    if (text.includes('PSID')) return { ok: true, credentials: { authType: 'cookie', cookies: text } };
    return { ok: false, error: 'Ожидаются cookie Google (__Secure-1PSID…) или cURL' };
  }

  // --- Custom: build a recipe straight from the pasted cURL ---
  if (providerType === 'custom') {
    if (!isCurl) return { ok: false, error: 'Вставьте cURL запроса, который возвращает ваши лимиты' };
    const url = extractUrl(text);
    if (!url) return { ok: false, error: 'В cURL не найден URL' };
    const cookies = extractCookies(text) || undefined;
    const auth = extractDelimitedHeaders(text, 'authorization');
    const bearer = auth && /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '') : undefined;
    const isPost = /-X\s+POST|--data|--data-raw|-d\s/i.test(text);
    const bodyMatch = /(?:--data-raw|--data|-d)\s+'([^']*)'/.exec(text) || /(?:--data-raw|--data|-d)\s+"([^"]*)"/.exec(text);
    if (!cookies && !bearer) return { ok: false, error: 'В cURL нет cookie или Authorization' };
    return {
      ok: true,
      credentials: {
        authType: bearer ? 'token' : 'cookie',
        cookies,
        accessToken: bearer,
        recipe: {
          title: 'Custom',
          usageUrl: url,
          method: isPost ? 'POST' : 'GET',
          body: bodyMatch ? bodyMatch[1] : undefined,
          auth: bearer ? 'bearer' : 'cookie',
          windows: [], // auto-detected from the response at sync time
          needsVerification: true,
        },
      },
    };
  }

  // --- Recipe-driven services (Cursor, Copilot, Perplexity, Grok, …) ---
  if (RECIPE_SET.has(providerType)) {
    let cookies: string | undefined;
    let bearer: string | undefined;
    if (isCurl) {
      cookies = extractCookies(text) || undefined;
      const auth = extractDelimitedHeaders(text, 'authorization');
      bearer = auth && /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, '') : undefined;
    } else if (/^(bearer\s+)?(eyJ|gho_|ghu_|github_pat_)[\w.\-]+$/i.test(text)) {
      bearer = text.replace(/^bearer\s+/i, '');
    } else if (text.includes('=')) {
      cookies = text;
    }
    if (!cookies && !bearer) return { ok: false, error: 'Вставьте cURL этого сервиса (Network → Copy as cURL), cookie или токен' };
    return { ok: true, credentials: { authType: bearer ? 'token' : 'cookie', cookies, accessToken: bearer } };
  }

  return { ok: false, error: 'Неизвестный сервис' };
}
