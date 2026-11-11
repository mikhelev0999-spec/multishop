import { afterEach, beforeEach, expect, test, vi } from "vitest";
import {
  answerCallbackQuery,
  editMessageText,
  getFileBytes,
  removeKeyboard,
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
  new Response(JSON.stringify({ ok: true, result }), { headers: { "content-type": "application/json" } });

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
    new Response(JSON.stringify({ ok: false, description: "Bad Request: chat not found" }), { status: 400 }),
  );
  await expect(sendMessage(1, "x")).rejects.toThrow("chat not found");
});
