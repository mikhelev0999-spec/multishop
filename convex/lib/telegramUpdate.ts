export const CALLBACK_ACTIONS = ["publish", "price", "text", "cancel"] as const;
export type CallbackAction = (typeof CALLBACK_ACTIONS)[number];

export const COMMANDS = ["start", "help"] as const;
export type Command = (typeof COMMANDS)[number];

interface Base {
  updateId: number;
  fromId: number;
  chatId: number;
}

export type Incoming =
  | (Base & { kind: "photo"; fileId: string; mediaGroupId?: string; caption?: string })
  | (Base & { kind: "text"; text: string })
  | (Base & { kind: "command"; command: Command })
  | (Base & {
      kind: "callback";
      callbackId: string;
      messageId: number;
      action: CallbackAction;
      itemId: string;
    })
  | { kind: "ignored"; updateId: number };

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown): number | undefined => (typeof x === "number" ? x : undefined);
const str = (x: unknown): string | undefined => (typeof x === "string" ? x : undefined);

/** Turns a raw Telegram update into the few shapes the bot reacts to. Never throws. */
export function parseUpdate(raw: unknown): Incoming {
  if (!isObj(raw)) return { kind: "ignored", updateId: -1 };
  const updateId = num(raw.update_id);
  if (updateId === undefined) return { kind: "ignored", updateId: -1 };
  const ignored = { kind: "ignored", updateId } as const;

  if (isObj(raw.callback_query)) return parseCallback(updateId, raw.callback_query) ?? ignored;
  if (isObj(raw.message)) return parseMessage(updateId, raw.message) ?? ignored;
  return ignored;
}

function parseMessage(updateId: number, m: Obj): Incoming | null {
  const fromId = isObj(m.from) ? num(m.from.id) : undefined;
  const chatId = isObj(m.chat) ? num(m.chat.id) : undefined;
  if (fromId === undefined || chatId === undefined) return null;
  const base = { updateId, fromId, chatId };
  const extras = {
    ...(str(m.media_group_id) ? { mediaGroupId: str(m.media_group_id) } : {}),
    ...(str(m.caption) ? { caption: str(m.caption) } : {}),
  };

  if (Array.isArray(m.photo) && m.photo.length > 0) {
    const largest = m.photo[m.photo.length - 1];
    const fileId = isObj(largest) ? str(largest.file_id) : undefined;
    return fileId ? { kind: "photo", ...base, fileId, ...extras } : null;
  }
  if (isObj(m.document)) {
    const fileId = str(m.document.file_id);
    const mime = str(m.document.mime_type) ?? "";
    return fileId && mime.startsWith("image/") ? { kind: "photo", ...base, fileId, ...extras } : null;
  }
  const text = str(m.text)?.trim();
  if (!text) return null;
  if (text.startsWith("/")) {
    const command = text.slice(1).split(/[\s@]/)[0];
    return (COMMANDS as readonly string[]).includes(command)
      ? { kind: "command", ...base, command: command as Command }
      : null;
  }
  return { kind: "text", ...base, text };
}

function parseCallback(updateId: number, q: Obj): Incoming | null {
  const fromId = isObj(q.from) ? num(q.from.id) : undefined;
  const callbackId = str(q.id);
  const message = isObj(q.message) ? q.message : undefined;
  const chatId = message && isObj(message.chat) ? num(message.chat.id) : undefined;
  const messageId = message ? num(message.message_id) : undefined;
  const parts = (str(q.data) ?? "").split(":");
  if (
    fromId === undefined ||
    callbackId === undefined ||
    chatId === undefined ||
    messageId === undefined ||
    parts.length !== 2 ||
    !(CALLBACK_ACTIONS as readonly string[]).includes(parts[0]) ||
    parts[1] === ""
  ) {
    return null;
  }
  return {
    kind: "callback",
    updateId,
    fromId,
    chatId,
    callbackId,
    messageId,
    action: parts[0] as CallbackAction,
    itemId: parts[1],
  };
}
