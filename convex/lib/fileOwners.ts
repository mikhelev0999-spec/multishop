// Which item a stored file belongs to. Files without an owner row are orphans and get pruned.
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

export type FileKind = "photo" | "studio";

export async function ownerOf(ctx: QueryCtx, storageId: Id<"_storage">) {
  return ctx.db
    .query("storageOwners")
    .withIndex("by_storage", (q) => q.eq("storageId", storageId))
    .first();
}

export async function claimFile(
  ctx: MutationCtx,
  storageId: Id<"_storage">,
  itemId: Id<"items">,
  kind: FileKind,
): Promise<void> {
  const existing = await ownerOf(ctx, storageId);
  if (existing) {
    if (existing.itemId !== itemId || existing.kind !== kind) {
      throw new Error("Файл уже принадлежит другой вещи");
    }
    return;
  }
  await ctx.db.insert("storageOwners", { storageId, itemId, kind });
}

/** Deletes the file and its owner row. */
export async function deleteFile(ctx: MutationCtx, storageId: Id<"_storage">): Promise<void> {
  const owner = await ownerOf(ctx, storageId);
  if (owner) await ctx.db.delete(owner._id);
  await ctx.storage.delete(storageId);
}
