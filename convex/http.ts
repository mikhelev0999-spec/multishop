import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction, type ActionCtx } from "./_generated/server";

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

async function serve(ctx: ActionCtx, path: string, cacheControl: string): Promise<Response> {
  const file = await ctx.runQuery(internal.site.byPath, { path });
  const blob = file ? await ctx.storage.get(file.storageId) : null;
  if (!file || !blob) return new Response("not found", { status: 404 });
  return new Response(blob, {
    headers: { "content-type": file.contentType, "cache-control": cacheControl },
  });
}

// The photo studio page (Telegram Mini App). The page itself is never cached so a new build
// shows up at once; built assets have content hashes in their names and can be cached forever.
http.route({
  path: "/studio",
  method: "GET",
  handler: httpAction((ctx) => serve(ctx, "index.html", "no-cache")),
});

http.route({
  pathPrefix: "/assets/",
  method: "GET",
  handler: httpAction((ctx, request) =>
    serve(ctx, new URL(request.url).pathname.slice(1), "public, max-age=31536000, immutable"),
  ),
});

export default http;
