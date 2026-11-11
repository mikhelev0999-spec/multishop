import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";
import type { Draft } from "./lib/validators";

const modules = import.meta.glob("./**/*.*s");

vi.mock("./lib/telegramApi", () => ({
  sendMessage: vi.fn(async () => 777),
  editMessageText: vi.fn(async () => {}),
  removeKeyboard: vi.fn(async () => {}),
  answerCallbackQuery: vi.fn(async () => {}),
  getFileBytes: vi.fn(),
  setWebhook: vi.fn(),
}));
vi.mock("./lib/agent", async (orig) => ({
  ...(await orig<typeof import("./lib/agent")>()),
  runAgent: vi.fn(),
  runRewrite: vi.fn(),
}));
vi.mock("./lib/nbu", async (orig) => ({
  ...(await orig<typeof import("./lib/nbu")>()),
  fetchUsdUah: vi.fn(async () => 41),
}));

import * as tg from "./lib/telegramApi";
import { runAgent } from "./lib/agent";

const draft: Draft = {
  titleUk: "Чайник Bosch",
  descriptionUk: "Робочий.",
  category: "Дім / Кухня",
  condition: "good",
  defects: ["накипь"],
  priceUah: 400,
  priceUsd: 10,
  priceReasoningRu: "Похожие по 350–500 грн.",
  comparablesCount: 6,
  marketplaces: ["olx"],
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

async function collectingItem(t: ReturnType<typeof convexTest>) {
  return t.run(async (ctx) => {
    const photo = await ctx.storage.store(new Blob([new Uint8Array([255, 216, 255])], { type: "image/jpeg" }));
    return ctx.db.insert("items", {
      chatId: 1,
      status: "collecting",
      photoIds: [photo],
      lastPhotoAt: 100,
      answers: [],
      costUsd: 0,
    });
  });
}

test("a draft replaces the 'working' message and stores comparables", async () => {
  const t = convexTest(schema, modules);
  const itemId = await collectingItem(t);
  vi.mocked(runAgent).mockResolvedValue({
    kind: "draft",
    draft,
    comparables: [{ title: "Bosch kettle", priceUsd: 12, url: "https://ebay.com/itm/9" }],
    costUsd: 0.09,
  });

  await t.action(internal.analyze.start, { itemId, photoAt: 100 });

  expect(tg.sendMessage).toHaveBeenCalledWith(1, "Разбираюсь… (фото: 1)");
  expect(vi.mocked(runAgent).mock.calls[0][0].photos).toEqual([{ mediaType: "image/jpeg", base64: "/9j/" }]);
  const [, messageId, text, keyboard] = vi.mocked(tg.editMessageText).mock.calls[0];
  expect(messageId).toBe(777);
  expect(text).toContain("📦 Чайник Bosch");
  expect(text).toContain("анализ: $0.09");
  expect(keyboard?.[0][0].callbackData).toBe(`publish:${itemId}`);

  const item = await t.run((ctx) => ctx.db.get(itemId));
  expect(item).toMatchObject({ status: "draft", draftMessageId: 777, costUsd: 0.09 });
  const research = await t.run((ctx) => ctx.db.query("priceResearch").collect());
  expect(research).toMatchObject([{ itemId, source: "ebay", priceUsd: 12 }]);
});

test("a stale run (newer photo arrived) does nothing", async () => {
  const t = convexTest(schema, modules);
  const itemId = await collectingItem(t);
  await t.action(internal.analyze.start, { itemId, photoAt: 99 });
  expect(runAgent).not.toHaveBeenCalled();
  expect(tg.sendMessage).not.toHaveBeenCalled();
});

test("an error marks the item failed and tells the owner", async () => {
  const t = convexTest(schema, modules);
  const itemId = await collectingItem(t);
  vi.mocked(runAgent).mockRejectedValue(new Error("Claude отказался обрабатывать эти фото"));

  await t.action(internal.analyze.start, { itemId, photoAt: 100 });

  const item = await t.run((ctx) => ctx.db.get(itemId));
  expect(item).toMatchObject({ status: "failed", error: "Claude отказался обрабатывать эти фото" });
  expect(vi.mocked(tg.editMessageText).mock.calls[0][2]).toBe(
    "Не получилось разобрать: Claude отказался обрабатывать эти фото\nПришлите фото ещё раз.",
  );
});

test("a question is stored and shown in place of the 'working' message", async () => {
  const t = convexTest(schema, modules);
  const itemId = await collectingItem(t);
  vi.mocked(runAgent).mockResolvedValue({ kind: "question", question: "Он включается?", costUsd: 0.03 });
  await t.action(internal.analyze.start, { itemId, photoAt: 100 });
  const item = await t.run((ctx) => ctx.db.get(itemId));
  expect(item).toMatchObject({ status: "needs_input", question: "Он включается?", costUsd: 0.03 });
  expect(tg.editMessageText).toHaveBeenCalledWith(1, 777, "❓ Он включается?");
});

test("if even the 'working' message fails, the item is failed, not stuck in analyzing", async () => {
  const t = convexTest(schema, modules);
  const itemId = await collectingItem(t);
  vi.mocked(tg.sendMessage).mockRejectedValueOnce(new Error("Too Many Requests"));
  await t.action(internal.analyze.start, { itemId, photoAt: 100 });
  const item = await t.run((ctx) => ctx.db.get(itemId));
  expect(item?.status).toBe("failed");
  expect(runAgent).not.toHaveBeenCalled();
});

test("a draft that Telegram refuses to show stays a draft", async () => {
  const t = convexTest(schema, modules);
  const itemId = await collectingItem(t);
  vi.mocked(runAgent).mockResolvedValue({ kind: "draft", draft, comparables: [], costUsd: 0 });
  vi.mocked(tg.editMessageText).mockRejectedValueOnce(new Error("Bad Request: message is too long"));
  await t.action(internal.analyze.start, { itemId, photoAt: 100 });
  const item = await t.run((ctx) => ctx.db.get(itemId));
  expect(item?.status).toBe("draft");
  expect(vi.mocked(tg.editMessageText).mock.calls[1][2]).toContain("Черновик готов, но Telegram не принял");
});
