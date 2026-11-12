import { describe, expect, test } from "vitest";
import { verifyInitData } from "./webAppAuth";

const TOKEN = "123456:TEST-TOKEN";
const NOW = 1_800_000_000;

async function hmac(key: BufferSource, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
}
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

/** Builds initData the way Telegram does. */
async function sign(fields: Record<string, string>, token = TOKEN): Promise<string> {
  const check = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${fields[k]}`)
    .join("\n");
  const secret = await hmac(new TextEncoder().encode("WebAppData"), token);
  const hash = hex(await hmac(secret, check));
  return new URLSearchParams({ ...fields, hash }).toString();
}

const fields = {
  auth_date: String(NOW - 60),
  query_id: "AAH",
  user: JSON.stringify({ id: 42, first_name: "Owner" }),
};

describe("verifyInitData", () => {
  test("accepts data signed with the bot token", async () => {
    expect(await verifyInitData(await sign(fields), TOKEN, NOW)).toEqual({ userId: 42 });
  });

  test("rejects a changed field", async () => {
    const data = (await sign(fields)).replace("%22id%22%3A42", "%22id%22%3A43");
    await expect(verifyInitData(data, TOKEN, NOW)).rejects.toThrow("signature");
  });

  test("rejects another bot's signature", async () => {
    await expect(verifyInitData(await sign(fields, "999:OTHER"), TOKEN, NOW)).rejects.toThrow("signature");
  });

  test("rejects data older than a day", async () => {
    const old = await sign({ ...fields, auth_date: String(NOW - 2 * 86400) });
    await expect(verifyInitData(old, TOKEN, NOW)).rejects.toThrow("expired");
  });

  test("rejects missing hash or user", async () => {
    await expect(verifyInitData("auth_date=1&user=%7B%7D", TOKEN, NOW)).rejects.toThrow();
    const noUser = await sign({ auth_date: String(NOW) });
    await expect(verifyInitData(noUser, TOKEN, NOW)).rejects.toThrow("user");
  });
});
