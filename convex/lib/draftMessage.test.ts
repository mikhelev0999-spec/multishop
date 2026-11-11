import { expect, test } from "vitest";
import { copyText, draftKeyboard, formatDraft, MAX_MESSAGE_LENGTH } from "./draftMessage";
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
