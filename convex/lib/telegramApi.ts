// The only place that talks to the Telegram Bot API. Mocked in tests.
import { MENU_LAYOUT } from "./menu";

/** A callback button, or a button that opens a Mini App page. */
export type Button = { text: string; callbackData: string } | { text: string; webAppUrl: string };
export type Keyboard = Button[][];

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
}

/** fetch whose network errors never carry the URL: it contains the bot token and ends up in logs. */
async function fetchQuiet(
  url: string,
  init: RequestInit | undefined,
  what: string,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    throw new Error(`Telegram ${what}: network error`);
  }
}

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetchQuiet(
    `https://api.telegram.org/bot${token()}/${method}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    method,
  );
  const json = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: T;
    description?: string;
  };
  if (!json.ok) {
    throw new Error(`Telegram ${method} failed: ${json.description ?? `HTTP ${res.status}`}`);
  }
  return json.result as T;
}

const markup = (keyboard: Keyboard) => ({
  inline_keyboard: keyboard.map((row) =>
    row.map((b) =>
      "webAppUrl" in b
        ? { text: b.text, web_app: { url: b.webAppUrl } }
        : { text: b.text, callback_data: b.callbackData },
    ),
  ),
});

export interface SendOptions {
  /** Text uses Telegram HTML markup (<b>, <i>, <blockquote>); dynamic parts must be escaped. */
  html?: boolean;
  /** Show the persistent menu under the message box (instead of inline buttons). */
  menu?: boolean;
}

const menuMarkup = () => ({
  keyboard: MENU_LAYOUT.map((row) => row.map((text) => ({ text }))),
  resize_keyboard: true,
  is_persistent: true,
});

export async function sendMessage(
  chatId: number,
  text: string,
  keyboard?: Keyboard,
  opts: SendOptions = {},
): Promise<number> {
  const replyMarkup = keyboard ? markup(keyboard) : opts.menu ? menuMarkup() : undefined;
  const result = await call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    ...(opts.html ? { parse_mode: "HTML", link_preview_options: { is_disabled: true } } : {}),
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
  });
  return result.message_id;
}

/** `keyboard: []` removes the buttons; omitting it leaves them as they are. */
export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  keyboard?: Keyboard,
  opts: Pick<SendOptions, "html"> = {},
): Promise<void> {
  await call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(opts.html ? { parse_mode: "HTML", link_preview_options: { is_disabled: true } } : {}),
    ...(keyboard ? { reply_markup: markup(keyboard) } : {}),
  });
}

/** "typing…" under the bot's name for ~5 seconds. */
export async function sendChatAction(
  chatId: number,
  action: "typing" | "upload_photo",
): Promise<void> {
  await call("sendChatAction", { chat_id: chatId, action });
}

export async function setMyCommands(
  commands: { command: string; description: string }[],
): Promise<void> {
  await call("setMyCommands", { commands });
}

/** Removes the inline buttons and keeps the text. */
export async function removeKeyboard(chatId: number, messageId: number): Promise<void> {
  await call("editMessageReplyMarkup", {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: { inline_keyboard: [] },
  });
}

export async function answerCallbackQuery(callbackId: string, text?: string): Promise<void> {
  await call("answerCallbackQuery", { callback_query_id: callbackId, ...(text ? { text } : {}) });
}

const MIME_BY_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
};

export async function getFileBytes(
  fileId: string,
): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const { file_path } = await call<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file_path) throw new Error("Telegram getFile returned no file_path");
  const res = await fetchQuiet(
    `https://api.telegram.org/file/bot${token()}/${file_path}`,
    undefined,
    "file download",
  );
  if (!res.ok) throw new Error(`Telegram file download failed: HTTP ${res.status}`);
  const ext = file_path.split(".").pop()?.toLowerCase() ?? "";
  return { bytes: await res.arrayBuffer(), mimeType: MIME_BY_EXT[ext] ?? "image/jpeg" };
}

/** Sends up to 10 photos (public URLs) as one album. */
export async function sendMediaGroup(chatId: number, photoUrls: string[]): Promise<void> {
  const media = photoUrls.slice(0, 10).map((url) => ({ type: "photo", media: url }));
  if (media.length === 0) return;
  if (media.length === 1) {
    await call("sendPhoto", { chat_id: chatId, photo: media[0].media });
    return;
  }
  await call("sendMediaGroup", { chat_id: chatId, media });
}

export async function setWebhook(url: string, secret: string): Promise<void> {
  await call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  });
}
