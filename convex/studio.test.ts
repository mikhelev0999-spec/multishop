import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";
import { looksLikeJpeg } from "./studio";
import type { Draft } from "./lib/validators";

const modules = import.meta.glob("./**/*.*s");

vi.mock("./lib/telegramApi", () => ({
  sendMessage: vi.fn(async () => 1),
  editMessageText: vi.fn(async () => {}),
  removeKeyboard: vi.fn(async () => {}),
  answerCallbackQuery: vi.fn(async () => {}),
  getFileBytes: vi.fn(),
  setWebhook: vi.fn(),
  sendMediaGroup: vi.fn(async () => {}),
  sendChatAction: vi.fn(async () => {}),
  setMyCommands: vi.fn(async () => {}),
}));
import * as tg from "./lib/telegramApi";

const TOKEN = "123456:TEST";
const OWNER = 42;

async function hmac(key: BufferSource, msg: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
}
async function initData(userId = OWNER): Promise<string> {
  const fields: Record<string, string> = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    user: JSON.stringify({ id: userId }),
  };
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), TOKEN);
  const hash = [...new Uint8Array(await hmac(secret, check))]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const draft: Draft = {
  titleUk: "Чоботи Chloé Betty",
  descriptionUk: "Як нові.",
  category: "Взуття",
  condition: "like_new",
  defects: [],
  priceUah: 7500,
  priceUsd: 220,
  priceReasoningRu: "…",
  comparablesCount: 0,
  marketplaces: ["olx"],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("TELEGRAM_BOT_TOKEN", TOKEN);
  vi.stubEnv("OWNER_TELEGRAM_ID", String(OWNER));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

const jpeg = () =>
  new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])], { type: "image/jpeg" });

async function draftItem(t: ReturnType<typeof convexTest>, status: "draft" | "approved" = "draft") {
  return t.run(async (ctx) => {
    const photo = await ctx.storage.store(jpeg());
    const id = await ctx.db.insert("items", {
      chatId: 4242,
      status,
      photoIds: [photo],
      lastPhotoAt: 0,
      answers: [],
      costUsd: 0,
      draft,
    });
    await ctx.db.insert("storageOwners", { storageId: photo, itemId: id, kind: "photo" });
    return id;
  });
}

const exists = (t: ReturnType<typeof convexTest>, id: Id<"_storage">) =>
  t.run(async (ctx) => (await ctx.storage.get(id)) !== null);

const store = (t: ReturnType<typeof convexTest>, blob = jpeg()) =>
  t.run((ctx) => ctx.storage.store(blob)) as Promise<Id<"_storage">>;

describe("access", () => {
  test("a stranger's initData is refused", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t);
    await expect(
      t.action(api.studio.load, { initData: await initData(7), itemId }),
    ).rejects.toThrow("владельцу");
  });

  test("garbage initData is refused", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t);
    await expect(
      t.action(api.studio.load, { initData: "hash=00&user=%7B%7D", itemId }),
    ).rejects.toThrow();
  });

  test("only drafts can be edited", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t, "approved");
    await expect(t.action(api.studio.load, { initData: await initData(), itemId })).rejects.toThrow(
      "черновик",
    );
  });
});

describe("flow", () => {
  test("load returns the title and photo URLs", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t);
    const res = await t.action(api.studio.load, { initData: await initData(), itemId });
    expect(res.title).toBe("Чоботи Chloé Betty");
    expect(res.photos).toHaveLength(1);
    expect(res.photos[0].url).toMatch(/^https?:\/\//);
    expect(res.studio).toEqual([]);
  });

  test("uploadUrls hands out one URL per photo, at most 10", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t);
    const urls = await t.action(api.studio.uploadUrls, {
      initData: await initData(),
      itemId,
      count: 2,
    });
    expect(urls).toHaveLength(2);
    await expect(
      t.action(api.studio.uploadUrls, { initData: await initData(), itemId, count: 11 }),
    ).rejects.toThrow();
  });

  test("save attaches processed photos, replaces older ones and sends them to the chat", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t);
    const first = await store(t);
    await t.action(api.studio.save, { initData: await initData(), itemId, storageIds: [first] });
    const second = await store(t);
    await t.action(api.studio.save, { initData: await initData(), itemId, storageIds: [second] });
    await t.finishAllScheduledFunctions(vi.runAllTimers);

    const item = await t.run((ctx) => ctx.db.get(itemId));
    expect(item?.studioPhotoIds).toEqual([second]);
    expect(await exists(t, first)).toBe(false);
    expect(tg.sendMediaGroup).toHaveBeenCalledTimes(2);
  });

  test("looksLikeJpeg checks the file signature", () => {
    expect(looksLikeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xdb]))).toBe(true);
    expect(looksLikeJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe(false);
    expect(looksLikeJpeg(new TextEncoder().encode("%PDF-1.7"))).toBe(false);
  });

  test("save refuses non-images and deletes them", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t);
    const pdf = await store(t, new Blob([new Uint8Array(5)], { type: "application/pdf" }));
    await expect(
      t.action(api.studio.save, { initData: await initData(), itemId, storageIds: [pdf] }),
    ).rejects.toThrow("не JPEG");
    expect(await exists(t, pdf)).toBe(false);
  });
});

