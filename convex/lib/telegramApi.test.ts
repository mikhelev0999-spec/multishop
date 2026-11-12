import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  answerCallbackQuery,
  editMessageText,
  getFileBytes,
  removeKeyboard,
  sendChatAction,
  sendMediaGroup,
  setMyCommands,
  sendMessage,
  setWebhook,
} from "./telegramApi";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("TELEGRAM_BOT_TOKEN", "TOKEN");
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const ok = (result: unknown) =>
  new Response(JSON.stringify({ ok: true, result }), {
    headers: { "content-type": "application/json" },
  });

function lastCall() {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: String(url), body: JSON.parse(String((init as RequestInit).body)) };
}

test("sendMessage posts text and keyboard and returns the message id", async () => {
  fetchMock.mockResolvedValueOnce(ok({ message_id: 7 }));
  const id = await sendMessage(1, "hi", [[{ text: "Да", callbackData: "publish:x" }]]);
  expect(id).toBe(7);
  const { url, body } = lastCall();
  expect(url).toBe("https://api.telegram.org/botTOKEN/sendMessage");
  expect(body).toEqual({
    chat_id: 1,
    text: "hi",
    reply_markup: { inline_keyboard: [[{ text: "Да", callback_data: "publish:x" }]] },
  });
});

test("editMessageText with no keyboard removes buttons", async () => {
  fetchMock.mockResolvedValueOnce(ok(true));
  await editMessageText(1, 7, "new", []);
  expect(lastCall().body).toEqual({
    chat_id: 1,
    message_id: 7,
    text: "new",
    reply_markup: { inline_keyboard: [] },
  });
});

test("removeKeyboard keeps the text and drops buttons", async () => {
  fetchMock.mockResolvedValueOnce(ok(true));
  await removeKeyboard(1, 7);
  expect(lastCall()).toEqual({
    url: "https://api.telegram.org/botTOKEN/editMessageReplyMarkup",
    body: { chat_id: 1, message_id: 7, reply_markup: { inline_keyboard: [] } },
  });
});

test("a web app button opens a page", async () => {
  fetchMock.mockResolvedValueOnce(ok({ message_id: 8 }));
  await sendMessage(1, "x", [[{ text: "Студия", webAppUrl: "https://s.app/studio?item=1" }]]);
  expect(lastCall().body.reply_markup).toEqual({
    inline_keyboard: [[{ text: "Студия", web_app: { url: "https://s.app/studio?item=1" } }]],
  });
});

test("sendMediaGroup sends an album, a single photo with sendPhoto, nothing for none", async () => {
  fetchMock.mockImplementation(async () => ok(true));
  await sendMediaGroup(1, ["https://a/1", "https://a/2"]);
  expect(lastCall()).toEqual({
    url: "https://api.telegram.org/botTOKEN/sendMediaGroup",
    body: {
      chat_id: 1,
      media: [
        { type: "photo", media: "https://a/1" },
        { type: "photo", media: "https://a/2" },
      ],
    },
  });
  await sendMediaGroup(1, ["https://a/1"]);
  expect(lastCall()).toEqual({
    url: "https://api.telegram.org/botTOKEN/sendPhoto",
    body: { chat_id: 1, photo: "https://a/1" },
  });
  fetchMock.mockClear();
  await sendMediaGroup(1, []);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("answerCallbackQuery", async () => {
  fetchMock.mockResolvedValueOnce(ok(true));
  await answerCallbackQuery("cb", "готово");
  expect(lastCall()).toMatchObject({
    url: "https://api.telegram.org/botTOKEN/answerCallbackQuery",
    body: { callback_query_id: "cb", text: "готово" },
  });
});

test("getFileBytes resolves the path and downloads the file", async () => {
  fetchMock
    .mockResolvedValueOnce(ok({ file_path: "photos/a.jpg" }))
    .mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3])));
  const file = await getFileBytes("FILE");
  expect(fetchMock.mock.calls[1][0]).toBe("https://api.telegram.org/file/botTOKEN/photos/a.jpg");
  expect(new Uint8Array(file.bytes)).toEqual(new Uint8Array([1, 2, 3]));
  expect(file.mimeType).toBe("image/jpeg");
});

test("setWebhook sends the secret and allowed updates", async () => {
  fetchMock.mockResolvedValueOnce(ok(true));
  await setWebhook("https://x.convex.site/telegram", "s3cret");
  expect(lastCall().body).toEqual({
    url: "https://x.convex.site/telegram",
    secret_token: "s3cret",
    allowed_updates: ["message", "callback_query"],
  });
});

test("ok:false becomes an error with Telegram's description", async () => {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), {
      status: 400,
    }),
  );
  await expect(sendMessage(1, "x")).rejects.toThrow("chat not found");
});

test("html messages carry parse_mode and no link previews", async () => {
  fetchMock.mockResolvedValueOnce(ok({ message_id: 9 }));
  await sendMessage(1, "<b>hi</b>", undefined, { html: true });
  expect(lastCall().body).toEqual({
    chat_id: 1,
    text: "<b>hi</b>",
    parse_mode: "HTML",
    link_preview_options: { is_disabled: true },
  });
});

test("menu option shows the persistent reply keyboard", async () => {
  fetchMock.mockResolvedValueOnce(ok({ message_id: 9 }));
  await sendMessage(1, "Меню", undefined, { menu: true });
  expect(lastCall().body.reply_markup).toEqual({
    keyboard: [
      [{ text: "📸 Новая вещь" }, { text: "📦 Мои вещи" }],
      [{ text: "📊 Статистика" }, { text: "❓ Помощь" }],
    ],
    resize_keyboard: true,
    is_persistent: true,
  });
});

test("sendChatAction and setMyCommands", async () => {
  fetchMock.mockImplementation(async () => ok(true));
  await sendChatAction(1, "typing");
  expect(lastCall()).toEqual({
    url: "https://api.telegram.org/botTOKEN/sendChatAction",
    body: { chat_id: 1, action: "typing" },
  });
  await setMyCommands([{ command: "items", description: "Мои вещи" }]);
  expect(lastCall().body).toEqual({ commands: [{ command: "items", description: "Мои вещи" }] });
});

test("a network error does not leak the bot token", async () => {
  fetchMock.mockRejectedValueOnce(
    new TypeError("error sending request for url (https://api.telegram.org/botTOKEN/sendMessage)"),
  );
  const err = await sendMessage(1, "x").catch((e: Error) => e);
  expect(String(err)).toContain("sendMessage: network error");
  expect(String(err)).not.toContain("TOKEN");
});
