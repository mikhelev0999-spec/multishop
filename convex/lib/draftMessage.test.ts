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

test("draft message shows title, prices, condition, defects, reasoning, marketplaces and cost", () => {
  expect(formatDraft(draft, 0.1372)).toBe(
    [
      "📦 Навушники Sony WH-1000XM4",
      "💰 4 500 грн (eBay: $110)",
      "Состояние: хорошее · Дефекты: потёртости на дуге, царапина на чашке",
      "Почему такая цена: Медиана аналогов $120. (аналогов: 14)",
      "",
      "Б/в, повний комплект.",
      "",
      "Площадки: OLX, eBay · анализ: $0.14",
    ].join("\n"),
  );
});

test("no defects and OLX only", () => {
  const text = formatDraft({ ...draft, defects: [], marketplaces: ["olx"] }, 0);
  expect(text).toContain("Дефекты: не видно");
  expect(text).toContain("Площадки: OLX ·");
  expect(text).not.toContain("eBay: $");
});

test("a long description is cut to fit Telegram's limit", () => {
  const text = formatDraft({ ...draft, descriptionUk: "а".repeat(5000) }, 0);
  expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
  expect(text).toContain("…");
  expect(text).toContain("Площадки:");
});

test("keyboard carries the item id in every button", () => {
  expect(draftKeyboard("abc")).toEqual([
    [
      { text: "Выставить", callbackData: "publish:abc" },
      { text: "Изменить цену", callbackData: "price:abc" },
    ],
    [
      { text: "Изменить текст", callbackData: "text:abc" },
      { text: "Отмена", callbackData: "cancel:abc" },
    ],
  ]);
});

test("copy text is title, price and description", () => {
  expect(copyText(draft)).toBe(
    "Навушники Sony WH-1000XM4\n\n4500 грн\n\nБ/в, повний комплект.\n\nКатегорія: Електроніка / Навушники",
  );
});

test("long reasoning and defects still fit", () => {
  const text = formatDraft(
    { ...draft, priceReasoningRu: "п".repeat(3000), defects: Array(10).fill("д".repeat(150)) },
    0,
  );
  expect(text.length).toBeLessThanOrEqual(MAX_MESSAGE_LENGTH);
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

test("with a studio URL the keyboard gets a Mini App button", () => {
  const kb = draftKeyboard("abc", "https://studio.example/");
  expect(kb).toHaveLength(3);
  expect(kb[2]).toEqual([{ text: "🎨 Обработать фото", webAppUrl: "https://studio.example/studio?item=abc" }]);
});

test("listing photos: processed first, then originals, at most 10", () => {
  expect(listingPhotos(["s1"], ["o1", "o2"])).toEqual(["s1", "o1", "o2"]);
  const many = Array.from({ length: 9 }, (_, i) => `o${i}`);
  expect(listingPhotos(["s1", "s2"], many)).toHaveLength(10);
  expect(listingPhotos(["s1", "s2"], many).slice(0, 2)).toEqual(["s1", "s2"]);
});
