// Manual mode: Claude in the owner's chat session does the analysis instead of the API.
//   npx convex run manual:queue
//   npx convex run manual:submitDraft '{"itemId": "...", "draft": { ...submit_draft fields... }}'
//   npx convex run manual:ask '{"itemId": "...", "question": "..."}'
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalAction, internalMutation, internalQuery, type ActionCtx } from "./_generated/server";
import { MAX_QUESTION_LENGTH, parseDraft } from "./lib/agent";
import { showDraft } from "./lib/showDraft";
import * as telegram from "./lib/telegramApi";
import { answerValidator, draftValidator } from "./lib/validators";

const QUEUED_TEXT = (n: number) =>
  `📥 Фото получены (${n}). Черновик придёт через пару минут. Если не пришёл — напишите Claude в чат «разбери».`;

export const markQueued = internalMutation({
  args: { itemId: v.id("items"), photoAt: v.number() },
  returns: v.union(v.null(), v.object({ chatId: v.number(), photos: v.number() })),
  handler: async (ctx, { itemId, photoAt }) => {
    const item = await ctx.db.get(itemId);
    if (!item || item.lastPhotoAt !== photoAt) return null;
    if (item.status !== "collecting" && item.status !== "needs_input") return null;
    await ctx.db.patch(itemId, { status: "queued", question: undefined, error: undefined });
    return { chatId: item.chatId, photos: item.photoIds.length };
  },
});

/** Called by analyze.start instead of the Claude API when there is no key. */
export async function enqueueForChat(ctx: ActionCtx, itemId: Id<"items">, photoAt: number) {
  const job = await ctx.runMutation(internal.manual.markQueued, { itemId, photoAt });
  if (!job) return;
  const messageId = await telegram.sendMessage(job.chatId, QUEUED_TEXT(job.photos));
  await ctx.runMutation(internal.items.setStatusMessage, { itemId, messageId });
}

export const queue = internalQuery({
  args: {},
  returns: v.object({
    analyze: v.array(
      v.object({
        itemId: v.id("items"),
        caption: v.optional(v.string()),
        answers: v.array(answerValidator),
        photoUrls: v.array(v.string()),
      }),
    ),
    rewrite: v.array(v.object({ itemId: v.id("items"), instruction: v.string(), draft: draftValidator })),
  }),
  handler: async (ctx) => {
    const queued = await ctx.db
      .query("items")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .take(20);
    const analyze = [];
    for (const item of queued) {
      const urls = await Promise.all(item.photoIds.map((id) => ctx.storage.getUrl(id)));
      analyze.push({
        itemId: item._id,
        ...(item.caption ? { caption: item.caption } : {}),
        answers: item.answers,
        photoUrls: urls.filter((u): u is string => u !== null),
      });
    }
    const rewriteItems = await ctx.db
      .query("items")
      .withIndex("by_rewrite_request", (q) => q.gt("rewriteRequest", ""))
      .take(20);
    const rewrite = rewriteItems
      .filter((i) => i.status === "draft" && i.draft && i.rewriteRequest)
      .map((i) => ({ itemId: i._id, instruction: i.rewriteRequest!, draft: i.draft! }));
    return { analyze, rewrite };
  },
});

/** `draft` uses the submit_draft tool fields (title_uk, description_uk, …). */
export const submitDraft = internalAction({
  args: { itemId: v.id("items"), draft: v.any() },
  returns: v.string(),
  handler: async (ctx, { itemId, draft: raw }): Promise<string> => {
    const parsed = parseDraft(raw);
    if (!parsed.ok) return parsed.error;
    const item: Doc<"items"> | null = await ctx.runQuery(internal.items.get, { itemId });
    if (!item) return "no such item";

    if (item.status === "queued") {
      await ctx.runMutation(internal.items.saveDraft, {
        itemId,
        draft: parsed.draft,
        comparables: [],
        costUsd: 0,
      });
    } else if (item.status === "draft" && item.rewriteRequest) {
      await ctx.runMutation(internal.items.updateDraftText, { itemId, draft: parsed.draft, costUsd: 0 });
    } else {
      return `item is ${item.status}, nothing to submit`;
    }
    await showDraft(ctx, itemId);
    return "ok";
  },
});

export const ask = internalAction({
  args: { itemId: v.id("items"), question: v.string() },
  returns: v.string(),
  handler: async (ctx, { itemId, question }): Promise<string> => {
    const q = question.trim();
    if (!q || q.length > MAX_QUESTION_LENGTH) return `question must be 1–${MAX_QUESTION_LENGTH} characters`;
    const item: Doc<"items"> | null = await ctx.runQuery(internal.items.get, { itemId });
    if (!item || item.status !== "queued") return "item is not queued";
    await ctx.runMutation(internal.items.saveQuestion, { itemId, question: q, costUsd: 0 });
    const text = `❓ ${q}`;
    if (item.statusMessageId !== undefined) {
      await telegram.editMessageText(item.chatId, item.statusMessageId, text);
    } else {
      await telegram.sendMessage(item.chatId, text);
    }
    return "ok";
  },
});
