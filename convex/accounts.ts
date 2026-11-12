// Connecting marketplace accounts (OLX, eBay) through OAuth: the bot sends a login link with a
// one-time state; the marketplace sends the owner back to /oauth/<provider>/callback.
import { v } from "convex/values";
import { internal } from "./_generated/api";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { esc } from "./lib/botTexts";
import {
  authorizeUrl,
  exchangeCode,
  PROVIDER_NAME,
  PROVIDERS,
  providerConfig,
  type Provider,
} from "./lib/oauth";
import * as telegram from "./lib/telegramApi";
import { providerValidator, tokensValidator } from "./lib/validators";

/** A login link works this long after the bot sent it. */
export const STATE_TTL_MS = 15 * 60 * 1000;

const siteUrl = () => {
  const site = process.env.CONVEX_SITE_URL;
  if (!site) throw new Error("CONVEX_SITE_URL is not set");
  return site;
};

function randomState(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const newState = internalMutation({
  args: { provider: providerValidator, chatId: v.number(), state: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    const stale = await ctx.db
      .query("oauthStates")
      .withIndex("by_created", (q) => q.lt("createdAt", now - STATE_TTL_MS))
      .take(100);
    for (const row of stale) await ctx.db.delete(row._id);
    await ctx.db.insert("oauthStates", { ...args, createdAt: now });
    return null;
  },
});

/** Burns the state; returns the chat that asked for the link, or null if it is not valid. */
export const consumeState = internalMutation({
  args: { provider: providerValidator, state: v.string() },
  returns: v.union(v.number(), v.null()),
  handler: async (ctx, { provider, state }) => {
    const row = await ctx.db
      .query("oauthStates")
      .withIndex("by_state", (q) => q.eq("state", state))
      .first();
    if (!row) return null;
    await ctx.db.delete(row._id);
    if (row.provider !== provider || row.createdAt < Date.now() - STATE_TTL_MS) return null;
    return row.chatId;
  },
});

export const save = internalMutation({
  args: { provider: providerValidator, tokens: tokensValidator },
  returns: v.null(),
  handler: async (ctx, { provider, tokens }) => {
    const old = await ctx.db
      .query("accounts")
      .withIndex("by_provider", (q) => q.eq("provider", provider))
      .take(10);
    for (const row of old) await ctx.db.delete(row._id);
    await ctx.db.insert("accounts", { provider, ...tokens, connectedAt: Date.now() });
    return null;
  },
});

/** Which providers are connected and since when — never the tokens. */
export const connected = internalQuery({
  args: {},
  returns: v.array(v.object({ provider: providerValidator, connectedAt: v.number() })),
  handler: async (ctx) => {
    // At most one row per provider.
    const rows = await ctx.db.query("accounts").take(10);
    return rows.map((r) => ({ provider: r.provider, connectedAt: r.connectedAt }));
  },
});

const kyivDate = (ms: number) =>
  new Date(ms).toLocaleDateString("ru-RU", { timeZone: "Europe/Kyiv" });

/** "🔗 Аккаунты": the status of each marketplace and a fresh login link where possible. */
export const show = internalAction({
  args: { chatId: v.number() },
  returns: v.null(),
  handler: async (ctx, { chatId }) => {
    const site = siteUrl();
    const connected = await ctx.runQuery(internal.accounts.connected, {});
    const lines = ["<b>🔗 Аккаунты площадок</b>", ""];
    const keyboard: telegram.Keyboard = [];
    for (const provider of PROVIDERS) {
      const name = PROVIDER_NAME[provider];
      const account = connected.find((a) => a.provider === provider);
      lines.push(
        account
          ? `✅ <b>${name}</b> — подключён ${esc(kyivDate(account.connectedAt))}`
          : `⚪️ <b>${name}</b> — не подключён`,
      );
      const cfg = providerConfig(provider, site);
      if (!cfg) {
        lines.push("   нужны ключи разработчика — Claude подскажет, где их взять");
        continue;
      }
      const state = randomState();
      await ctx.runMutation(internal.accounts.newState, { provider, chatId, state });
      keyboard.push([
        {
          text: account ? `🔄 Переподключить ${name}` : `🔗 Подключить ${name}`,
          url: authorizeUrl(provider, cfg, state),
        },
      ]);
    }
    if (keyboard.length) {
      lines.push("", "Ссылка входа работает 15 минут. После «Разрешить» вернитесь сюда.");
    }
    await telegram.sendMessage(chatId, lines.join("\n"), keyboard.length ? keyboard : undefined, {
      html: true,
    });
    return null;
  },
});

const resultValidator = v.object({ ok: v.boolean(), title: v.string(), text: v.string() });
type Result = { ok: boolean; title: string; text: string };

async function tell(chatId: number, text: string) {
  try {
    await telegram.sendMessage(chatId, text);
  } catch (e) {
    console.error("accounts: telegram message failed", e instanceof Error ? e.message : e);
  }
}

/** The marketplace sent the owner back: check the state, swap the code, save, tell the bot. */
export const complete = internalAction({
  args: {
    provider: providerValidator,
    state: v.optional(v.string()),
    code: v.optional(v.string()),
    error: v.optional(v.string()),
  },
  returns: resultValidator,
  handler: async (ctx, { provider, state, code, error }): Promise<Result> => {
    const name = PROVIDER_NAME[provider as Provider];
    const chatId = state
      ? await ctx.runMutation(internal.accounts.consumeState, { provider, state })
      : null;
    if (chatId === null) {
      return {
        ok: false,
        title: "Ссылка устарела",
        text: "Откройте в боте «🔗 Аккаунты» и нажмите кнопку подключения ещё раз.",
      };
    }
    if (error || !code) {
      await tell(chatId, `${name}: подключение отменено.`);
      return { ok: false, title: "Подключение отменено", text: "Аккаунт не подключён." };
    }
    const cfg = providerConfig(provider, siteUrl());
    if (!cfg) {
      await tell(chatId, `❌ ${name}: в Convex нет ключей разработчика.`);
      return { ok: false, title: "Не подключено", text: "В Convex нет ключей разработчика." };
    }
    try {
      const tokens = await exchangeCode(provider, cfg, code, Date.now());
      await ctx.runMutation(internal.accounts.save, { provider, tokens });
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      await tell(chatId, `❌ ${reason}. Попробуйте ещё раз: «🔗 Аккаунты».`);
      return { ok: false, title: "Не подключено", text: reason };
    }
    await tell(chatId, `✅ ${name} подключён.`);
    return { ok: true, title: `✅ ${name} подключён`, text: "Вернитесь в Telegram." };
  },
});
