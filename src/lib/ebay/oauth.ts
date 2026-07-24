// eBay OAuth plumbing (connector plan §2 Phase 1.2). Server-only.
const SANDBOX = process.env.EBAY_ENV === "sandbox";

export const EBAY_HOSTS = {
  auth: SANDBOX ? "https://auth.sandbox.ebay.com" : "https://auth.ebay.com",
  api: SANDBOX ? "https://api.sandbox.ebay.com" : "https://api.ebay.com",
};

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
].join(" ");

export function ebayConfigured(): boolean {
  return Boolean(
    process.env.EBAY_CLIENT_ID &&
    process.env.EBAY_CLIENT_SECRET &&
    process.env.EBAY_RUNAME &&
    process.env.EBAY_TOKEN_KEY,
  );
}

export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: process.env.EBAY_CLIENT_ID!,
    redirect_uri: process.env.EBAY_RUNAME!, // eBay wants the RuName here, not the URL
    response_type: "code",
    scope: EBAY_SCOPES,
    state,
  });
  return `${EBAY_HOSTS.auth}/oauth2/authorize?${q.toString()}`;
}

export type TokenSet = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
};

async function tokenPost(body: URLSearchParams): Promise<TokenSet> {
  const basic = Buffer.from(`${process.env.EBAY_CLIENT_ID}:${process.env.EBAY_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${EBAY_HOSTS.api}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body: body.toString(),
  });
  const json = (await res.json().catch(() => null)) as (TokenSet & { error_description?: string }) | null;
  if (!res.ok || !json?.access_token) {
    throw new Error(json?.error_description ?? `eBay token endpoint ${res.status}`);
  }
  return json;
}

export function exchangeCode(code: string): Promise<TokenSet> {
  return tokenPost(new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.EBAY_RUNAME!,
  }));
}

export function refreshAccess(refreshToken: string): Promise<TokenSet> {
  return tokenPost(new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: EBAY_SCOPES,
  }));
}
