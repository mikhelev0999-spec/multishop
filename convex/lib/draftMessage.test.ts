import { expect, test } from "vitest";
import {
  copyText,
  draftKeyboard,
  formatDraft,
  listingPhotos,
  MAX_MESSAGE_LENGTH,
  splitMessage,
} from "./draftMessage";
import type { Draft } from "./validators";

const draft: Draft = {
  titleUk: "Навушники Sony WH-1000XM4",
  descriptionUk: "Б/в, повний комплект.",
  category: "Електроніка / Навушники",
  brand: "Sony",
  condition: "good",
  defects: ["потёртости на дуге", "царапина на чашке"],
  priceUah: 4500,
  priceUsd: 110,
  priceReasoningRu: "Медиана аналогов $120.",
  comparablesCount: 14,
  marketplaces: ["olx", "ebay"],
};

/** What Telegram shows: tags removed, entities decoded. */
const visible = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

test("the draft is Telegram HTML with all the parts", () => {
  expect(formatDraft(draft, 0.1372)).toBe(
    [
      "<b>📦 Навушники Sony WH-1000XM4</b>",
      "",
      "💰 <b>4 500 грн</b> · eBay <b>$110</b>",
      "🏷 Состояние: хорошее",
      "⚠️ Дефекты: потёртости на дуге, царапина на чашке",
      "📊 <i>Медиана аналогов $120. (аналогов: 14)</i>",
      "",
      "<blockquote expandable>Б/в, повний комплект.</blockquote>",
      "",
      "🛒 OLX, eBay · 🤖 анализ $0.14",
    ].join("\n"),
  );
});

test("no defects, OLX only, manual analysis, no comparables", () => {
  const text = formatDraft({ ...draft, defects: [], marketplaces: ["olx"], comparablesCount: 0 }, 0);
  expect(text).toContain("✨ Дефектов не видно");
  expect(text).toContain("🛒 OLX · 🤝 разбор вручную");
  expect(text).not.toContain("eBay");
  expect(text).not.toContain("аналогов:");
});

test("text from the model is escaped so it can't break the markup", () => {
  const text = formatDraft(
    { ...draft, titleUk: "Кабель <USB> & зарядка", descriptionUk: "<b>жирно</b>" },
    0,
  );
  expect(text).toContain("<b>📦 Кабель &lt;USB&gt; &amp; зарядка</b>");
  expect(text).toContain("&lt;b&gt;жирно&lt;/b&gt;");
});

test("a long description is cut to fit Telegram's limit on visible text", () => {
  const text = formatDraft({ ...draft, descriptionUk: "а&".repeat(3000) }, 0);
  expect(visible(text).length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
  expect(text).toContain("…</blockquote>");
  expect(text).toContain("🛒");
});

test("long reasoning and defects still fit", () => {
  const text = formatDraft(
    { ...draft, priceReasoningRu: "п".repeat(600), defects: Array(10).fill("д".repeat(150)) },
    0,
  );
  expect(visible(text).length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
});

test("draft keyboard: publish, price and text, cancel last", () => {
  expect(draftKeyboard("abc")).toEqual([
    [{ text: "✅ Выставить", callbackData: "publish:abc" }],
    [
      { text: "💰 Цена", callbackData: "price:abc" },
      { text: "✏️ Текст", callbackData: "text:abc" },
    ],
    [{ text: "🗑 Отмена", callbackData: "cancel:abc" }],
  ]);
});

test("a non-https studio URL adds no button", () => {
  expect(draftKeyboard("abc", "http://localhost:5173")).toHaveLength(3);
});

test("with a studio URL the keyboard gets a Mini App button before cancel", () => {
  const kb = draftKeyboard("abc", "https://studio.example/");
  expect(kb).toHaveLength(4);
  expect(kb[2]).toEqual([
    { text: "🎨 Обработать фото", webAppUrl: "https://studio.example/studio?item=abc" },
  ]);
});

test("copy text is title, price and description", () => {
  expect(copyText(draft)).toBe(
    "Навушники Sony WH-1000XM4\n\n4500 грн\n\nБ/в, повний комплект.\n\nКатегорія: Електроніка / Навушники",
  );
});

test("splitMessage keeps short text whole and cuts long text at line breaks", () => {
  expect(splitMessage("short")).toEqual(["short"]);
  const long = `${"а".repeat(3000)}\n${"б".repeat(3000)}`;
  expect(splitMessage(long)).toEqual(["а".repeat(3000), "б".repeat(3000)]);
  const solid = "в".repeat(9000);
  const parts = splitMessage(solid);
  expect(parts.every((p) => p.length <= MAX_MESSAGE_LENGTH)).toBe(true);
  expect(parts.join("")).toBe(solid);
});

test("listing photos: processed first, then originals, at most 10", () => {
  expect(listingPhotos(["s1"], ["o1", "o2"])).toEqual(["s1", "o1", "o2"]);
  const many = Array.from({ length: 9 }, (_, i) => `o${i}`);
  expect(listingPhotos(["s1", "s2"], many)).toHaveLength(10);
  const studio = Array.from({ length: 10 }, (_, i) => `s${i}`);
  const result = listingPhotos(studio, many);
  expect(result.filter((x) => x.startsWith("o"))).toHaveLength(5);
});
