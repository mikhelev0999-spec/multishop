import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import type { Draft } from "./lib/validators";

const modules = import.meta.glob("./**/*.*s");

vi.mock("./lib/telegramApi", () => ({
  sendMessage: vi.fn(async () => 500),
  editMessageText: vi.fn(async () => {}),
  removeKeyboard: vi.fn(async () => {}),
  answerCallbackQuery: vi.fn(async () => {}),
  getFileBytes: vi.fn(async () => ({ bytes: new Uint8Array([1, 2, 3]).buffer, mimeType: "image/jpeg" })),
  setWebhook: vi.fn(async () => {}),
  sendMediaGroup: vi.fn(async () => {}),
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
import { runAgent, runRewrite } from "./lib/agent";

const OWNER = 42;
const CHAT = 4242;
const SECRET = "s3cret";

const draft: Draft = {
  titleUk: "Навушники Sony WH-1000XM4",
  descriptionUk: "Б/в, повний комплект.",
  category: "Електроніка / Навушники",
  condition: "good",
  defects: [],
  priceUah: 4500,
  priceUsd: 110,
  priceReasoningRu: "Медиана аналогов $120.",
  comparablesCount: 14,
  marketplaces: ["olx", "ebay"],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("OWNER_TELEGRAM_ID", String(OWNER));
  vi.stubEnv("TELEGRAM_WEBHOOK_SECRET", SECRET);
  vi.stubEnv("ANTHROPIC_API_KEY", "test");
  vi.mocked(runAgent).mockResolvedValue({ kind: "draft", draft, comparables: [], costUsd: 0.12 });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

let updateId = 1;
const msg = (extra: Record<string, unknown>, from = OWNER) => ({
  update_id: updateId++,
  message: { message_id: updateId, from: { id: from }, chat: { id: CHAT }, ...extra },
});
const photo = (fileId: string, extra: Record<string, unknown> = {}, from = OWNER) =>
  msg({ photo: [{ file_id: fileId, width: 1, height: 1 }], ...extra }, from);
const text = (t: string) => msg({ text: t });
const button = (action: string, itemId: string) => ({
  update_id: updateId++,
  callback_query: {
    id: `cb${updateId}`,
    from: { id: OWNER },
    data: `${action}:${itemId}`,
    message: { message_id: 500, chat: { id: CHAT } },
  },
});

function post(t: ReturnType<typeof convexTest>, body: unknown, secret = SECRET) {
  return t.fetch("/telegram", {
    method: "POST",
    headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": secret },
    body: JSON.stringify(body),
  });
}

// Each update's immediate work (e.g. saving the photo) runs before the next update arrives,
// without letting the album quiet period pass. convex-test can't store files from several
// concurrent actions; real Convex can, and the DB writes serialize either way.
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

async function draftItem(t: ReturnType<typeof convexTest>): Promise<Id<"items">> {
  await deliver(t, photo("p"));
  const [item] = await items(t);
  expect(item.status).toBe("draft");
  vi.clearAllMocks();
  return item._id;
}

describe("webhook", () => {
  test("rejects a wrong secret", async () => {
    const t = convexTest(schema, modules);
    const res = await post(t, text("hi"), "nope");
    expect(res.status).toBe(401);
    expect(await t.run((ctx) => ctx.db.query("telegramUpdates").collect())).toHaveLength(0);
  });

  test("ignores strangers without writing anything", async () => {
    const t = convexTest(schema, modules);
    const res = await post(t, photo("x", {}, 999));
    expect(res.status).toBe(200);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.run((ctx) => ctx.db.query("telegramUpdates").collect())).toHaveLength(0);
    expect(await items(t)).toHaveLength(0);
    expect(tg.sendMessage).not.toHaveBeenCalled();
  });

  test("answers 200 to garbage", async () => {
    const t = convexTest(schema, modules);
    const res = await t.fetch("/telegram", {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": SECRET },
      body: "not json",
    });
    expect(res.status).toBe(200);
  });

  test("a repeated update is handled once", async () => {
    const t = convexTest(schema, modules);
    const u = photo("p1");
    await post(t, u);
    await post(t, u);
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await items(t)).toHaveLength(1);
  });

  test("/start explains what to do", async () => {
    const t = convexTest(schema, modules);
    await deliver(t, msg({ text: "/start" }));
    expect(sentTexts()[0]).toContain("Пришлите фото вещи");
  });
});

describe("photos", () => {
  test("an album becomes one item analysed once", async () => {
    const t = convexTest(schema, modules);
    await deliver(
      t,
      photo("a", { media_group_id: "g" }),
      photo("b", { media_group_id: "g", caption: "торг" }),
      photo("c", { media_group_id: "g" }),
    );
    const all = await items(t);
    expect(all).toHaveLength(1);
    expect(all[0].photoIds).toHaveLength(3);
    expect(all[0].caption).toBe("торг");
    expect(runAgent).toHaveBeenCalledTimes(1);
    expect(vi.mocked(runAgent).mock.calls[0][0]).toMatchObject({ caption: "торг", usdUah: 41 });
    expect(vi.mocked(runAgent).mock.calls[0][0].photos).toHaveLength(3);
  });

  test("two single photos are two items", async () => {
    const t = convexTest(schema, modules);
    await deliver(t, photo("a"), photo("b"));
    expect(await items(t)).toHaveLength(2);
  });

  test("an album over 10 photos keeps 10 and says so once", async () => {
    const t = convexTest(schema, modules);
    const updates = Array.from({ length: 12 }, (_, i) => photo(`p${i}`, { media_group_id: "big" }));
    await deliver(t, ...updates);
    const [item] = await items(t);
    expect(item.photoIds).toHaveLength(10);
    expect(sentTexts().filter((s) => s.includes("первые 10"))).toHaveLength(1);
  });

  test("a failed download is reported", async () => {
    const t = convexTest(schema, modules);
    vi.mocked(tg.getFileBytes).mockRejectedValueOnce(new Error("404"));
    await deliver(t, photo("gone"));
    expect(await items(t)).toHaveLength(0);
    expect(sentTexts()[0]).toContain("Не удалось скачать фото");
  });
});

describe("buttons", () => {
  test("publish approves and sends the text to paste", async () => {
    const t = convexTest(schema, modules);
    const id = await draftItem(t);
    await deliver(t, button("publish", id));
    const [item] = await items(t);
    expect(item.status).toBe("approved");
    expect(tg.answerCallbackQuery).toHaveBeenCalled();
    expect(tg.removeKeyboard).toHaveBeenCalledWith(CHAT, 500);
    expect(sentTexts()[0]).toContain("Навушники Sony WH-1000XM4\n\n4500 грн");
  });

  test("cancel", async () => {
    const t = convexTest(schema, modules);
    const id = await draftItem(t);
    await deliver(t, button("cancel", id));
    expect((await items(t))[0].status).toBe("cancelled");
    expect(tg.removeKeyboard).toHaveBeenCalled();
  });

  test("a button on a processed item does nothing", async () => {
    const t = convexTest(schema, modules);
    const id = await draftItem(t);
    await deliver(t, button("cancel", id));
    vi.clearAllMocks();
    await deliver(t, button("publish", id));
    expect((await items(t))[0].status).toBe("cancelled");
    expect(tg.answerCallbackQuery).toHaveBeenCalledWith(expect.any(String), "Эта вещь уже обработана");
    expect(tg.sendMessage).not.toHaveBeenCalled();
  });

  test("a button with a foreign id does not crash", async () => {
    const t = convexTest(schema, modules);
    await deliver(t, button("publish", "not-an-id"));
    expect(tg.answerCallbackQuery).toHaveBeenCalledWith(expect.any(String), "Эта вещь уже обработана");
  });
});

describe("owner replies", () => {
  test("change price in UAH, then the draft is shown again", async () => {
    const t = convexTest(schema, modules);
    const id = await draftItem(t);
    await deliver(t, button("price", id));
    expect(sentTexts()[0]).toContain("Напишите новую цену");
    vi.clearAllMocks();
    await deliver(t, text("3 900 грн"));
    const [item] = await items(t);
    expect(item.draft?.priceUah).toBe(3900);
    expect(item.draft?.priceUsd).toBe(110);
    expect(item.awaiting).toBeUndefined();
    expect(sentTexts()[0]).toContain("3 900 грн");
    expect(tg.removeKeyboard).toHaveBeenCalledWith(CHAT, 500);
  });

  test("change eBay price in USD", async () => {
    const t = convexTest(schema, modules);
    const id = await draftItem(t);
    await deliver(t, button("price", id), text("$95"));
    const [item] = await items(t);
    expect(item.draft).toMatchObject({ priceUah: 4500, priceUsd: 95 });
  });

  test("unreadable price asks again and keeps waiting", async () => {
    const t = convexTest(schema, modules);
    const id = await draftItem(t);
    await deliver(t, button("price", id));
    vi.clearAllMocks();
    await deliver(t, text("подороже"));
    expect(sentTexts()[0]).toContain("Не понял цену");
    expect((await items(t))[0].awaiting).toBe("price");
  });

  test("change text runs a rewrite with the instruction", async () => {
    const t = convexTest(schema, modules);
    const id = await draftItem(t);
    vi.mocked(runRewrite).mockResolvedValue({ draft: { ...draft, descriptionUk: "З коробкою." }, costUsd: 0.01 });
    await deliver(t, button("text", id), text("добавь, что есть коробка"));
    expect(vi.mocked(runRewrite).mock.calls[0][0].instruction).toBe("добавь, что есть коробка");
    const [item] = await items(t);
    expect(item.draft?.descriptionUk).toBe("З коробкою.");
    expect(item.costUsd).toBeCloseTo(0.13);
  });

  test("a question from Claude, the owner's answer, then a draft", async () => {
    const t = convexTest(schema, modules);
    vi.mocked(runAgent).mockResolvedValueOnce({ kind: "question", question: "Сколько памяти?", costUsd: 0.05 });
    await deliver(t, photo("phone"));
    let [item] = await items(t);
    expect(item.status).toBe("needs_input");
    expect(tg.editMessageText).toHaveBeenCalledWith(CHAT, 500, "❓ Сколько памяти?");

    await deliver(t, text("128 ГБ"));
    [item] = await items(t);
    expect(item.status).toBe("draft");
    expect(vi.mocked(runAgent).mock.calls[1][0].answers).toEqual([
      { question: "Сколько памяти?", answer: "128 ГБ" },
    ]);
    expect(item.costUsd).toBeCloseTo(0.17);
  });

  test("text with nothing pending gets a hint", async () => {
    const t = convexTest(schema, modules);
    await deliver(t, text("привет"));
    expect(sentTexts()[0]).toBe("Пришлите фото вещи, чтобы начать.");
  });

  test("asking for a new price on one item cancels waiting on another", async () => {
    const t = convexTest(schema, modules);
    const first = await draftItem(t);
    await deliver(t, photo("second"));
    const second = (await items(t)).find((i) => i._id !== first)!._id;
    await deliver(t, button("text", first), button("price", second));
    const all = await items(t);
    expect(all.find((i) => i._id === first)?.awaiting).toBeUndefined();
    expect(all.find((i) => i._id === second)?.awaiting).toBe("price");
  });
});

describe("review fixes", () => {
  test("a new item drops a forgotten price request, so the answer goes to the new question", async () => {
    const t = convexTest(schema, modules);
    const a = await draftItem(t);
    await deliver(t, button("price", a));
    vi.mocked(runAgent).mockResolvedValueOnce({ kind: "question", question: "Сколько памяти?", costUsd: 0 });
    await deliver(t, photo("b"));
    await deliver(t, text("64"));
    const all = await items(t);
    expect(all.find((i) => i._id === a)?.draft?.priceUah).toBe(4500);
    expect(all.find((i) => i._id === a)?.awaiting).toBeUndefined();
    const b = all.find((i) => i._id !== a)!;
    expect(b.answers).toEqual([{ question: "Сколько памяти?", answer: "64" }]);
  });

  test("a new item cancels an unanswered question about an older one", async () => {
    const t = convexTest(schema, modules);
    vi.mocked(runAgent).mockResolvedValueOnce({ kind: "question", question: "Размер?", costUsd: 0 });
    await deliver(t, photo("shirt"));
    await deliver(t, photo("kettle"));
    const statuses = (await items(t)).map((i) => i.status).sort();
    expect(statuses).toEqual(["cancelled", "draft"]);
  });

  test("an unsupported file gets an explanation", async () => {
    const t = convexTest(schema, modules);
    await deliver(t, msg({ document: { file_id: "f", mime_type: "image/heic", file_size: 100 } }));
    expect(await items(t)).toHaveLength(0);
    expect(sentTexts()[0]).toContain("Пришлите снимок как обычное фото");
  });

  test("a hint sent right after the photo becomes part of the caption", async () => {
    const t = convexTest(schema, modules);
    await deliver(t, photo("p", { caption: "торг" }), text("не работает кнопка"));
    expect(vi.mocked(runAgent).mock.calls[0][0].caption).toBe("торг\nне работает кнопка");
  });

  test("a dollar price on an OLX-only draft is refused", async () => {
    const t = convexTest(schema, modules);
    vi.mocked(runAgent).mockResolvedValueOnce({
      kind: "draft",
      draft: { ...draft, marketplaces: ["olx"] },
      comparables: [],
      costUsd: 0,
    });
    const id = await draftItem(t);
    await deliver(t, button("price", id), text("$40"));
    expect(sentTexts().at(-1)).toContain("только для OLX");
    expect((await items(t))[0].draft?.priceUsd).toBe(110);
  });

  test("a long text to paste is sent in parts", async () => {
    const t = convexTest(schema, modules);
    vi.mocked(runAgent).mockResolvedValueOnce({
      kind: "draft",
      draft: { ...draft, descriptionUk: `${"а".repeat(2500)}\n${"б".repeat(2500)}` },
      comparables: [],
      costUsd: 0,
    });
    const id = await draftItem(t);
    await deliver(t, button("publish", id));
    const parts = sentTexts();
    expect(parts.length).toBe(2);
    expect(parts.every((p) => p.length <= 4096)).toBe(true);
  });

  test("a price changed during a rewrite survives it", async () => {
    const t = convexTest(schema, modules);
    const id = await draftItem(t);
    vi.mocked(runRewrite).mockImplementationOnce(async () => {
      await t.run(async (ctx) => {
        const item = await ctx.db.get(id);
        await ctx.db.patch(id, { draft: { ...item!.draft!, priceUah: 3333 } });
      });
      return { draft: { ...draft, descriptionUk: "Новий текст." }, costUsd: 0 };
    });
    await deliver(t, button("text", id), text("короче"));
    const [item] = await items(t);
    expect(item.draft).toMatchObject({ descriptionUk: "Новий текст.", priceUah: 3333 });
  });

  test("the watchdog fails an analysis that never reported back, but not a newer run", async () => {
    const t = convexTest(schema, modules);
    const id = await t.run((ctx) =>
      ctx.db.insert("items", {
        chatId: CHAT,
        status: "analyzing",
        photoIds: [],
        lastPhotoAt: 0,
        answers: [],
        costUsd: 0,
        analysisRun: 2,
      }),
    );
    await t.mutation(internal.items.watchdog, { itemId: id, run: 1 });
    expect((await items(t))[0].status).toBe("analyzing");
    await t.mutation(internal.items.watchdog, { itemId: id, run: 2 });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await items(t))[0].status).toBe("failed");
    expect(sentTexts()).toContain("Разбор занял слишком много времени и прервался. Пришлите фото ещё раз.");
  });
});

