import { v, type Infer } from "convex/values";

export const itemStatusValidator = v.union(
  v.literal("collecting"),
  v.literal("analyzing"),
  v.literal("needs_input"),
  v.literal("draft"),
  /** Listed for sale (the owner pressed «Выставить»). */
  v.literal("approved"),
  v.literal("sold"),
  v.literal("cancelled"),
  v.literal("failed"),
  /** Manual mode: waits for Claude in the chat to analyse it. */
  v.literal("queued"),
);
export type ItemStatus = Infer<typeof itemStatusValidator>;

export const CONDITIONS = ["new", "like_new", "good", "fair", "for_parts"] as const;
export const conditionValidator = v.union(
  v.literal("new"),
  v.literal("like_new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("for_parts"),
);
export type Condition = Infer<typeof conditionValidator>;

export const MARKETPLACES = ["olx", "ebay"] as const;
export const marketplaceValidator = v.union(v.literal("olx"), v.literal("ebay"));
export type Marketplace = Infer<typeof marketplaceValidator>;

/** OLX caps listing titles at 70 characters. */
export const MAX_TITLE_LENGTH = 70;

export const draftValidator = v.object({
  titleUk: v.string(),
  descriptionUk: v.string(),
  category: v.string(),
  brand: v.optional(v.string()),
  model: v.optional(v.string()),
  condition: conditionValidator,
  defects: v.array(v.string()),
  priceUah: v.number(),
  priceUsd: v.number(),
  priceReasoningRu: v.string(),
  comparablesCount: v.number(),
  marketplaces: v.array(marketplaceValidator),
});
export type Draft = Infer<typeof draftValidator>;

export const answerValidator = v.object({ question: v.string(), answer: v.string() });
export type Answer = Infer<typeof answerValidator>;

export const awaitingValidator = v.union(v.literal("price"), v.literal("text"), v.literal("sold"));

export const comparableValidator = v.object({
  title: v.string(),
  priceUsd: v.number(),
  url: v.string(),
  condition: v.optional(v.string()),
});
export type Comparable = Infer<typeof comparableValidator>;

export const providerValidator = v.union(v.literal("olx"), v.literal("ebay"));
export const tokensValidator = v.object({
  accessToken: v.string(),
  refreshToken: v.optional(v.string()),
  accessExpiresAt: v.number(),
  refreshExpiresAt: v.optional(v.number()),
});
