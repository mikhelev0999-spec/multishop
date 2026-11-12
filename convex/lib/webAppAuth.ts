// Telegram Mini App authentication: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app

export const MAX_INIT_DATA_AGE_SEC = 24 * 60 * 60;

const enc = new TextEncoder();

async function hmac(key: BufferSource, message: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(message));
}

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

function equalConstantTime(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Checks the signature and age of Telegram's initData; returns the Telegram user id. */
export async function verifyInitData(
  initData: string,
  botToken: string,
  nowSec: number,
  maxAgeSec = MAX_INIT_DATA_AGE_SEC,
): Promise<{ userId: number }> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) throw new Error("initData has no hash");
  params.delete("hash");

  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = await hmac(enc.encode("WebAppData"), botToken);
  if (!equalConstantTime(toHex(await hmac(secret, check)), hash.toLowerCase())) {
    throw new Error("initData signature is invalid");
  }

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || nowSec - authDate > maxAgeSec) {
    throw new Error("initData expired — reopen the page from the bot");
  }

  let userId: unknown;
  try {
    userId = (JSON.parse(params.get("user") ?? "null") as { id?: unknown } | null)?.id;
  } catch {
    userId = undefined;
  }
  if (typeof userId !== "number") throw new Error("initData has no user");
  return { userId };
}
