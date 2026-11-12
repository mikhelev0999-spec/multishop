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
