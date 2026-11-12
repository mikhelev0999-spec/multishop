import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

/** Drops any pending "write the new price / what to change" request. */
export async function clearAwaiting(ctx: MutationCtx, except?: Id<"items">): Promise<void> {
  for (const kind of ["price", "text", "sold"] as const) {
    const waiting = await ctx.db
      .query("items")
      .withIndex("by_awaiting", (q) => q.eq("awaiting", kind))
      .take(10);
    for (const item of waiting) {
      if (item._id !== except) await ctx.db.patch(item._id, { awaiting: undefined });
    }
  }
}

/** A new item supersedes unanswered questions about older ones. */
export async function cancelOpenQuestions(ctx: MutationCtx): Promise<void> {
  const open = await ctx.db
    .query("items")
    .withIndex("by_status", (q) => q.eq("status", "needs_input"))
    .take(10);
  for (const item of open) await ctx.db.patch(item._id, { status: "cancelled", question: undefined });
}
