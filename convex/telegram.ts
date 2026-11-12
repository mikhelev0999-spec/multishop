import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, type MutationCtx } from "./_generated/server";
import {
  esc,
  itemCard,
  itemsList,
  listedKeyboard,
  MAX_LISTED_ITEMS,
  NEW_ITEM_TEXT,
  MAX_PRICE_UAH,
  priceKeyboard,
  relistKeyboard,
  soldKeyboard,
  START_TEXT,
  statsText,
  uah,
  type Stats,
} from "./lib/botTexts";
import { copyText, listingPhotos } from "./lib/draftMessage";
import { deleteFile } from "./lib/fileOwners";
import { clearAwaiting } from "./lib/itemState";
import { BOT_COMMANDS } from "./lib/menu";
import { isManualMode } from "./lib/mode";
import { parsePrice } from "./lib/pricing";
import * as telegramApi from "./lib/telegramApi";
import type { Keyboard } from "./lib/telegramApi";
import {
  parseUpdate,
  type CallbackAction,
  type Command,
  type Incoming,
} from "./lib/telegramUpdate";
import type { ItemStatus } from "./lib/validators";

const NOTHING_TO_DO = "📸 Пришлите фото вещи, чтобы начать. Меню — кнопки внизу.";
const MANUAL_REWRITE_QUEUED =
  "Записал. Попросите Claude в чате: «перепиши» — новый текст придёт сюда.";
const UNSUPPORTED_FILE =
  "Этот файл не подойдёт. Пришлите снимок как обычное фото (не файлом) — или файлом JPEG/PNG до 3,5 МБ.";
const PRICE_PROMPT = "✍️ Напишите новую цену: «1500» — для OLX в гривнах, «$40» — для eBay.";
const TEXT_PROMPT = "✏️ Что поменять в тексте? Например: «добавь, что есть коробка».";

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
        await handleCommand(ctx, incoming.chatId, incoming.command);
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
      storageId = await ctx.storage.store(
        new Blob([file.bytes], { type: mimeType ?? file.mimeType }),
      );
    } catch (e) {
      console.error("photo download failed", e);
      await telegramApi.sendMessage(
        chatId,
        "Не удалось скачать фото из Telegram. Пришлите его ещё раз.",
      );
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
    await telegramApi.setMyCommands(BOT_COMMANDS);
    return url;
  },
});

interface SendOpts {
  html?: boolean;
  menu?: boolean;
  keyboard?: Keyboard;
}

async function send(ctx: MutationCtx, chatId: number, text: string, opts: SendOpts = {}) {
  await ctx.scheduler.runAfter(0, internal.bot.send, {
    chatId,
    text,
    ...(opts.html ? { html: true } : {}),
    ...(opts.menu ? { menu: true } : {}),
    ...(opts.keyboard ? { keyboard: opts.keyboard } : {}),
  });
}

type Awaiting = "price" | "text" | "sold";

async function firstAwaiting(ctx: MutationCtx, awaiting: Awaiting) {
  return ctx.db
    .query("items")
    .withIndex("by_awaiting", (q) => q.eq("awaiting", awaiting))
    .order("desc")
    .first();
}

async function handleCommand(ctx: MutationCtx, chatId: number, command: Command) {
  switch (command) {
    case "start":
      await send(ctx, chatId, START_TEXT, { html: true, menu: true });
      return;
    case "help":
      await send(ctx, chatId, START_TEXT, { html: true, menu: true });
      return;
    case "new":
      await clearAwaiting(ctx);
      await send(ctx, chatId, NEW_ITEM_TEXT);
      return;
    case "items": {
      await clearAwaiting(ctx);
      const recent = await ctx.db
        .query("items")
        .order("desc")
        .take(MAX_LISTED_ITEMS * 3);
      const shown = recent.filter((it) => it.status !== "cancelled").slice(0, MAX_LISTED_ITEMS);
      const { text, keyboard } = itemsList(shown);
      await send(ctx, chatId, text, { html: true, ...(keyboard.length ? { keyboard } : {}) });
      return;
    }
    case "stats":
      await clearAwaiting(ctx);
      await send(ctx, chatId, statsText(await collectStats(ctx)), { html: true });
      return;
  }
}

const STATS_LIMIT = 1000;

