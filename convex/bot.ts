// Outgoing Telegram messages, scheduled from mutations (mutations can't call the network).
import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import * as telegram from "./lib/telegramApi";

const keyboardValidator = v.array(v.array(v.object({ text: v.string(), callbackData: v.string() })));

export const send = internalAction({
  args: { chatId: v.number(), text: v.string(), keyboard: v.optional(keyboardValidator) },
  returns: v.null(),
  handler: async (_ctx, { chatId, text, keyboard }) => {
    await telegram.sendMessage(chatId, text, keyboard);
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

export const answer = internalAction({
  args: { callbackId: v.string(), text: v.optional(v.string()) },
  returns: v.null(),
  handler: async (_ctx, { callbackId, text }) => {
    await telegram.answerCallbackQuery(callbackId, text);
    return null;
  },
});
