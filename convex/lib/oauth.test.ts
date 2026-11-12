import { afterEach, describe, expect, test, vi } from "vitest";
import { authorizeUrl, exchangeCode, providerConfig } from "./oauth";

const SITE = "https://demo.convex.site";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function stubFetch(status: number, body: unknown) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("providerConfig", () => {
  test("null until every key is set", () => {
    vi.stubEnv("OLX_CLIENT_ID", "6005");
    expect(providerConfig("olx", SITE)).toBeNull();
    vi.stubEnv("OLX_CLIENT_SECRET", "x");
    expect(providerConfig("olx", SITE)).toEqual({
      clientId: "6005",
      clientSecret: "x",
      redirectUri: `${SITE}/oauth/olx/callback`,
    });
  });
  test("eBay uses the RuName as redirect_uri", () => {
    vi.stubEnv("EBAY_CLIENT_ID", "app");
    vi.stubEnv("EBAY_CLIENT_SECRET", "cert");
    expect(providerConfig("ebay", SITE)).toBeNull();
    vi.stubEnv("EBAY_RUNAME", "Me-Multishop-PRD-abc");
    expect(providerConfig("ebay", SITE)?.redirectUri).toBe("Me-Multishop-PRD-abc");
  });
});

describe("authorizeUrl", () => {
  const cfg = { clientId: "6005", clientSecret: "s", redirectUri: `${SITE}/oauth/olx/callback` };
  test("OLX", () => {
    const url = new URL(authorizeUrl("olx", cfg, "st"));
    expect(url.origin + url.pathname).toBe("https://www.olx.ua/oauth/authorize/");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "6005",
      response_type: "code",
      state: "st",
      scope: "v2 read write",
      redirect_uri: `${SITE}/oauth/olx/callback`,
    });
  });
  test("eBay asks for selling scopes and never puts the secret in the link", () => {
    const url = new URL(authorizeUrl("ebay", { ...cfg, redirectUri: "RU" }, "st"));
    expect(url.origin + url.pathname).toBe("https://auth.ebay.com/oauth2/authorize");
    expect(url.searchParams.get("redirect_uri")).toBe("RU");
    expect(url.searchParams.get("scope")).toContain("sell.inventory");
    expect(url.toString()).not.toContain("s&");
    expect([...url.searchParams.values()]).not.toContain("s");
  });
});

describe("exchangeCode", () => {
  const cfg = { clientId: "id", clientSecret: "sec", redirectUri: "https://r" };

  test("OLX: JSON body, tokens and expiry", async () => {
    const fetchMock = stubFetch(200, {
      access_token: "A",
      refresh_token: "R",
      expires_in: 86400,
    });
    const tokens = await exchangeCode("olx", cfg, "C", 1_000);
    expect(tokens).toEqual({ accessToken: "A", refreshToken: "R", accessExpiresAt: 86_401_000 });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.olx.ua/api/open/oauth/token");
    expect(JSON.parse(init.body as string)).toEqual({
      grant_type: "authorization_code",
      client_id: "id",
      client_secret: "sec",
      code: "C",
      scope: "v2 read write",
      redirect_uri: "https://r",
    });
  });

  test("eBay: Basic auth, form body, refresh expiry", async () => {
    const fetchMock = stubFetch(200, {
      access_token: "A",
      refresh_token: "R",
      expires_in: 7200,
      refresh_token_expires_in: 100,
    });
    const tokens = await exchangeCode("ebay", cfg, "C 1", 0);
    expect(tokens).toEqual({
      accessToken: "A",
      refreshToken: "R",
      accessExpiresAt: 7_200_000,
      refreshExpiresAt: 100_000,
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.ebay.com/identity/v1/oauth2/token");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Basic ${btoa("id:sec")}`);
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({
      grant_type: "authorization_code",
      code: "C 1",
      redirect_uri: "https://r",
    });
  });

  test("an error names the provider's reason but never the secret or the code", async () => {
    stubFetch(400, { error: "invalid_grant", error_description: "code sec C expired" });
    const err = await exchangeCode("olx", cfg, "C", 0).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("OLX");
    expect((err as Error).message).toContain("invalid_grant");
    expect((err as Error).message).not.toContain("sec");
  });

  test("an HTTP status without a code keeps its space", async () => {
    stubFetch(502, {});
    await expect(exchangeCode("olx", cfg, "C", 0)).rejects.toThrow("(HTTP 502)");
  });

  test("a response without an access token is an error", async () => {
    stubFetch(200, { token_type: "bearer" });
    await expect(exchangeCode("ebay", cfg, "C", 0)).rejects.toThrow("eBay");
  });

  test("a network failure is reported without details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED https://x?client_secret=sec");
      }),
    );
    const err = await exchangeCode("olx", cfg, "C", 0).catch((e: Error) => e);
    expect((err as Error).message).toBe("OLX: сеть недоступна");
  });
});