async function collectStats(ctx: MutationCtx): Promise<Stats> {
  const byStatus = (status: "draft" | "approved" | "sold") =>
    ctx.db
      .query("items")
      .withIndex("by_status", (q) => q.eq("status", status))
      .take(STATS_LIMIT);
  const [drafts, listed, sold] = await Promise.all([
    byStatus("draft"),
    byStatus("approved"),
    byStatus("sold"),
  ]);
  return {
    drafts: drafts.length,
    listed: listed.length,
    listedSum: listed.reduce((sum, it) => sum + (it.draft?.priceUah ?? 0), 0),
    sold: sold.length,
    soldSum: sold.reduce((sum, it) => sum + (it.soldPriceUah ?? 0), 0),
  };
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
      await send(
        ctx,
        chatId,
        "Этот черновик только для OLX — напишите цену в гривнах, например 1500.",
      );
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

  const soldItem = await firstAwaiting(ctx, "sold");
  if (soldItem) {
    const price = parsePrice(text);
    if (!price || !("uah" in price)) {
      await send(ctx, chatId, "Не понял сумму. Напишите в гривнах, например 2000.");
      return;
    }
    if (soldItem.status !== "approved") {
      await ctx.db.patch(soldItem._id, { awaiting: undefined });
      await send(ctx, chatId, NOTHING_TO_DO);
      return;
    }
    await markSold(ctx, soldItem, Math.round(price.uah));
    return;
  }

  const textItem = await firstAwaiting(ctx, "text");
  if (textItem) {
    await ctx.db.patch(textItem._id, { awaiting: undefined });
    if (textItem.status === "draft" && isManualMode()) {
      await ctx.db.patch(textItem._id, { rewriteRequest: text });
      await send(ctx, chatId, MANUAL_REWRITE_QUEUED);
    } else if (textItem.status === "draft") {
      await send(ctx, chatId, "✏️ Переписываю…");
      await ctx.scheduler.runAfter(0, internal.analyze.rewrite, {
        itemId: textItem._id,
        instruction: text,
      });
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

  const collecting =
    (await latestWithStatus(ctx, "collecting")) ?? (await latestWithStatus(ctx, "queued"));
  if (collecting) {
    // A hint sent right after the photos: treat it like a caption.
    const caption = collecting.caption ? `${collecting.caption}\n${text}` : text;
    await ctx.db.patch(collecting._id, { caption });
    return;
  }
  if (await latestWithStatus(ctx, "analyzing")) {
    await send(ctx, chatId, "⏳ Уже разбираю фото — подождите немного.");
    return;
  }

  await send(ctx, chatId, NOTHING_TO_DO, { menu: true });
}

/** Which buttons work in which item status; anything else is an old button. */
const ALLOWED: Record<CallbackAction, ItemStatus[]> = {
  publish: ["draft"],
  price: ["draft"],
  pr: ["draft"],
  prc: ["draft"],
  text: ["draft"],
  cancel: ["draft"],
  sold: ["approved"],
  soldat: ["approved"],
  again: ["approved"],
  unlist: ["approved"],
  relist: ["sold", "cancelled"],
  open: ["collecting", "queued", "analyzing", "needs_input", "draft", "approved", "sold", "failed"],
};

async function handleCallback(ctx: MutationCtx, cb: Extract<Incoming, { kind: "callback" }>) {
  const answer = (text?: string) =>
    ctx.scheduler.runAfter(0, internal.bot.answer, {
      callbackId: cb.callbackId,
      ...(text ? { text } : {}),
    });

  const itemId = ctx.db.normalizeId("items", cb.itemId);
  const item = itemId ? await ctx.db.get(itemId) : null;
  // Only items that were on sale can go back on sale (not cancelled drafts).
  const relistable = cb.action !== "relist" || item?.listedAt !== undefined;
  if (!item || !ALLOWED[cb.action].includes(item.status) || !relistable) {
    await answer("Эта вещь уже обработана");
    return;
  }
  const toast = await ACTIONS[cb.action](ctx, item, cb.arg);
  if (FINISHING.has(cb.action)) {
    // The pressed message's buttons are done; leaving them invites stale presses.
    await ctx.scheduler.runAfter(0, internal.bot.removeKeyboard, {
      chatId: cb.chatId,
      messageId: cb.messageId,
    });
  }
  await answer(toast ?? undefined);
}

/** Buttons whose message has nothing more to offer once pressed. */
const FINISHING = new Set<CallbackAction>(["pr", "soldat", "unlist", "relist"]);

type Action = (ctx: MutationCtx, item: Doc<"items">, arg?: string) => Promise<string | void>;

const ACTIONS: Record<CallbackAction, Action> = {
  publish: async (ctx, item) => {
    const draft = item.draft!;
    await ctx.db.patch(item._id, { status: "approved", awaiting: undefined, listedAt: Date.now() });
    await removeButtons(ctx, item);
    // One action, so the photos arrive after the text and the card comes last.
    await ctx.scheduler.runAfter(0, internal.bot.sendWithPhotos, {
      chatId: item.chatId,
      text: `✅ Готово. Текст для OLX — скопируйте целиком:\n\n${copyText(draft)}`,
      storageIds: listingPhotos(item.studioPhotoIds ?? [], item.photoIds),
      footer: {
        text: `🛒 <b>${esc(draft.titleUk)}</b> выставлено.\nКогда продадите — нажмите «💵 Продано».`,
        keyboard: listedKeyboard(item._id),
      },
    });
    return "Выставлено";
  },
  price: async (ctx, item) => {
    await send(ctx, item.chatId, `💰 Сейчас: <b>${uah(item.draft!.priceUah)}</b>. Новая цена:`, {
      html: true,
      keyboard: priceKeyboard(item._id, item.draft!.priceUah),
    });
  },
  pr: async (ctx, item, arg) => {
    const priceUah = Number(arg);
    if (!Number.isInteger(priceUah) || priceUah <= 0 || priceUah > MAX_PRICE_UAH) {
      return "Неизвестная кнопка";
    }
    await ctx.db.patch(item._id, { draft: { ...item.draft!, priceUah }, awaiting: undefined });
    await ctx.scheduler.runAfter(0, internal.analyze.show, { itemId: item._id });
    return `Цена: ${uah(priceUah)}`;
  },
  prc: async (ctx, item) => {
    await setAwaiting(ctx, item._id, "price");
    await send(ctx, item.chatId, PRICE_PROMPT);
  },
  text: async (ctx, item) => {
    await setAwaiting(ctx, item._id, "text");
    await send(ctx, item.chatId, TEXT_PROMPT);
  },
  cancel: async (ctx, item) => {
    for (const id of item.studioPhotoIds ?? []) await deleteFile(ctx, id);
    await ctx.db.patch(item._id, {
      status: "cancelled",
      awaiting: undefined,
      studioPhotoIds: undefined,
    });
    await removeButtons(ctx, item);
    await send(ctx, item.chatId, "🗑 Черновик отменён.");
  },
  open: async (ctx, item) => {
    if (item.status === "draft") {
      // Re-sends the draft at the bottom of the chat with its buttons.
      await ctx.scheduler.runAfter(0, internal.analyze.show, { itemId: item._id });
      return;
    }
    await send(ctx, item.chatId, itemCard(item), {
      html: true,
      ...(item.status === "approved" ? { keyboard: listedKeyboard(item._id) } : {}),
    });
  },
  sold: async (ctx, item) => {
    await setAwaiting(ctx, item._id, "sold");
    await send(
      ctx,
      item.chatId,
      "💵 За сколько продали? Напишите сумму в гривнах или нажмите кнопку.",
      {
        keyboard: soldKeyboard(item._id, item.draft?.priceUah ?? 0),
      },
    );
  },
  soldat: async (ctx, item) => {
    await markSold(ctx, item, item.draft?.priceUah ?? 0);
  },
  again: async (ctx, item) => {
    await ctx.scheduler.runAfter(0, internal.bot.sendWithPhotos, {
      chatId: item.chatId,
      text: copyText(item.draft!),
      storageIds: listingPhotos(item.studioPhotoIds ?? [], item.photoIds),
    });
  },
  unlist: async (ctx, item) => {
    await ctx.db.patch(item._id, { status: "cancelled", awaiting: undefined });
    await send(
      ctx,
      item.chatId,
      `🗑 <b>${esc(item.draft?.titleUk ?? "Вещь")}</b> снята с продажи.`,
      {
        html: true,
        keyboard: relistKeyboard(item._id),
      },
    );
  },
  relist: async (ctx, item) => {
    await ctx.db.patch(item._id, {
      status: "approved",
      soldPriceUah: undefined,
      soldAt: undefined,
      awaiting: undefined,
    });
    const back = { ...item, status: "approved" as const, soldPriceUah: undefined };
    await send(
      ctx,
      item.chatId,
      `↩️ Снова в продаже

${itemCard(back)}`,
      {
        html: true,
        keyboard: listedKeyboard(item._id),
      },
    );
    return "Снова в продаже";
  },
};

async function markSold(ctx: MutationCtx, item: Doc<"items">, priceUah: number) {
  await ctx.db.patch(item._id, {
    status: "sold",
    soldPriceUah: priceUah,
    soldAt: Date.now(),
    awaiting: undefined,
  });
  // The running total is counted in its own transaction, so it can never block recording the sale.
  await ctx.scheduler.runAfter(0, internal.telegram.soldSummary, {
    chatId: item.chatId,
    itemId: item._id,
    priceUah,
  });
}

export const soldSummary = internalMutation({
  args: { chatId: v.number(), itemId: v.id("items"), priceUah: v.number() },
  returns: v.null(),
  handler: async (ctx, { chatId, itemId, priceUah }) => {
    const stats = await collectStats(ctx);
    await send(
      ctx,
      chatId,
      `🎉 Продано за <b>${uah(priceUah)}</b>!\nВсего продано: ${stats.sold} на ${uah(stats.soldSum)}.`,
      { html: true, keyboard: relistKeyboard(itemId) },
    );
    return null;
  },
});

async function removeButtons(ctx: MutationCtx, item: Doc<"items">) {
  if (item.draftMessageId !== undefined) {
    await ctx.scheduler.runAfter(0, internal.bot.removeKeyboard, {
      chatId: item.chatId,
      messageId: item.draftMessageId,
    });
  }
}

/** Only one item waits for a reply at a time: a new request replaces the old one. */
async function setAwaiting(ctx: MutationCtx, itemId: Id<"items">, awaiting: Awaiting) {
  await clearAwaiting(ctx, itemId);
  await ctx.db.patch(itemId, { awaiting });
}

function latestWithStatus(ctx: MutationCtx, status: "collecting" | "queued" | "analyzing") {
  return ctx.db
    .query("items")
    .withIndex("by_status", (q) => q.eq("status", status))
    .order("desc")
    .first();
}
