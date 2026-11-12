// The studio page served from Convex itself (https://<deployment>.convex.site/studio).
// Published with scripts/publish-studio.sh: build, upload each file, register its path.
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

export const uploadUrl = internalMutation({
  args: {},
  returns: v.string(),
  handler: (ctx) => ctx.storage.generateUploadUrl(),
});

export const register = internalMutation({
  args: { path: v.string(), storageId: v.id("_storage"), contentType: v.string() },
  returns: v.null(),
  handler: async (ctx, { path, storageId, contentType }) => {
    const old = await ctx.db
      .query("staticFiles")
      .withIndex("by_path", (q) => q.eq("path", path))
      .first();
    if (old) {
      await ctx.db.delete(old._id);
      if (old.storageId !== storageId) await ctx.storage.delete(old.storageId);
    }
    await ctx.db.insert("staticFiles", { path, storageId, contentType });
    return null;
  },
});

export const byPath = internalQuery({
  args: { path: v.string() },
  returns: v.union(v.null(), v.object({ storageId: v.id("_storage"), contentType: v.string() })),
  handler: async (ctx, { path }) => {
    const file = await ctx.db
      .query("staticFiles")
      .withIndex("by_path", (q) => q.eq("path", path))
      .first();
    return file ? { storageId: file.storageId, contentType: file.contentType } : null;
  },
});
