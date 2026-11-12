import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

vi.mock("./lib/telegramApi", () => ({
  sendMessage: vi.fn(async () => 1),
}));
vi.mock("./lib/oauth", async (orig) => ({
  ...(await orig<typeof import("./lib/oauth")>()),
  exchangeCode: vi.fn(async () => ({
    accessToken: "ACCESS",
    refreshToken: "REFRESH",
    accessExpiresAt: 99,
  })),
}));
import * as tg from "./lib/telegramApi";
import { exchangeCode } from "./lib/oauth";

const CHAT = 4242;
const SITE = "https://demo.convex.site";

beforeEach(() => {
  vi.stubEnv("CONVEX_SITE_URL", SITE);
  vi.stubEnv("OLX_CLIENT_ID", "6005");
  vi.stubEnv("OLX_CLIENT_SECRET", "olx-secret");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

type Sent = [number, string, { text: string; url?: string; callbackData?: string }[][]?];
const lastSent = () => vi.mocked(tg.sendMessage).mock.calls.at(-1) as unknown as Sent;

describe("show", () => {
  test("a provider with keys gets a login link with a fresh state; one without says so", async () => {
    const t = convexTest(schema, modules);
    await t.action(internal.accounts.show, { chatId: CHAT });
    const [chat, text, keyboard] = lastSent();
    expect(chat).toBe(CHAT);
    expect(text).toContain("OLX");
    expect(text).toContain("eBay");
    expect(text).toContain("нужны ключи разработчика");
    expect(keyboard).toHaveLength(1);
    const url = new URL(keyboard![0][0].url!);
    expect(url.host).toBe("www.olx.ua");
    expect(url.toString()).not.toContain("olx-secret");
    const state = url.searchParams.get("state")!;
    expect(state).toMatch(/^[0-9a-f]{64}$/);
    const rows = await t.run((ctx) => ctx.db.query("oauthStates").collect());
    expect(rows).toEqual([
      expect.objectContaining({ state, provider: "olx", chatId: CHAT }),
    ]);
  });

  test("a connected account is shown as connected, with a reconnect link", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.accounts.save, {
      provider: "olx",
      tokens: { accessToken: "A", accessExpiresAt: 1 },
    });
    await t.action(internal.accounts.show, { chatId: CHAT });
    const [, text, keyboard] = lastSent();
    expect(text).toContain("✅");
    expect(text).not.toContain("ACCESS");
    expect(keyboard![0][0].text).toContain("Переподключить OLX");
  });
});

async function stateFor(t: ReturnType<typeof convexTest>, provider: "olx" | "ebay") {
  await t.mutation(internal.accounts.newState, { provider, chatId: CHAT, state: "s1" });
  return "s1";
}

describe("complete", () => {
  test("a valid return saves the tokens, burns the state and tells the owner", async () => {
    const t = convexTest(schema, modules);
    const state = await stateFor(t, "olx");
    const page = await t.action(internal.accounts.complete, { provider: "olx", state, code: "C" });
    expect(page.ok).toBe(true);
    expect(exchangeCode).toHaveBeenCalledWith(
      "olx",
      expect.objectContaining({ redirectUri: `${SITE}/oauth/olx/callback` }),
      "C",
      expect.any(Number),
    );
    const accounts = await t.run((ctx) => ctx.db.query("accounts").collect());
    expect(accounts).toEqual([
      expect.objectContaining({ provider: "olx", accessToken: "ACCESS", refreshToken: "REFRESH" }),
    ]);
    expect(await t.run((ctx) => ctx.db.query("oauthStates").collect())).toEqual([]);
    expect(lastSent()[0]).toBe(CHAT);
    expect(lastSent()[1]).toContain("✅ OLX подключён");

    // The same link a second time does nothing.
    const again = await t.action(internal.accounts.complete, { provider: "olx", state, code: "C" });
    expect(again.ok).toBe(false);
    expect(exchangeCode).toHaveBeenCalledTimes(1);
  });

  test("reconnecting replaces the old tokens", async () => {
    const t = convexTest(schema, modules);
    await t.mutation(internal.accounts.save, {
      provider: "olx",
      tokens: { accessToken: "OLD", refreshToken: "OLDR", accessExpiresAt: 1 },
    });
    vi.mocked(exchangeCode).mockResolvedValueOnce({ accessToken: "NEW", accessExpiresAt: 2 });
    await t.action(internal.accounts.complete, {
      provider: "olx",
      state: await stateFor(t, "olx"),
      code: "C",
    });
    const accounts = await t.run((ctx) => ctx.db.query("accounts").collect());
    expect(accounts).toHaveLength(1);
    expect(accounts[0].accessToken).toBe("NEW");
    expect(accounts[0].refreshToken).toBeUndefined();
  });

  test("unknown, foreign-provider or stale states are refused without a token request", async () => {
    vi.useFakeTimers();
    const t = convexTest(schema, modules);
    expect((await t.action(internal.accounts.complete, { provider: "olx", state: "x", code: "C" })).ok)
      .toBe(false);
    await stateFor(t, "olx");
    expect((await t.action(internal.accounts.complete, { provider: "ebay", state: "s1", code: "C" })).ok)
      .toBe(false);
    await t.mutation(internal.accounts.newState, { provider: "olx", chatId: CHAT, state: "s2" });
    vi.advanceTimersByTime(16 * 60 * 1000);
    const stale = await t.action(internal.accounts.complete, { provider: "olx", state: "s2", code: "C" });
    expect(stale.ok).toBe(false);
    expect(stale.text).toContain("Аккаунты");
    expect(exchangeCode).not.toHaveBeenCalled();
  });

  test("the owner declined: nothing is saved, the bot says so", async () => {
    const t = convexTest(schema, modules);
    const state = await stateFor(t, "olx");
    const page = await t.action(internal.accounts.complete, {
      provider: "olx",
      state,
      error: "access_denied",
    });
    expect(page.ok).toBe(false);
    expect(exchangeCode).not.toHaveBeenCalled();
    expect(lastSent()[1]).toContain("отменено");
  });

  test("a failed token swap is reported to the owner and on the page", async () => {
    const t = convexTest(schema, modules);
    vi.mocked(exchangeCode).mockRejectedValueOnce(new Error("OLX: не удалось получить доступ (x)"));
    const page = await t.action(internal.accounts.complete, {
      provider: "olx",
      state: await stateFor(t, "olx"),
      code: "C",
    });
    expect(page.ok).toBe(false);
    expect(page.text).toContain("не удалось получить доступ");
    expect(lastSent()[1]).toContain("❌");
    expect(await t.run((ctx) => ctx.db.query("accounts").collect())).toEqual([]);
  });

  test("keys removed after the link was sent: a clear message, no request", async () => {
    const t = convexTest(schema, modules);
    const state = await stateFor(t, "olx");
    vi.stubEnv("OLX_CLIENT_SECRET", "");
    const page = await t.action(internal.accounts.complete, { provider: "olx", state, code: "C" });
    expect(page.ok).toBe(false);
    expect(exchangeCode).not.toHaveBeenCalled();
  });
});

test("old unused states are pruned", async () => {
  vi.useFakeTimers();
  const t = convexTest(schema, modules);
  await t.mutation(internal.accounts.newState, { provider: "olx", chatId: CHAT, state: "old" });
  vi.advanceTimersByTime(60 * 60 * 1000);
  await t.mutation(internal.accounts.newState, { provider: "olx", chatId: CHAT, state: "new" });
  const rows = await t.run((ctx) => ctx.db.query("oauthStates").collect());
  expect(rows.map((r) => r.state)).toEqual(["new"]);
});
