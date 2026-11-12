import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import {
  answerValidator,
  awaitingValidator,
  draftValidator,
  itemStatusValidator,
} from "./lib/validators";

export default defineSchema({
  items: defineTable({
    chatId: v.number(),
    status: itemStatusValidator,
    photoIds: v.array(v.id("_storage")),
    /** Processed in the photo studio (background removed); shown before the originals. */
    studioPhotoIds: v.optional(v.array(v.id("_storage"))),
    mediaGroupId: v.optional(v.string()),
    caption: v.optional(v.string()),
    lastPhotoAt: v.number(),
    answers: v.array(answerValidator),
    question: v.optional(v.string()),
    awaiting: v.optional(awaitingValidator),
    draft: v.optional(draftValidator),
    draftMessageId: v.optional(v.number()),
    statusMessageId: v.optional(v.number()),
    photoLimitNotified: v.optional(v.boolean()),
    analysisRun: v.optional(v.number()),
    /** Manual mode: the owner's "what to change" waiting for Claude in the chat. */
    rewriteRequest: v.optional(v.string()),
    costUsd: v.number(),
    error: v.optional(v.string()),
  })
    .index("by_media_group", ["mediaGroupId"])
    .index("by_status", ["status"])
    .index("by_awaiting", ["awaiting"])
    .index("by_rewrite_request", ["rewriteRequest"]),
  priceResearch: defineTable({
    itemId: v.id("items"),
    source: v.literal("ebay"),
    title: v.string(),
    priceUsd: v.number(),
    url: v.string(),
    condition: v.optional(v.string()),
  }).index("by_item", ["itemId"]),
  storageOwners: defineTable({
    storageId: v.id("_storage"),
    itemId: v.id("items"),
    kind: v.union(v.literal("photo"), v.literal("studio")),
  }).index("by_storage", ["storageId"]),
  telegramUpdates: defineTable({ updateId: v.number() }).index("by_update_id", ["updateId"]),
  fxRates: defineTable({ date: v.string(), usdUah: v.number() }).index("by_date", ["date"]),
});
