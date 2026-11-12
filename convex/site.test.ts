import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function publish(
  t: ReturnType<typeof convexTest>,
  path: string,
  body: string,
  contentType: string,
) {
  const storageId = await t.run((ctx) => ctx.storage.store(new Blob([body])));
  await t.mutation(internal.site.register, { path, storageId, contentType });
  return storageId;
}

test("the studio page and its assets are served with their types", async () => {
  const t = convexTest(schema, modules);
  await publish(
    t,
    "index.html",
    "<!doctype html><title>Studio</title>",
    "text/html; charset=utf-8",
  );
  await publish(t, "assets/app.js", "console.log(1)", "text/javascript");

  const page = await t.fetch("/studio?item=abc", { method: "GET" });
  expect(page.status).toBe(200);
  expect(page.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(page.headers.get("cache-control")).toBe("no-cache");
  expect(await page.text()).toContain("<title>Studio</title>");

  const asset = await t.fetch("/assets/app.js", { method: "GET" });
  expect(asset.headers.get("content-type")).toBe("text/javascript");
  expect(asset.headers.get("cache-control")).toContain("immutable");
  expect(await asset.text()).toBe("console.log(1)");
});

test("an unknown asset is 404", async () => {
  const t = convexTest(schema, modules);
  const res = await t.fetch("/assets/nope.js", { method: "GET" });
  expect(res.status).toBe(404);
});

test("publishing a path again replaces the old file", async () => {
  const t = convexTest(schema, modules);
  const old = await publish(t, "index.html", "v1", "text/html");
  await publish(t, "index.html", "v2", "text/html");
  expect(await (await t.fetch("/studio", { method: "GET" })).text()).toBe("v2");
  expect(await t.run(async (ctx) => (await ctx.storage.get(old)) === null)).toBe(true);
});

test("site files are not pruned as orphans", async () => {
  const t = convexTest(schema, modules);
  const id = await publish(t, "assets/app.js", "x", "text/javascript");
  vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
  await t.mutation(internal.files.pruneOrphans, {});
  expect(await t.run(async (ctx) => (await ctx.storage.get(id)) !== null)).toBe(true);
});

test("the privacy page and the eBay declined page are plain HTML", async () => {
  const t = convexTest(schema, modules);
  const privacy = await t.fetch("/privacy", { method: "GET" });
  expect(privacy.status).toBe(200);
  expect(privacy.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(await privacy.text()).toContain("Privacy Policy");
  const declined = await t.fetch("/oauth/ebay/declined", { method: "GET" });
  expect(await declined.text()).toContain("eBay не подключён");
});

test("a callback with an unknown state is refused with a page", async () => {
  vi.stubEnv("CONVEX_SITE_URL", "https://demo.convex.site");
  const t = convexTest(schema, modules);
  const res = await t.fetch("/oauth/olx/callback?state=nope&code=C", { method: "GET" });
  expect(res.status).toBe(400);
  expect(await res.text()).toContain("Ссылка устарела");
  vi.unstubAllEnvs();
});

test("a valid callback connects the account and long values are cut", async () => {
  vi.stubEnv("CONVEX_SITE_URL", "https://demo.convex.site");
  vi.stubEnv("OLX_CLIENT_ID", "6005");
  vi.stubEnv("OLX_CLIENT_SECRET", "s");
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ access_token: "A", expires_in: 60 }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const t = convexTest(schema, modules);
  await t.mutation(internal.accounts.newState, { provider: "olx", chatId: 1, state: "s1" });
  const code = "c".repeat(3000);
  const res = await t.fetch(`/oauth/olx/callback?state=s1&code=${code}`, { method: "GET" });
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("OLX подключён");
  const tokenCall = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(([u]) =>
    u.includes("oauth/token"),
  )!;
  expect(JSON.parse(tokenCall[1].body as string).code).toHaveLength(2048);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
