// The only place that creates the Anthropic client. Mocked in tests.
import Anthropic from "@anthropic-ai/sdk";
import type { CreateMessage } from "./agent";

let client: Anthropic | null = null;

export const createMessage: CreateMessage = (params) => {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
  client ??= new Anthropic();
  return client.beta.messages.create(params);
};
