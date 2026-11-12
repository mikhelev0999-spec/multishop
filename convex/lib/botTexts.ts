// Owner-facing bot texts (Telegram HTML) and inline keyboards. Pure, so everything is testable.
import type { Doc } from "../_generated/dataModel";
import type { Keyboard } from "./telegramApi";
import type { ItemStatus } from "./validators";

export const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export const groupThousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
export const uah = (n: number) => `${groupThousands(n)} грн`;

export const STATUS_LABEL: Record<ItemStatus, string> = {
  collecting: "⏳ принимаю фото",
  queued: "⏳ ждёт разбора",
  analyzing: "⏳ разбираю",
  needs_input: "❓ ждёт вашего ответа",
  draft: "📝 черновик",
  approved: "🛒 выставлено",
  sold: "✅ продано",
  cancelled: "🗑 отменено",
  failed: "⚠️ ошибка",
};

export const START_TEXT = [
  "<b>👋 Привет! Я помогаю продавать вещи.</b>",
  "",
  "<b>Как это работает:</b>",
  "1️⃣ Пришлите фото вещи — до 10 штук, можно альбомом.",
  "2️⃣ Я распознаю вещь, подберу цену и напишу объявление.",
  "3️⃣ Вы проверяете черновик, при желании обрабатываете фото, и жмёте «✅ Выставить».",
  "",
  "Подписью к фото можно подсказать: <i>«не работает кнопка», «торг», «размер M»</i>.",
  "Ничего не публикуется без вашего «Выставить».",
  "",
  "Кнопки меню — внизу 👇",
].join("\n");

export const NEW_ITEM_TEXT =
  "📸 Пришлите фото вещи — до 10 штук, можно альбомом. Подписью можно добавить подсказку.";

/** −10% … +10% from the current price, rounded to a tidy number. */
export function adjustPrice(price: number, percent: number): number {
  const raw = price * (1 + percent / 100);
  const step = raw >= 1000 ? 50 : raw >= 100 ? 10 : 1;
  return Math.max(step, Math.round(raw / step) * step);
}

export const PRICE_STEPS = [-10, -5, 5, 10] as const;

export function priceKeyboard(itemId: string, price: number): Keyboard {
  const button = (p: number) => ({
    text: `${p > 0 ? "+" : "−"}${Math.abs(p)}% → ${uah(adjustPrice(price, p))}`,
    callbackData: `pr:${itemId}:${p}`,
  });
  return [
    [button(-10), button(-5)],
    [button(5), button(10)],
    [{ text: "✍️ Ввести свою цену", callbackData: `prc:${itemId}` }],
  ];
}

export function listedKeyboard(itemId: string): Keyboard {
  return [
    [{ text: "💵 Продано", callbackData: `sold:${itemId}` }],
    [
      { text: "📋 Текст ещё раз", callbackData: `again:${itemId}` },
      { text: "🗑 Снять с продажи", callbackData: `unlist:${itemId}` },
    ],
  ];
}

export function soldKeyboard(itemId: string, price: number): Keyboard {
  return [[{ text: `💵 За ${uah(price)}, как в объявлении`, callbackData: `soldat:${itemId}` }]];
}

/** A short card for "Мои вещи" → open. */
export function itemCard(item: Doc<"items">): string {
  const title = item.draft?.titleUk ?? "Вещь без названия";
  const lines = [`<b>${esc(title)}</b>`, STATUS_LABEL[item.status]];
  if (item.draft) lines.push(`💰 ${uah(item.draft.priceUah)}`);
  if (item.status === "sold" && item.soldPriceUah !== undefined) {
    lines.push(`💵 Продано за <b>${uah(item.soldPriceUah)}</b>`);
  }
  if (item.status === "needs_input" && item.question) lines.push(`❓ ${esc(item.question)}`);
  return lines.join("\n");
}

export const MAX_LISTED_ITEMS = 10;

export function itemsList(items: Doc<"items">[]): { text: string; keyboard: Keyboard } {
  if (items.length === 0) {
    return { text: "📦 Пока нет ни одной вещи. Пришлите фото — начнём!", keyboard: [] };
  }
  const lines = items.map((it) => {
    const title = it.draft?.titleUk ?? "Без названия";
    const price = it.draft
      ? ` — ${uah(it.status === "sold" && it.soldPriceUah !== undefined ? it.soldPriceUah : it.draft.priceUah)}`
      : "";
    return `${STATUS_LABEL[it.status].split(" ")[0]} ${esc(short(title, 40))}${price}`;
  });
  return {
    text: [`<b>📦 Мои вещи</b> (последние ${items.length})`, "", ...lines].join("\n"),
    keyboard: items.map((it) => [
      {
        text: `${STATUS_LABEL[it.status].split(" ")[0]} ${short(it.draft?.titleUk ?? "Без названия", 30)}`,
        callbackData: `open:${it._id}`,
      },
    ]),
  };
}

export interface Stats {
  drafts: number;
  listed: number;
  listedSum: number;
  sold: number;
  soldSum: number;
}

export function statsText(s: Stats): string {
  return [
    "<b>📊 Статистика</b>",
    "",
    `✅ Продано: <b>${s.sold}</b> на <b>${uah(s.soldSum)}</b>`,
    `🛒 Выставлено: <b>${s.listed}</b> на ${uah(s.listedSum)}`,
    `📝 Черновиков: <b>${s.drafts}</b>`,
  ].join("\n");
}

const short = (s: string, max: number) => (s.length <= max ? s : `${s.slice(0, max - 1)}…`);
