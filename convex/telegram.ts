import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import { copyText } from "./lib/draftMessage";
import { clearAwaiting } from "./lib/itemState";
import { parsePrice } from "./lib/pricing";
import * as telegramApi from "./lib/telegramApi";
import { parseUpdate, type CallbackAction, type Incoming } from "./lib/telegramUpdate";

export const HELP_TEXT = [
  "Пришлите фото вещи — до 10 штук, можно альбомом. Подписью можно добавить подсказку:",
  "«не работает кнопка», «торг», «размер M».",
  "",
  "Я распознаю вещь, найду похожие объявления, предложу цену и пришлю черновик.",
  "Ничего не публикуется, пока вы не нажмёте «Выставить».",
].join("\n");

const NOTHING_TO_DO = "Пришлите фото вещи, чтобы начать.";
const UNSUPPORTED_FILE =
  "Этот файл не подойдёт. Пришлите снимок как обычное фото (не файлом) — или файлом JPEG/PNG до 3,5 МБ.";
const PRICE_PROMPT = "Напишите новую цену: «1500» — для OLX в гривнах, «$40» — для eBay.";
const TEXT_PROMPT = "Что поменять в тексте? Например: «добавь, что есть коробка».";

function ownerId(): number {
  const raw = process.env.OWNER_TELEGRAM_ID;
  const id = Number(raw);
  if (!raw || !Number.isInteger(id)) throw new Error("OWNER_TELEGRAM_ID is not set");
  return id;
}

export const handleUpdate = internalMutation({
  args: { update: v.any() },
  returns: v.null(),
  handler: async (ctx, { update }) => {
    const incoming = parseUpdate(update);
    if (incoming.kind === "ignored" || incoming.fromId !== ownerId()) return null;

    const seen = await ctx.db
      .query("telegramUpdates")
      .withIndex("by_update_id", (q) => q.eq("updateId", incoming.updateId))
      .first();
    if (seen) return null;
    await ctx.db.insert("telegramUpdates", { updateId: incoming.updateId });

    switch (incoming.kind) {
      case "photo":
        await ctx.scheduler.runAfter(0, internal.telegram.storePhoto, {
          chatId: incoming.chatId,
          fileId: incoming.fileId,
          receivedAt: Date.now(),
          ...(incoming.mimeType ? { mimeType: incoming.mimeType } : {}),
          ...(incoming.mediaGroupId ? { mediaGroupId: incoming.mediaGroupId } : {}),
          ...(incoming.caption ? { caption: incoming.caption } : {}),
        });
        break;
      case "command":
        await send(ctx, incoming.chatId, HELP_TEXT);
        break;
      case "unsupported_file":
        await send(ctx, incoming.chatId, UNSUPPORTED_FILE);
        break;
      case "text":
        await handleText(ctx, incoming.chatId, incoming.text);
        break;
      case "callback":
        await handleCallback(ctx, incoming);
        break;
    }
    return null;
  },
});

export const storePhoto = internalAction({
  args: {
    chatId: v.number(),
    fileId: v.string(),
    receivedAt: v.number(),
    mimeType: v.optional(v.string()),
    mediaGroupId: v.optional(v.string()),
    caption: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, { chatId, fileId, receivedAt, mimeType, mediaGroupId, caption }) => {
    let storageId: Id<"_storage">;
    try {
      const file = await telegramApi.getFileBytes(fileId);
      storageId = await ctx.storage.store(new Blob([file.bytes], { type: mimeType ?? file.mimeType }));
    } catch (e) {
      console.error("photo download failed", e);
      await telegramApi.sendMessage(chatId, "Не удалось скачать фото из Telegram. Пришлите его ещё раз.");
      return null;
    }
    await ctx.runMutation(internal.items.attachPhoto, {
      chatId,
      storageId,
      receivedAt,
      mediaGroupId,
      caption,
    });
    return null;
  },
});

const UPDATE_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;

export const pruneUpdates = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - UPDATE_RETENTION_MS;
    const old = await ctx.db
      .query("telegramUpdates")
      .withIndex("by_creation_time", (q) => q.lt("_creationTime", cutoff))
      .take(500);
    for (const row of old) await ctx.db.delete(row._id);
    if (old.length === 500) await ctx.scheduler.runAfter(0, internal.telegram.pruneUpdates, {});
    return null;
  },
});

export const setWebhook = internalAction({
  args: {},
  returns: v.string(),
  handler: async () => {
    const site = process.env.CONVEX_SITE_URL;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!site) throw new Error("CONVEX_SITE_URL is not set");
    if (!secret) throw new Error("TELEGRAM_WEBHOOK_SECRET is not set");
    const url = `${site}/telegram`;
    await telegramApi.setWebhook(url, secret);
    return url;
  },
});

async function send(ctx: MutationCtx, chatId: number, text: string) {
  await ctx.scheduler.runAfter(0, internal.bot.send, { chatId, text });
}

async function firstAwaiting(ctx: MutationCtx, awaiting: "price" | "text") {
  return ctx.db
    .query("items")
    .withIndex("by_awaiting", (q) => q.eq("awaiting", awaiting))
    .order("desc")
    .first();
}

