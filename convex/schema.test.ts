import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import schema from "./schema";
import type { Draft } from "./lib/validators";

const modules = import.meta.glob("./**/*.*s");

const draft: Draft = {
  titleUk: "Навушники Sony WH-1000XM4",
  descriptionUk: "Б/в, повний комплект.",
  category: "Електроніка / Навушники",
  brand: "Sony",
  model: "WH-1000XM4",
  condition: "good",
  defects: ["потертості на дузі"],
  priceUah: 4500,
  priceUsd: 110,
  priceReasoningRu: "Медиана аналогов $120, минус за потёртости.",
  comparablesCount: 14,
  marketplaces: ["olx", "ebay"],
};

const baseItem = {
  chatId: 1,
  status: "draft" as const,
  photoIds: [],
  lastPhotoAt: 0,
  answers: [],
  costUsd: 0,
};

test("an item with a draft is accepted", async () => {
  const t = convexTest(schema, modules);
  const id = await t.run((ctx) => ctx.db.insert("items", { ...baseItem, draft }));
  const item = await t.run((ctx) => ctx.db.get(id));
  expect(item?.draft?.priceUah).toBe(4500);
});

test("an unknown condition is rejected", async () => {
  const t = convexTest(schema, modules);
  await expect(
    t.run((ctx) =>
      ctx.db.insert("items", {
        ...baseItem,
        draft: { ...draft, condition: "broken" as Draft["condition"] },
      }),
    ),
  ).rejects.toThrow();
});
