// OAuth 2 (authorization code) for the marketplaces: the login link and the code → tokens swap.
// Errors never carry the client secret, the code or tokens: they end up in logs.

export type Provider = "olx" | "ebay";
export const PROVIDERS: Provider[] = ["olx", "ebay"];
export const PROVIDER_NAME: Record<Provider, string> = { olx: "OLX", ebay: "eBay" };

export interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  /** OLX: the callback URL itself; eBay: the RuName that stands for it. */
  redirectUri: string;
}

export interface Tokens {
  accessToken: string;
  refreshToken?: string;
  accessExpiresAt: number;
  refreshExpiresAt?: number;
}

const OLX_SCOPE = "v2 read write";
const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.account",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
].join(" ");

/** The keys from Convex environment variables, or null while any of them is missing. */
export function providerConfig(provider: Provider, siteUrl: string): ProviderConfig | null {
  const env = process.env;
  const [clientId, clientSecret, redirectUri] =
    provider === "olx"
      ? [env.OLX_CLIENT_ID, env.OLX_CLIENT_SECRET, `${siteUrl}/oauth/olx/callback`]
      : [env.EBAY_CLIENT_ID, env.EBAY_CLIENT_SECRET, env.EBAY_RUNAME];
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

export function authorizeUrl(provider: Provider, cfg: ProviderConfig, state: string): string {
  const url =
    provider === "olx"
      ? new URL("https://www.olx.ua/oauth/authorize/")
      : new URL("https://auth.ebay.com/oauth2/authorize");
  url.search = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    state,
    scope: provider === "olx" ? OLX_SCOPE : EBAY_SCOPES,
    redirect_uri: cfg.redirectUri,
  }).toString();
  return url.toString();
}

function tokenRequest(
  provider: Provider,
  cfg: ProviderConfig,
  code: string,
): { url: string; init: RequestInit } {
  if (provider === "olx") {
    return {
      url: "https://www.olx.ua/api/open/oauth/token",
      init: {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code",
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          code,
          scope: OLX_SCOPE,
          redirect_uri: cfg.redirectUri,
        }),
      },
    };
  }
  return {
    url: "https://api.ebay.com/identity/v1/oauth2/token",
    init: {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        authorization: `Basic ${btoa(`${cfg.clientId}:${cfg.clientSecret}`)}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: cfg.redirectUri,
      }).toString(),
    },
  };
}

/** A provider's error code, reduced to characters that can't carry markup or data. */
export const safeCode = (s: string) => s.slice(0, 60).replace(/[^\w.-]/g, "");

/** Swaps the one-time code from the callback for tokens. `now` is ms since epoch. */
export async function exchangeCode(
  provider: Provider,
  cfg: ProviderConfig,
  code: string,
  now: number,
): Promise<Tokens> {
  const name = PROVIDER_NAME[provider];
  const { url, init } = tokenRequest(provider, cfg, code);
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new Error(`${name}: сеть недоступна`);
  }
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const access = typeof json.access_token === "string" ? json.access_token : "";
  if (!res.ok || !access) {
    // Only the short error code: descriptions may echo request fields.
    const reason =
      typeof json.error === "string" ? safeCode(json.error) || "error" : `HTTP ${res.status}`;
    throw new Error(`${name}: не удалось получить доступ (${reason})`);
  }
  const seconds = (x: unknown) => (typeof x === "number" && x > 0 ? x : undefined);
  const expiresIn = seconds(json.expires_in) ?? 3600;
  const refreshIn = seconds(json.refresh_token_expires_in);
  return {
    accessToken: access,
    ...(typeof json.refresh_token === "string" ? { refreshToken: json.refresh_token } : {}),
    accessExpiresAt: now + expiresIn * 1000,
    ...(refreshIn ? { refreshExpiresAt: now + refreshIn * 1000 } : {}),
  };
}