async function handleText(ctx: MutationCtx, chatId: number, text: string) {
  const priceItem = await firstAwaiting(ctx, "price");
  if (priceItem) {
    const price = parsePrice(text);
    if (!price) {
      await send(ctx, chatId, "Не понял цену. Пример: 1500 или $40.");
      return;
    }
    if (priceItem.status !== "draft" || !priceItem.draft) {
      await ctx.db.patch(priceItem._id, { awaiting: undefined });
      await send(ctx, chatId, NOTHING_TO_DO);
      return;
    }
    if ("usd" in price && !priceItem.draft.marketplaces.includes("ebay")) {
      await send(ctx, chatId, "Этот черновик только для OLX — напишите цену в гривнах, например 1500.");
      return;
    }
    const draft =
      "uah" in price
        ? { ...priceItem.draft, priceUah: Math.round(price.uah) }
        : { ...priceItem.draft, priceUsd: price.usd };
    await ctx.db.patch(priceItem._id, { draft, awaiting: undefined });
    await ctx.scheduler.runAfter(0, internal.analyze.show, { itemId: priceItem._id });
    return;
  }

  const textItem = await firstAwaiting(ctx, "text");
  if (textItem) {
    await ctx.db.patch(textItem._id, { awaiting: undefined });
    if (textItem.status === "draft") {
      await send(ctx, chatId, "Переписываю…");
      await ctx.scheduler.runAfter(0, internal.analyze.rewrite, { itemId: textItem._id, instruction: text });
    } else {
      await send(ctx, chatId, NOTHING_TO_DO);
    }
    return;
  }

  const waiting = await ctx.db
    .query("items")
    .withIndex("by_status", (q) => q.eq("status", "needs_input"))
    .order("desc")
    .first();
  if (waiting) {
    await ctx.db.patch(waiting._id, {
      answers: [...waiting.answers, { question: waiting.question ?? "", answer: text }],
    });
    await ctx.scheduler.runAfter(0, internal.analyze.start, {
      itemId: waiting._id,
      photoAt: waiting.lastPhotoAt,
    });
    return;
  }

  const collecting = await latestWithStatus(ctx, "collecting");
  if (collecting) {
    // A hint sent right after the photos: treat it like a caption.
    const caption = collecting.caption ? `${collecting.caption}\n${text}` : text;
    await ctx.db.patch(collecting._id, { caption });
    return;
  }
  if (await latestWithStatus(ctx, "analyzing")) {
    await send(ctx, chatId, "Уже разбираю фото — подождите немного.");
    return;
  }

  await send(ctx, chatId, NOTHING_TO_DO);
}

async function handleCallback(ctx: MutationCtx, cb: Extract<Incoming, { kind: "callback" }>) {
  const answer = (text?: string) =>
    ctx.scheduler.runAfter(0, internal.bot.answer, { callbackId: cb.callbackId, ...(text ? { text } : {}) });

  const itemId = ctx.db.normalizeId("items", cb.itemId);
  const item = itemId ? await ctx.db.get(itemId) : null;
  if (!item || item.status !== "draft" || !item.draft) {
    await answer("Эта вещь уже обработана");
    return;
  }
  await answer();
  await ACTIONS[cb.action](ctx, item, item.draft);
}

const ACTIONS: Record<
  CallbackAction,
  (ctx: MutationCtx, item: Doc<"items">, draft: NonNullable<Doc<"items">["draft"]>) => Promise<void>
> = {
  publish: async (ctx, item, draft) => {
    await ctx.db.patch(item._id, { status: "approved", awaiting: undefined });
    await removeButtons(ctx, item);
    await send(ctx, item.chatId, `✅ Готово. Текст для OLX — скопируйте целиком:\n\n${copyText(draft)}`);
  },
  price: async (ctx, item) => {
    await setAwaiting(ctx, item._id, "price");
    await send(ctx, item.chatId, PRICE_PROMPT);
  },
  text: async (ctx, item) => {
    await setAwaiting(ctx, item._id, "text");
    await send(ctx, item.chatId, TEXT_PROMPT);
  },
  cancel: async (ctx, item) => {
    await ctx.db.patch(item._id, { status: "cancelled", awaiting: undefined });
    await removeButtons(ctx, item);
    await send(ctx, item.chatId, "Отменено.");
  },
};

async function removeButtons(ctx: MutationCtx, item: Doc<"items">) {
  if (item.draftMessageId !== undefined) {
    await ctx.scheduler.runAfter(0, internal.bot.removeKeyboard, {
      chatId: item.chatId,
      messageId: item.draftMessageId,
    });
  }
}

/** Only one item waits for a reply at a time: a new request replaces the old one. */
async function setAwaiting(ctx: MutationCtx, itemId: Id<"items">, awaiting: "price" | "text") {
  await clearAwaiting(ctx, itemId);
  await ctx.db.patch(itemId, { awaiting });
}

function latestWithStatus(ctx: MutationCtx, status: "collecting" | "analyzing") {
  return ctx.db
    .query("items")
    .withIndex("by_status", (q) => q.eq("status", status))
    .order("desc")
    .first();
}
