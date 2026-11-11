// The only place that talks to the Telegram Bot API. Mocked in tests.

export interface Button {
  text: string;
  callbackData: string;
}
export type Keyboard = Button[][];

function token(): string {
  const t = process.env.TELEGRAM_BOT_TOKEN;
  if (!t) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  return t;
}

async function call<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
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
    row.map((b) => ({ text: b.text, callback_data: b.callbackData })),
  ),
});

export async function sendMessage(chatId: number, text: string, keyboard?: Keyboard): Promise<number> {
  const result = await call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    ...(keyboard ? { reply_markup: markup(keyboard) } : {}),
  });
  return result.message_id;
}

/** `keyboard: []` removes the buttons; omitting it leaves them as they are. */
export async function editMessageText(
  chatId: number,
  messageId: number,
  text: string,
  keyboard?: Keyboard,
): Promise<void> {
  await call("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    ...(keyboard ? { reply_markup: markup(keyboard) } : {}),
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

export async function getFileBytes(fileId: string): Promise<{ bytes: ArrayBuffer; mimeType: string }> {
  const { file_path } = await call<{ file_path?: string }>("getFile", { file_id: fileId });
  if (!file_path) throw new Error("Telegram getFile returned no file_path");
  const res = await fetch(`https://api.telegram.org/file/bot${token()}/${file_path}`);
  if (!res.ok) throw new Error(`Telegram file download failed: HTTP ${res.status}`);
  const ext = file_path.split(".").pop()?.toLowerCase() ?? "";
  return { bytes: await res.arrayBuffer(), mimeType: MIME_BY_EXT[ext] ?? "image/jpeg" };
}

export async function setWebhook(url: string, secret: string): Promise<void> {
  await call("setWebhook", {
    url,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  });
}
