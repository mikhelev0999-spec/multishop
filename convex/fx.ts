import { v } from "convex/values";
import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  type ActionCtx,
} from "./_generated/server";
import { fetchUsdUah, kyivDate } from "./lib/nbu";

export const cachedRate = internalQuery({
  args: { date: v.string() },
  returns: v.object({
    today: v.union(v.number(), v.null()),
    latest: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, { date }) => {
    const today = await ctx.db
      .query("fxRates")
      .withIndex("by_date", (q) => q.eq("date", date))
      .unique();
    const latest = await ctx.db.query("fxRates").withIndex("by_date").order("desc").first();
    return { today: today?.usdUah ?? null, latest: latest?.usdUah ?? null };
  },
});

export const saveRate = internalMutation({
  args: { date: v.string(), usdUah: v.number() },
  returns: v.null(),
  handler: async (ctx, { date, usdUah }) => {
    const existing = await ctx.db
      .query("fxRates")
      .withIndex("by_date", (q) => q.eq("date", date))
      .unique();
    if (!existing) await ctx.db.insert("fxRates", { date, usdUah });
    return null;
  },
});

/** Today's USD→UAH rate, fetched from NBU at most once per Kyiv day. */
export async function getUsdUah(ctx: ActionCtx): Promise<number> {
  const date = kyivDate(Date.now());
  const cached = await ctx.runQuery(internal.fx.cachedRate, { date });
  if (cached.today !== null) return cached.today;
  try {
    const rate = await fetchUsdUah();
    await ctx.runMutation(internal.fx.saveRate, { date, usdUah: rate });
    return rate;
  } catch (error) {
    if (cached.latest !== null) return cached.latest;
    throw error;
  }
}

export const usdUah = internalAction({
  args: {},
  returns: v.number(),
  handler: (ctx): Promise<number> => getUsdUah(ctx),
});
