// Outgoing Telegram messages, scheduled from mutations (mutations can't call the network).
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { internalAction, type ActionCtx } from "./_generated/server";
import { splitMessage } from "./lib/draftMessage";
import * as telegram from "./lib/telegramApi";

const buttonValidator = v.union(
  v.object({ text: v.string(), callbackData: v.string() }),
  v.object({ text: v.string(), webAppUrl: v.string() }),
);
const keyboardValidator = v.array(v.array(buttonValidator));

export const send = internalAction({
  args: { chatId: v.number(), text: v.string(), keyboard: v.optional(keyboardValidator) },
  returns: v.null(),
  handler: async (_ctx, { chatId, text, keyboard }) => {
    const parts = splitMessage(text);
    for (const [i, part] of parts.entries()) {
      await telegram.sendMessage(chatId, part, i === parts.length - 1 ? keyboard : undefined);
    }
    return null;
  },
});

export const edit = internalAction({
  args: {
    chatId: v.number(),
    messageId: v.number(),
    text: v.string(),
    keyboard: v.optional(keyboardValidator),
  },
  returns: v.null(),
  handler: async (_ctx, { chatId, messageId, text, keyboard }) => {
    await telegram.editMessageText(chatId, messageId, text, keyboard);
    return null;
  },
});

export const removeKeyboard = internalAction({
  args: { chatId: v.number(), messageId: v.number() },
  returns: v.null(),
  handler: async (_ctx, { chatId, messageId }) => {
    await telegram.removeKeyboard(chatId, messageId);
    return null;
  },
});

export const sendPhotos = internalAction({
  args: { chatId: v.number(), storageIds: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { chatId, storageIds }) => {
    await sendAlbum(ctx, chatId, storageIds);
    return null;
  },
});

/** An album fails as a whole if Telegram can't fetch one photo; tell the owner instead of failing silently. */
async function sendAlbum(ctx: ActionCtx, chatId: number, storageIds: Id<"_storage">[]): Promise<void> {
  const urls = await Promise.all(storageIds.map((id) => ctx.storage.getUrl(id)));
  try {
    await telegram.sendMediaGroup(
      chatId,
      urls.filter((u): u is string => u !== null),
    );
  } catch (e) {
    console.error("album failed", e);
    await telegram.sendMessage(
      chatId,
      `Не удалось отправить фото: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

export const sendWithPhotos = internalAction({
  args: { chatId: v.number(), text: v.string(), storageIds: v.array(v.id("_storage")) },
  returns: v.null(),
  handler: async (ctx, { chatId, text, storageIds }) => {
    for (const part of splitMessage(text)) await telegram.sendMessage(chatId, part);
    await sendAlbum(ctx, chatId, storageIds);
    return null;
  },
});

export const answer = internalAction({
  args: { callbackId: v.string(), text: v.optional(v.string()) },
  returns: v.null(),
  handler: async (_ctx, { callbackId, text }) => {
    await telegram.answerCallbackQuery(callbackId, text);
    return null;
  },
});
