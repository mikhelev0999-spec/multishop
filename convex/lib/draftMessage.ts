import type { Keyboard } from "./telegramApi";
import type { Condition, Draft, Marketplace } from "./validators";

export const MAX_MESSAGE_LENGTH = 4096;

const CONDITION_RU: Record<Condition, string> = {
  new: "новое",
  like_new: "как новое",
  good: "хорошее",
  fair: "заметно б/у",
  for_parts: "на запчасти",
};
const MARKETPLACE_NAME: Record<Marketplace, string> = { olx: "OLX", ebay: "eBay" };

const groupThousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export function formatDraft(d: Draft, costUsd: number): string {
  const prices = d.marketplaces.includes("ebay")
    ? `💰 ${groupThousands(d.priceUah)} грн (eBay: $${d.priceUsd})`
    : `💰 ${groupThousands(d.priceUah)} грн`;
  const defects = d.defects.length ? d.defects.join(", ") : "не видно";
  const head = [
    `📦 ${d.titleUk}`,
    prices,
    `Состояние: ${CONDITION_RU[d.condition]} · Дефекты: ${defects}`,
    `Почему такая цена: ${d.priceReasoningRu} (аналогов: ${d.comparablesCount})`,
    "",
  ].join("\n");
  const marketplaces = d.marketplaces.map((m) => MARKETPLACE_NAME[m]).join(", ");
  const cost = costUsd === 0 ? "разбор вручную" : `анализ: $${costUsd.toFixed(2)}`;
  const tail = `\n\nПлощадки: ${marketplaces} · ${cost}`;
  const room = Math.max(0, MAX_MESSAGE_LENGTH - head.length - tail.length - 1);
  const body = cut(d.descriptionUk, room);
  return cut(`${head}\n${body}${tail}`, MAX_MESSAGE_LENGTH);
}

const cut = (text: string, max: number) =>
  text.length <= max ? text : max <= 0 ? "" : `${text.slice(0, max - 1)}…`;

/** Splits a long text into Telegram-sized parts, preferring line breaks. */
export function splitMessage(text: string, max = MAX_MESSAGE_LENGTH): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > max) {
    const breakAt = rest.lastIndexOf("\n", max);
    const end = breakAt > max / 2 ? breakAt : max;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end).replace(/^\n/, "");
  }
  if (rest) parts.push(rest);
  return parts;
}

export function draftKeyboard(itemId: string): Keyboard {
  return [
    [
      { text: "Выставить", callbackData: `publish:${itemId}` },
      { text: "Изменить цену", callbackData: `price:${itemId}` },
    ],
    [
      { text: "Изменить текст", callbackData: `text:${itemId}` },
      { text: "Отмена", callbackData: `cancel:${itemId}` },
    ],
  ];
}

/** Ready to paste into an OLX listing (stage 1 has no automatic publishing). */
export function copyText(d: Draft): string {
  return `${d.titleUk}\n\n${d.priceUah} грн\n\n${d.descriptionUk}\n\nКатегорія: ${d.category}`;
}
