// Server-only Zoho client (Phase 3, SPEC §6). Never import from client code —
// the refresh token must not reach a browser bundle.
//
// Token manager: refresh-token flow against accounts.zoho.com with the access
// token cached in module memory. A cold start just re-refreshes; the SPEC's
// zoho_tokens table is deferred until a service-role key exists (DECISIONS
// 2026-07-12) — a single-operator app refreshes too rarely to need it.

type TokenCache = { token: string; expiresAt: number };
const g = globalThis as typeof globalThis & { __zohoToken?: TokenCache };

const ACCOUNTS = process.env.ZOHO_ACCOUNTS_URL ?? "https://accounts.zoho.com";
const API = process.env.ZOHO_API_DOMAIN ?? "https://www.zohoapis.com";

export function zohoConfigured(): boolean {
  return Boolean(
    process.env.ZOHO_CLIENT_ID &&
      process.env.ZOHO_CLIENT_SECRET &&
      process.env.ZOHO_REFRESH_TOKEN,
  );
}

async function accessToken(): Promise<string> {
  const now = Date.now();
  if (g.__zohoToken && g.__zohoToken.expiresAt > now + 60_000) {
    return g.__zohoToken.token;
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: process.env.ZOHO_CLIENT_ID!,
    client_secret: process.env.ZOHO_CLIENT_SECRET!,
    refresh_token: process.env.ZOHO_REFRESH_TOKEN!,
  });
  const res = await fetch(`${ACCOUNTS}/oauth/v2/token`, { method: "POST", body, signal: AbortSignal.timeout(15_000) });
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!res.ok || !data.access_token) {
    throw new Error(`Zoho token refresh failed (${res.status})`);
  }
  g.__zohoToken = {
    token: data.access_token,
    expiresAt: now + (data.expires_in ?? 3600) * 1000,
  };
  return data.access_token;
}

/** Authenticated fetch against api_domain with retry/backoff on 429 and one
 *  token re-refresh on 401 (stale memory cache after Zoho-side revocation). */
export async function zohoFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith("http") ? path : `${API}${path}`;
  for (let attempt = 0; ; attempt++) {
    const token = await accessToken();
    const res = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: { ...(init?.headers ?? {}), Authorization: `Zoho-oauthtoken ${token}` },
    });
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    if (res.status === 401 && attempt < 1) {
      g.__zohoToken = undefined;
      continue;
    }
    // CRM returns 204 with an empty body for no-result searches.
    if (res.status === 204) return {} as T;
    const data = (await res.json()) as T;
    if (!res.ok) {
      throw new Error(
        `Zoho ${res.status} on ${path}: ${JSON.stringify(data).slice(0, 200)}`,
      );
    }
    return data;
  }
}
