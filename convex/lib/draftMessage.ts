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
  const tail = `\n\nПлощадки: ${marketplaces} · анализ: $${costUsd.toFixed(2)}`;
  const room = MAX_MESSAGE_LENGTH - head.length - tail.length - 1;
  const body =
    d.descriptionUk.length > room ? `${d.descriptionUk.slice(0, room - 1)}…` : d.descriptionUk;
  return `${head}\n${body}${tail}`;
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
