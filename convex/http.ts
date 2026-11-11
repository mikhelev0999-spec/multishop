import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/telegram",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    if (!secret || request.headers.get("x-telegram-bot-api-secret-token") !== secret) {
      return new Response("unauthorized", { status: 401 });
    }
    let update: unknown;
    try {
      update = await request.json();
    } catch {
      return new Response("ok");
    }
    try {
      await ctx.runMutation(internal.telegram.handleUpdate, { update });
    } catch (e) {
      // Answer 200 anyway: otherwise Telegram re-sends the same update forever.
      console.error("handleUpdate failed", e);
    }
    return new Response("ok");
  }),
});

export default http;
