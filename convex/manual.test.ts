import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

vi.mock("./lib/telegramApi", () => ({
  sendMessage: vi.fn(async () => 600),
  editMessageText: vi.fn(async () => {}),
  removeKeyboard: vi.fn(async () => {}),
  answerCallbackQuery: vi.fn(async () => {}),
  getFileBytes: vi.fn(async () => ({ bytes: new Uint8Array([1]).buffer, mimeType: "image/jpeg" })),
  setWebhook: vi.fn(),
  sendMediaGroup: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => {}),
  setMyCommands: vi.fn(async () => {}),
}));
vi.mock("./lib/agent", async (orig) => ({
  ...(await orig<typeof import("./lib/agent")>()),
  runAgent: vi.fn(),
  runRewrite: vi.fn(),
}));

import * as tg from "./lib/telegramApi";
import { runAgent, runRewrite } from "./lib/agent";

const OWNER = 42;
const CHAT = 4242;

// No ANTHROPIC_API_KEY: manual mode.
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OWNER_TELEGRAM_ID", String(OWNER));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const draftInput = {
  title_uk: "Чайник Bosch TWK",
  description_uk: "Робочий, є накип.",
  category: "Дім / Кухня",
  brand: "Bosch",
  model: "",
  condition: "good",
  defects: ["накипь"],
  price_uah: 400,
  price_usd: 10,
  price_reasoning_ru: "Похожие по 350–500 грн.",
  comparables_count: 5,
  marketplaces: ["olx"],
};

let updateId = 1;
const update = (message: Record<string, unknown>) => ({
  update_id: updateId++,
  message: { message_id: updateId, from: { id: OWNER }, chat: { id: CHAT }, ...message },
});
const photo = (fileId: string, extra: Record<string, unknown> = {}) =>
  update({ photo: [{ file_id: fileId, width: 1, height: 1 }], ...extra });

async function deliver(t: ReturnType<typeof convexTest>, ...updates: unknown[]) {
  for (const u of updates) {
    await t.mutation(internal.telegram.handleUpdate, { update: u });
    vi.advanceTimersByTime(1);
    await t.finishInProgressScheduledFunctions();
  }
  await t.finishAllScheduledFunctions(vi.runAllTimers);
}
const items = (t: ReturnType<typeof convexTest>) => t.run((ctx) => ctx.db.query("items").collect());
const sentTexts = () => vi.mocked(tg.sendMessage).mock.calls.map((c) => c[1]);

test("without a key, photos are queued for Claude in the chat", async () => {
  const t = convexTest(schema, modules);
  await deliver(t, photo("a", { caption: "торг" }));
  const [item] = await items(t);
  expect(item.status).toBe("queued");
  expect(runAgent).not.toHaveBeenCalled();
  expect(sentTexts()[0]).toContain("Напишите Claude в чат «разбери»");

  const q = await t.query(internal.manual.queue, {});
  expect(q.analyze).toHaveLength(1);
  expect(q.analyze[0]).toMatchObject({ itemId: item._id, caption: "торг" });
  expect(q.analyze[0].photoUrls).toHaveLength(1);
  expect(q.rewrite).toEqual([]);
});

test("a submitted draft replaces the queue message", async () => {
  const t = convexTest(schema, modules);
  await deliver(t, photo("a"));
  const [queued] = await items(t);
  expect(await t.action(internal.manual.submitDraft, { itemId: queued._id, draft: draftInput })).toBe("ok");

  const [item] = await items(t);
  expect(item.status).toBe("draft");
  expect(item.draft?.titleUk).toBe("Чайник Bosch TWK");
  const [, messageId, text, keyboard] = vi.mocked(tg.editMessageText).mock.calls[0];
  expect(messageId).toBe(600);
  expect(text).toContain("разбор вручную");
  expect((keyboard?.[0][0] as { callbackData: string }).callbackData).toBe(`publish:${item._id}`);
});

test("an invalid draft is refused with the reason", async () => {
  const t = convexTest(schema, modules);
  await deliver(t, photo("a"));
  const [queued] = await items(t);
  const res = await t.action(internal.manual.submitDraft, {
    itemId: queued._id,
    draft: { ...draftInput, price_uah: 0 },
  });
  expect(res).toContain("price_uah");
  expect((await items(t))[0].status).toBe("queued");
});

test("a question goes to the owner and the answer re-queues the item", async () => {
  const t = convexTest(schema, modules);
  await deliver(t, photo("a"));
  const [queued] = await items(t);
  expect(await t.action(internal.manual.ask, { itemId: queued._id, question: "Он включается?" })).toBe("ok");
  expect(tg.editMessageText).toHaveBeenCalledWith(CHAT, 600, "❓ Он включается?");
  expect((await items(t))[0].status).toBe("needs_input");

  await deliver(t, update({ text: "да" }));
  const [item] = await items(t);
  expect(item.status).toBe("queued");
  const q = await t.query(internal.manual.queue, {});
  expect(q.analyze[0].answers).toEqual([{ question: "Он включается?", answer: "да" }]);
});

test("'change text' waits for Claude in the chat and keeps the price", async () => {
  const t = convexTest(schema, modules);
  await deliver(t, photo("a"));
  const [queued] = await items(t);
  await t.action(internal.manual.submitDraft, { itemId: queued._id, draft: draftInput });
  vi.clearAllMocks();

  await deliver(
    t,
    { update_id: updateId++, callback_query: { id: "cb", from: { id: OWNER }, data: `text:${queued._id}`, message: { message_id: 600, chat: { id: CHAT } } } },
    update({ text: "добавь, что шнур длинный" }),
  );
  expect(runRewrite).not.toHaveBeenCalled();
  expect(sentTexts().at(-1)).toContain("«перепиши»");
  const q = await t.query(internal.manual.queue, {});
  expect(q.rewrite).toMatchObject([{ itemId: queued._id, instruction: "добавь, что шнур длинный" }]);

  const res = await t.action(internal.manual.submitDraft, {
    itemId: queued._id,
    draft: { ...draftInput, description_uk: "Робочий, довгий шнур.", price_uah: 999 },
  });
  expect(res).toBe("ok");
  const [item] = await items(t);
  expect(item.draft).toMatchObject({ descriptionUk: "Робочий, довгий шнур.", priceUah: 400 });
  expect(item.rewriteRequest).toBeUndefined();
  expect((await t.query(internal.manual.queue, {})).rewrite).toEqual([]);
});

test("submitting for an item that is not waiting does nothing", async () => {
  const t = convexTest(schema, modules);
  await deliver(t, photo("a"));
  const [queued] = await items(t);
  await t.action(internal.manual.submitDraft, { itemId: queued._id, draft: draftInput });
  const again = await t.action(internal.manual.submitDraft, { itemId: queued._id, draft: draftInput });
  expect(again).toBe("item is draft, nothing to submit");
});
