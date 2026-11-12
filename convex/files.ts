import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";
import { ownerOf } from "./lib/fileOwners";

/** Uploads that were never attached (closed studio, broken network) are deleted after this. */
export const ORPHAN_AGE_MS = 60 * 60 * 1000;
const BATCH = 200;

export const pruneOrphans = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const cutoff = Date.now() - ORPHAN_AGE_MS;
    // Only the last two days: older files were checked by earlier runs.
    const files = await ctx.db.system
      .query("_storage")
      .withIndex("by_creation_time", (q) =>
        q.gt("_creationTime", cutoff - 2 * 24 * 60 * 60 * 1000).lt("_creationTime", cutoff),
      )
      .take(BATCH);
    for (const file of files) {
      if (!(await ownerOf(ctx, file._id))) await ctx.storage.delete(file._id);
    }
    return null;
  },
});

/** One-off: owner rows for files stored before ownership tracking existed. */
export const backfillOwners = internalMutation({
  args: {},
  returns: v.number(),
  handler: async (ctx) => {
    let added = 0;
    const items = await ctx.db.query("items").order("desc").take(500);
    for (const item of items) {
      const files = [
        ...item.photoIds.map((id) => [id, "photo"] as const),
        ...(item.studioPhotoIds ?? []).map((id) => [id, "studio"] as const),
      ];
      for (const [storageId, kind] of files) {
        if (await ownerOf(ctx, storageId)) continue;
        await ctx.db.insert("storageOwners", { storageId, itemId: item._id, kind });
        added++;
      }
    }
    if (items.length === 500) await ctx.scheduler.runAfter(0, internal.files.backfillOwners, {});
    return added;
  },
});
