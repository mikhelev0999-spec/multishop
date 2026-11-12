import { describe, expect, test } from "vitest";
import type { Doc, Id } from "../_generated/dataModel";
import {
  adjustPrice,
  esc,
  itemCard,
  itemsList,
  listedKeyboard,
  priceKeyboard,
  soldKeyboard,
  statsText,
} from "./botTexts";

const item = (over: Partial<Doc<"items">>): Doc<"items"> =>
  ({
    _id: "i1" as Id<"items">,
    _creationTime: 0,
    chatId: 1,
    status: "draft",
    photoIds: [],
    lastPhotoAt: 0,
    answers: [],
    costUsd: 0,
    draft: {
      titleUk: "Светр <FTC>",
      descriptionUk: "",
      category: "",
      condition: "good",
      defects: [],
      priceUah: 2200,
      priceUsd: 60,
      priceReasoningRu: "",
      comparablesCount: 0,
      marketplaces: ["olx"],
    },
    ...over,
  }) as Doc<"items">;

test("esc escapes the three HTML specials", () => {
  expect(esc("a < b & c > d")).toBe("a &lt; b &amp; c &gt; d");
});

describe("adjustPrice", () => {
  test.each([
    [2200, -10, 2000],
    [2200, 5, 2300],
    [4500, -5, 4300],
    [400, 10, 440],
    [95, -10, 86],
    [1, -10, 1],
  ])("%d %+d%% → %d", (price, pct, expected) => {
    expect(adjustPrice(price, pct)).toBe(expected);
  });
});

test("price keyboard shows the resulting prices", () => {
  expect(priceKeyboard("i1", 2200)).toEqual([
    [
      { text: "−10% → 2 000 грн", callbackData: "pr:i1:-10" },
      { text: "−5% → 2 100 грн", callbackData: "pr:i1:-5" },
    ],
    [
      { text: "+5% → 2 300 грн", callbackData: "pr:i1:5" },
      { text: "+10% → 2 400 грн", callbackData: "pr:i1:10" },
    ],
    [{ text: "✍️ Ввести свою цену", callbackData: "prc:i1" }],
  ]);
});

test("listed and sold keyboards", () => {
  expect(listedKeyboard("i1").flat().map((b) => (b as { callbackData: string }).callbackData)).toEqual([
    "sold:i1",
    "again:i1",
    "unlist:i1",
  ]);
  expect(soldKeyboard("i1", 2200)).toEqual([
    [{ text: "💵 За 2 200 грн, как в объявлении", callbackData: "soldat:i1" }],
  ]);
});

test("item card: escaped title, status, price, sale price", () => {
  expect(itemCard(item({ status: "sold", soldPriceUah: 2000 }))).toBe(
    "<b>Светр &lt;FTC&gt;</b>\n✅ продано\n💰 2 200 грн\n💵 Продано за <b>2 000 грн</b>",
  );
});

test("items list: one line and one open button per item", () => {
  const { text, keyboard } = itemsList([item({}), item({ _id: "i2" as Id<"items">, status: "approved" })]);
  expect(text).toContain("<b>📦 Мои вещи</b> (последние 2)");
  expect(text).toContain("📝 Светр &lt;FTC&gt; — 2 200 грн");
  expect(text).toContain("🛒 Светр &lt;FTC&gt; — 2 200 грн");
  expect(keyboard).toEqual([
    [{ text: "📝 Светр <FTC>", callbackData: "open:i1" }],
    [{ text: "🛒 Светр <FTC>", callbackData: "open:i2" }],
  ]);
});

test("empty items list invites to start", () => {
  expect(itemsList([]).text).toContain("Пришлите фото");
});

test("stats text", () => {
  expect(statsText({ drafts: 1, listed: 2, listedSum: 9700, sold: 3, soldSum: 12500 })).toBe(
    [
      "<b>📊 Статистика</b>",
      "",
      "✅ Продано: <b>3</b> на <b>12 500 грн</b>",
      "🛒 Выставлено: <b>2</b> на 9 700 грн",
      "📝 Черновиков: <b>1</b>",
    ].join("\n"),
  );
});
