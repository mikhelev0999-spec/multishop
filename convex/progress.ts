// The bot's "⏳ Разбираю фото…" message: a separate message updated every few seconds with a bar
// and the time left, until the draft or a question arrives (they come as new messages below,
// so an update can never overwrite them).
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { isManualMode } from "./lib/mode";
import { estimateMs, progressText } from "./lib/progress";
import * as telegram from "./lib/telegramApi";

export const TICK_MS = 8_000;
/** Stop updating after this long; the watchdog or the owner takes over. */
const MAX_UPDATE_MS = 10 * 60 * 1000;
/** Without history: Claude in the chat needs the queue check plus a look at the photos. */
const FALLBACK_MS = { manual: 90_000, auto: 60_000 };
const HISTORY = 30;

export const MANUAL_HINT = "Если долго нет — напишите Claude в чат «разбери».";

export function waitingText(
  photos: number,
  elapsedMs: number,
  etaMs: number,
  manual: boolean,
): string {
  const text = progressText({ photos, elapsedMs, etaMs });
  return manual ? `${text}\n\n${MANUAL_HINT}` : text;
}

/** Expected wait, from how long the last analyses took. */
export const eta = internalQuery({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    const recent = await ctx.db.query("items").order("desc").take(HISTORY);
    const durations = recent.flatMap((it) =>
      it.waitStartedAt !== undefined && it.readyAt !== undefined
        ? [it.readyAt - it.waitStartedAt]
        : [],
    );
    return estimateMs(durations, isManualMode() ? FALLBACK_MS.manual : FALLBACK_MS.auto);
  },
});

export const startWaiting = internalMutation({
  args: { itemId: v.id("items"), messageId: v.number(), startedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { itemId, messageId, startedAt }) => {
    await ctx.db.patch(itemId, { progressMessageId: messageId, waitStartedAt: startedAt });
    await ctx.scheduler.runAfter(TICK_MS, internal.progress.tick, { itemId, startedAt });
    return null;
  },
});

export const state = internalQuery({
  args: { itemId: v.id("items") },
  returns: v.union(
    v.null(),
    v.object({
      status: v.string(),
      chatId: v.number(),
      photos: v.number(),
      progressMessageId: v.optional(v.number()),
      waitStartedAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx, { itemId }) => {
    const it = await ctx.db.get(itemId);
    if (!it) return null;
    return {
      status: it.status,
      chatId: it.chatId,
      photos: it.photoIds.length,
      ...(it.progressMessageId !== undefined ? { progressMessageId: it.progressMessageId } : {}),
      ...(it.waitStartedAt !== undefined ? { waitStartedAt: it.waitStartedAt } : {}),
    };
  },
});

export const tick = internalAction({
  args: { itemId: v.id("items"), startedAt: v.number() },
  returns: v.null(),
  handler: async (ctx, { itemId, startedAt }) => {
    const st = await ctx.runQuery(internal.progress.state, { itemId });
    // A newer wait (e.g. after the owner answered a question) has its own ticks.
    if (!st || st.progressMessageId === undefined || st.waitStartedAt !== startedAt) return null;
    const edit = (text: string) =>
      // "message is not modified" and the like are harmless here.
      telegram.editMessageText(st.chatId, st.progressMessageId!, text).catch(() => {});

    if (st.status === "queued" || st.status === "analyzing") {
      const elapsed = Date.now() - startedAt;
      const etaMs = await ctx.runQuery(internal.progress.eta, {});
      await edit(waitingText(st.photos, elapsed, etaMs, st.status === "queued"));
      if (elapsed < MAX_UPDATE_MS) {
        await ctx.scheduler.runAfter(TICK_MS, internal.progress.tick, { itemId, startedAt });
      }
    } else if (st.status === "draft") {
      await edit("✅ Черновик готов 👇");
    } else if (st.status === "needs_input") {
      await edit("❓ Нужен ваш ответ 👇");
    }
    // failed / cancelled: the message already says what happened, leave it.
    return null;
  },
});
