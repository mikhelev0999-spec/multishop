import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

vi.mock("./lib/telegramApi", () => ({
  sendMessage: vi.fn(async () => 1),
  editMessageText: vi.fn(async () => {}),
}));
import * as tg from "./lib/telegramApi";

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const base = { chatId: 7, photoIds: [], lastPhotoAt: 0, answers: [], costUsd: 0 };

test("while analysing, the progress message is updated and the next update scheduled", async () => {
  const t = convexTest(schema, modules);
  const startedAt = Date.now();
  const itemId = await t.run((ctx) => ctx.db.insert("items", { ...base, status: "analyzing" }));
  await t.mutation(internal.progress.startWaiting, { itemId, messageId: 55, startedAt });
  vi.advanceTimersByTime(30_000);
  await t.action(internal.progress.tick, { itemId, startedAt });
  const [chat, msg, text] = vi.mocked(tg.editMessageText).mock.calls[0];
  expect([chat, msg]).toEqual([7, 55]);
  expect(text).toContain("⏳ Разбираю фото (0)…");
  expect(text).toMatch(/\d+%/);
  expect(text).not.toContain("разбери");
});

test("once the draft is there, the message says so and updates stop", async () => {
  const t = convexTest(schema, modules);
  const startedAt = Date.now();
  const itemId = await t.run((ctx) =>
    ctx.db.insert("items", {
      ...base,
      status: "draft",
      progressMessageId: 55,
      waitStartedAt: startedAt,
    }),
  );
  await t.action(internal.progress.tick, { itemId, startedAt });
  expect(tg.editMessageText).toHaveBeenCalledWith(7, 55, "✅ Черновик готов 👇");
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(tg.editMessageText).toHaveBeenCalledTimes(1);
});

test("an outdated tick (a newer wait started) does nothing", async () => {
  const t = convexTest(schema, modules);
  const itemId = await t.run((ctx) =>
    ctx.db.insert("items", {
      ...base,
      status: "analyzing",
      progressMessageId: 55,
      waitStartedAt: 2,
    }),
  );
  await t.action(internal.progress.tick, { itemId, startedAt: 1 });
  expect(tg.editMessageText).not.toHaveBeenCalled();
});

test("the estimate is the median of recent waits", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    for (const d of [20_000, 40_000, 90_000]) {
      await ctx.db.insert("items", { ...base, status: "draft", waitStartedAt: 0, readyAt: d });
    }
  });
  expect(await t.query(internal.progress.eta, {})).toBe(40_000);
});
