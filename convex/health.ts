import { v } from "convex/values";
import { query } from "./_generated/server";

export const ping = query({
  args: {},
  returns: v.object({ ok: v.literal(true), name: v.string() }),
  handler: async () => ({ ok: true as const, name: "multishop" }),
});
