/** Extracts `code` / `state` from a redirect URL, or from a pasted "code#state" string. */
export function parseAuthCode(input: string): { code: string; state?: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const queryStart = trimmed.indexOf('?');
  if (/^https?:\/\//i.test(trimmed) && queryStart > -1) {
    const query = trimmed.substring(queryStart + 1).split('#')[0];
    const params: Record<string, string> = {};
    for (const pair of query.split('&')) {
      const [k, v = ''] = pair.split('=');
      if (k) params[decodeURIComponent(k)] = decodeURIComponent(v.replace(/\+/g, ' '));
    }
    if (!params.code) return null;
    return { code: params.code, state: params.state };
  }

  // Manual "code#state" format shown by the Claude callback page
  const [code, state] = trimmed.split('#');
  if (!code || /\s/.test(code)) return null;
  return { code, state };
}
