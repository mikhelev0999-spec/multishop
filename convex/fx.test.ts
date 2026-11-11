import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

vi.mock("./lib/nbu", async (orig) => ({
  ...(await orig<typeof import("./lib/nbu")>()),
  fetchUsdUah: vi.fn(),
}));
import { fetchUsdUah } from "./lib/nbu";
const fetchRate = vi.mocked(fetchUsdUah);

afterEach(() => fetchRate.mockReset());

test("fetches once per day and caches", async () => {
  const t = convexTest(schema, modules);
  fetchRate.mockResolvedValue(41.5);
  expect(await t.action(internal.fx.usdUah, {})).toBe(41.5);
  expect(await t.action(internal.fx.usdUah, {})).toBe(41.5);
  expect(fetchRate).toHaveBeenCalledTimes(1);
});

test("falls back to the last stored rate when NBU is down", async () => {
  const t = convexTest(schema, modules);
  await t.run((ctx) => ctx.db.insert("fxRates", { date: "2020-01-01", usdUah: 28 }));
  fetchRate.mockRejectedValue(new Error("down"));
  expect(await t.action(internal.fx.usdUah, {})).toBe(28);
});

test("fails when NBU is down and nothing is stored", async () => {
  const t = convexTest(schema, modules);
  fetchRate.mockRejectedValue(new Error("down"));
  await expect(t.action(internal.fx.usdUah, {})).rejects.toThrow("down");
});
