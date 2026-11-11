// The only place that creates the Anthropic client. Mocked in tests.
import Anthropic from "@anthropic-ai/sdk";
import type { CreateMessage } from "./agent";

let client: Anthropic | null = null;

export const createMessage: CreateMessage = (params) => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  // Short per-request timeout: the whole analysis must fit in one Convex action (10 min).
  client ??= new Anthropic({ timeout: 120_000, maxRetries: 1 });
  return client.beta.messages.create(params);
};
