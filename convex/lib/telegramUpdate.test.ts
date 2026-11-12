import { describe, expect, test } from "vitest";
import { parseUpdate } from "./telegramUpdate";

const from = { id: 42, is_bot: false, first_name: "Owner" };
const chat = { id: 4242, type: "private" };

describe("parseUpdate", () => {
  test("single photo takes the largest size", () => {
    const r = parseUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        from,
        chat,
        photo: [
          { file_id: "small", width: 90, height: 90 },
          { file_id: "big", width: 1280, height: 1280 },
        ],
      },
    });
    expect(r).toEqual({ kind: "photo", updateId: 1, fromId: 42, chatId: 4242, fileId: "big" });
  });

  test("album photo keeps media group and caption", () => {
    const r = parseUpdate({
      update_id: 2,
      message: {
        message_id: 11,
        from,
        chat,
        media_group_id: "g1",
        caption: "торг",
        photo: [{ file_id: "p1", width: 800, height: 600 }],
      },
    });
    expect(r).toMatchObject({ kind: "photo", fileId: "p1", mediaGroupId: "g1", caption: "торг" });
  });

  test("image sent as a document counts as a photo", () => {
    const r = parseUpdate({
      update_id: 3,
      message: {
        message_id: 12,
        from,
        chat,
        document: { file_id: "doc", mime_type: "image/png", file_size: 900_000 },
      },
    });
    expect(r).toMatchObject({ kind: "photo", fileId: "doc", mimeType: "image/png" });
  });

  test.each([
    ["application/pdf", 1000],
    ["image/heic", 1000],
    ["image/jpeg", 8_000_000],
  ])("document %s of %d bytes is unsupported", (mime_type, file_size) => {
    const r = parseUpdate({
      update_id: 4,
      message: { message_id: 13, from, chat, document: { file_id: "f", mime_type, file_size } },
    });
    expect(r).toEqual({ kind: "unsupported_file", updateId: 4, fromId: 42, chatId: 4242 });
  });

  test("plain text", () => {
    const r = parseUpdate({ update_id: 5, message: { message_id: 14, from, chat, text: " 1500 " } });
    expect(r).toEqual({ kind: "text", updateId: 5, fromId: 42, chatId: 4242, text: "1500" });
  });

  test.each(["start", "help", "items", "stats"] as const)("/%s command", (command) => {
    const r = parseUpdate({ update_id: 6, message: { message_id: 15, from, chat, text: `/${command}` } });
    expect(r).toEqual({ kind: "command", updateId: 6, fromId: 42, chatId: 4242, command });
  });

  test("unknown command is ignored", () => {
    const r = parseUpdate({ update_id: 7, message: { message_id: 16, from, chat, text: "/foo" } });
    expect(r).toEqual({ kind: "ignored", updateId: 7 });
  });

  test.each(["publish", "price", "text", "cancel"] as const)("%s button", (action) => {
    const r = parseUpdate({
      update_id: 8,
      callback_query: {
        id: "cb1",
        from,
        data: `${action}:item123`,
        message: { message_id: 99, chat },
      },
    });
    expect(r).toEqual({
      kind: "callback",
      updateId: 8,
      fromId: 42,
      chatId: 4242,
      callbackId: "cb1",
      messageId: 99,
      action,
      itemId: "item123",
    });
  });

  test.each([
    ["📦 Мои вещи", "items"],
    ["📸 Новая вещь", "new"],
    ["📊 Статистика", "stats"],
    ["❓ Помощь", "help"],
  ] as const)("menu button %s is the %s command", (text, command) => {
    const r = parseUpdate({ update_id: 6, message: { message_id: 15, from, chat, text } });
    expect(r).toEqual({ kind: "command", updateId: 6, fromId: 42, chatId: 4242, command });
  });

  test("a callback with an argument", () => {
    const r = parseUpdate({
      update_id: 8,
      callback_query: { id: "cb", from, data: "pr:item1:-10", message: { message_id: 1, chat } },
    });
    expect(r).toMatchObject({ kind: "callback", action: "pr", itemId: "item1", arg: "-10" });
  });

  test("garbage callback data is ignored", () => {
    const r = parseUpdate({
      update_id: 9,
      callback_query: { id: "cb2", from, data: "delete:all:now", message: { message_id: 1, chat } },
    });
    expect(r).toEqual({ kind: "ignored", updateId: 9 });
  });

  test("update without a message is ignored", () => {
    expect(parseUpdate({ update_id: 10, edited_message: {} })).toEqual({ kind: "ignored", updateId: 10 });
  });

  test.each([null, 5, "x", [], {}])("malformed input %j does not throw", (raw) => {
    expect(parseUpdate(raw)).toEqual({ kind: "ignored", updateId: -1 });
  });
});