test("publish sends the text and then the photos, processed first", async () => {
  const t = convexTest(schema, modules);
  const itemId = await draftItem(t);
  const processed = await store(t);
  await t.action(api.studio.save, { initData: await initData(), itemId, storageIds: [processed] });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  vi.clearAllMocks();

  await t.mutation(internal.telegram.handleUpdate, {
    update: {
      update_id: 900,
      callback_query: {
        id: "cb",
        from: { id: OWNER },
        data: `publish:${itemId}`,
        message: { message_id: 1, chat: { id: 4242 } },
      },
    },
  });
  await t.finishAllScheduledFunctions(vi.runAllTimers);
  expect(vi.mocked(tg.sendMessage).mock.calls[0][1]).toContain("Текст для OLX");
  const urls = vi.mocked(tg.sendMediaGroup).mock.calls[0][1];
  expect(urls).toHaveLength(2);
  const item = await t.run((ctx) => ctx.db.get(itemId));
  const processedUrl = await t.run((ctx) => ctx.storage.getUrl(item!.studioPhotoIds![0]));
  expect(urls[0]).toBe(processedUrl);
});

describe("review fixes", () => {
  test("an original photo passed to save is refused and NOT deleted", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t);
    const original = (await t.run((ctx) => ctx.db.get(itemId)))!.photoIds[0];
    const fresh = await store(t, new Blob([new Uint8Array([1, 2, 3])]));
    await expect(
      t.action(api.studio.save, {
        initData: await initData(),
        itemId,
        storageIds: [original, fresh],
      }),
    ).rejects.toThrow("чужой файл");
    expect(await exists(t, original)).toBe(true);
    expect(await exists(t, fresh)).toBe(false);
  });

  test("another item's studio photo is refused", async () => {
    const t = convexTest(schema, modules);
    const a = await draftItem(t);
    const b = await draftItem(t);
    const photo = await store(t);
    await t.action(api.studio.save, { initData: await initData(), itemId: a, storageIds: [photo] });
    await expect(
      t.action(api.studio.save, { initData: await initData(), itemId: b, storageIds: [photo] }),
    ).rejects.toThrow("чужой файл");
    expect((await t.run((ctx) => ctx.db.get(a)))?.studioPhotoIds).toEqual([photo]);
  });

  test("saving again keeps the processed photos that are passed back", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t);
    const first = await store(t);
    await t.action(api.studio.save, { initData: await initData(), itemId, storageIds: [first] });
    const second = await store(t);
    await t.action(api.studio.save, {
      initData: await initData(),
      itemId,
      storageIds: [first, second],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect((await t.run((ctx) => ctx.db.get(itemId)))?.studioPhotoIds).toEqual([first, second]);
    expect(await exists(t, first)).toBe(true);
    // Only the newly added photo is posted the second time.
    expect(vi.mocked(tg.sendMediaGroup).mock.calls.at(-1)?.[1]).toHaveLength(1);
  });

  test("an old unowned file is not accepted as a new upload", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t);
    const stale = await store(t);
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    await expect(
      t.action(api.studio.save, { initData: await initData(), itemId, storageIds: [stale] }),
    ).rejects.toThrow("чужой файл");
  });

  test("orphan uploads are pruned after an hour, owned files stay", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t);
    const original = (await t.run((ctx) => ctx.db.get(itemId)))!.photoIds[0];
    const orphan = await store(t);
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    await t.mutation(internal.files.pruneOrphans, {});
    expect(await exists(t, orphan)).toBe(false);
    expect(await exists(t, original)).toBe(true);
  });

  test("backfill gives owners to files stored before tracking", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t);
    await t.run(async (ctx) => {
      for (const row of await ctx.db.query("storageOwners").collect()) await ctx.db.delete(row._id);
    });
    expect(await t.mutation(internal.files.backfillOwners, {})).toBe(1);
    expect(await t.mutation(internal.files.backfillOwners, {})).toBe(0);
    const original = (await t.run((ctx) => ctx.db.get(itemId)))!.photoIds[0];
    vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
    await t.mutation(internal.files.pruneOrphans, {});
    expect(await exists(t, original)).toBe(true);
  });

  test("cancel deletes processed photos", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t);
    const photo = await store(t);
    await t.action(api.studio.save, { initData: await initData(), itemId, storageIds: [photo] });
    await t.mutation(internal.telegram.handleUpdate, {
      update: {
        update_id: 901,
        callback_query: {
          id: "cb",
          from: { id: OWNER },
          data: `cancel:${itemId}`,
          message: { message_id: 1, chat: { id: 4242 } },
        },
      },
    });
    expect(await exists(t, photo)).toBe(false);
  });

  test("a failed album is reported to the owner", async () => {
    const t = convexTest(schema, modules);
    const itemId = await draftItem(t);
    vi.mocked(tg.sendMediaGroup).mockRejectedValueOnce(new Error("WEBPAGE_CURL_FAILED"));
    await t.action(api.studio.save, {
      initData: await initData(),
      itemId,
      storageIds: [await store(t)],
    });
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(vi.mocked(tg.sendMessage).mock.calls.at(-1)?.[1]).toContain("Не удалось отправить фото");
  });
});
