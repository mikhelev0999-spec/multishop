import { esc, short, uah } from "./botTexts";
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

/** Telegram counts the 4096-character limit on the text after markup is parsed. */
const visibleLength = (html: string) =>
  html.replace(/<[^>]+>/g, "").replace(/&(amp|lt|gt);/g, "x").length;

/** The draft as Telegram HTML: title, prices, condition, reasoning, description in a quote. */
export function formatDraft(d: Draft, costUsd: number): string {
  const ebay = d.marketplaces.includes("ebay") ? ` · eBay <b>$${d.priceUsd}</b>` : "";
  const reasoning =
    d.comparablesCount > 0
      ? `${esc(d.priceReasoningRu)} (аналогов: ${d.comparablesCount})`
      : esc(d.priceReasoningRu);
  const head = [
    `<b>📦 ${esc(d.titleUk)}</b>`,
    "",
    `💰 <b>${uah(d.priceUah)}</b>${ebay}`,
    `🏷 Состояние: ${CONDITION_RU[d.condition]}`,
    d.defects.length ? `⚠️ Дефекты: ${esc(d.defects.join(", "))}` : "✨ Дефектов не видно",
    `📊 <i>${reasoning}</i>`,
    "",
  ].join("\n");
  const marketplaces = d.marketplaces.map((m) => MARKETPLACE_NAME[m]).join(", ");
  const cost = costUsd === 0 ? "🤝 разбор вручную" : `🤖 анализ $${costUsd.toFixed(2)}`;
  const tail = `\n\n🛒 ${marketplaces} · ${cost}`;
  const room = Math.max(0, MAX_MESSAGE_LENGTH - visibleLength(head) - visibleLength(tail) - 1);
  const body = `<blockquote expandable>${esc(cut(d.descriptionUk, room))}</blockquote>`;
  return `${head}\n${body}${tail}`;
}

const cut = (text: string, max: number) =>
  text.length <= max ? text : max <= 0 ? "" : short(text, max);

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

export function draftKeyboard(itemId: string, studioUrl?: string): Keyboard {
  // Telegram rejects the whole message if a web_app URL is not https.
  const studio: Keyboard = studioUrl?.startsWith("https://")
    ? [
        [
          {
            text: "🎨 Обработать фото",
            webAppUrl: `${studioUrl.replace(/\/+$/, "")}/studio?item=${itemId}`,
          },
        ],
      ]
    : [];
  return [
    [{ text: "✅ Выставить", callbackData: `publish:${itemId}` }],
    [
      { text: "💰 Цена", callbackData: `price:${itemId}` },
      { text: "✏️ Текст", callbackData: `text:${itemId}` },
    ],
    ...studio,
    [{ text: "🗑 Отмена", callbackData: `cancel:${itemId}` }],
  ];
}

export const MAX_LISTING_PHOTOS = 10;

/**
 * Listing order: processed photos first, then the originals; OLX and Telegram albums take 10.
 * Up to 5 originals always keep their place, so buyers see the real condition.
 */
export function listingPhotos<T>(studio: T[], originals: T[]): T[] {
  const studioRoom = MAX_LISTING_PHOTOS - Math.min(originals.length, 5);
  const chosen = studio.slice(0, studioRoom);
  return [...chosen, ...originals].slice(0, MAX_LISTING_PHOTOS);
}

/** Ready to paste into an OLX listing (stage 1 has no automatic publishing). */
export function copyText(d: Draft): string {
  return `${d.titleUk}\n\n${d.priceUah} грн\n\n${d.descriptionUk}\n\nКатегорія: ${d.category}`;
}
