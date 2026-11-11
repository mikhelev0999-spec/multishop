// Claude tool loop: photos in, a listing draft (or one question for the owner) out.
// Pure apart from the injected deps, so it is tested without network.
import type Anthropic from "@anthropic-ai/sdk";
import { summarize, usdToUah } from "./pricing";
import {
  CONDITIONS,
  MARKETPLACES,
  MAX_TITLE_LENGTH,
  type Answer,
  type Comparable,
  type Condition,
  type Draft,
  type Marketplace,
} from "./validators";

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;
type MessageParam = Anthropic.Beta.BetaMessageParam;
type ToolResult = Anthropic.Beta.BetaToolResultBlockParam;
type Tool = Anthropic.Beta.BetaTool;

export type CreateMessage = (params: Params) => Promise<Anthropic.Beta.BetaMessage>;

export interface AgentDeps {
  createMessage: CreateMessage;
  searchByKeywords: (query: string, opts: { used: boolean }) => Promise<Comparable[]>;
  searchByImage: (base64: string) => Promise<Comparable[]>;
}

export interface Photo {
  mediaType: string;
  base64: string;
}

export const MODEL = "claude-opus-5-5";
export const MAX_REQUESTS = 8;
/** Convex actions die after 10 minutes; stop well before that. */
export const LOOP_BUDGET_MS = 6 * 60 * 1000;
/** After this many answered questions the agent must decide on its own. */
export const MAX_QUESTIONS = 3;
export const MAX_DESCRIPTION_LENGTH = 3000;
export const MAX_REASONING_LENGTH = 600;
export const MAX_QUESTION_LENGTH = 300;
const MAX_LISTED_RESULTS = 15;

// USD per 1M tokens for claude-opus-5-5.
const PRICE = { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 };

const SYSTEM = `You help one person in Ukraine sell used items, one item at a time, on OLX.ua and eBay.
You get photos of a single item, sometimes with the owner's note and answers to your earlier questions.

Your job:
1. Identify the item: what it is, brand, model, notable specs, condition, visible defects.
   Describe only what the photos, the note or the answers support. Never invent accessories,
   specs or a working state you cannot see; if something matters and is unknown, either say so
   in the description or ask.
2. Research prices. Use search_ebay with precise queries (brand + model, in English), and
   search_ebay_by_image when the item is hard to name. A couple of searches is usually enough.
   eBay prices are US asking prices; used items on OLX.ua usually sell noticeably cheaper, so
   treat eBay as an upper reference and use your own knowledge of the Ukrainian market.
3. Pick a price for a reasonably quick sale on OLX.ua in UAH, and a price in USD for eBay.
4. Call submit_draft. The title and description are in Ukrainian, written like a good private
   OLX listing: a clear title (max ${MAX_TITLE_LENGTH} characters, brand and model first), then a short,
   honest description (at most ${MAX_DESCRIPTION_LENGTH} characters) with condition, defects and what
   is included. No emojis, no hype,
   no contact details. price_reasoning_ru is in Russian for the owner: two or three short sentences
   on the comparables and why this price.
   Suggest eBay only when it makes sense to ship abroad (small, light, valuable items).

Ask the owner (ask_owner, one short question in Russian) only when without the answer the price or
the description would be clearly wrong, e.g. storage size of a phone, a size of clothing that is not
visible, whether a device turns on. Otherwise make a reasonable call and mention it in the description.
Finish every task with exactly one call of submit_draft or ask_owner.`;

const draftSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "title_uk",
    "description_uk",
    "category",
    "brand",
    "model",
    "condition",
    "defects",
    "price_uah",
    "price_usd",
    "price_reasoning_ru",
    "comparables_count",
    "marketplaces",
  ],
  properties: {
    title_uk: { type: "string", description: `Ukrainian title, at most ${MAX_TITLE_LENGTH} characters` },
    description_uk: { type: "string", description: "Ukrainian listing description" },
    category: { type: "string", description: "Category path in Ukrainian, e.g. 'Електроніка / Навушники'" },
    brand: { type: "string", description: "Brand, or empty string if unknown" },
    model: { type: "string", description: "Model, or empty string if unknown" },
    condition: { type: "string", enum: [...CONDITIONS] },
    defects: { type: "array", items: { type: "string" }, description: "Visible defects, in Russian" },
    price_uah: { type: "integer", description: "Asking price on OLX.ua in UAH" },
    price_usd: { type: "number", description: "Asking price on eBay in USD" },
    price_reasoning_ru: { type: "string" },
    comparables_count: { type: "integer", description: "How many comparable listings the price is based on" },
    marketplaces: { type: "array", items: { type: "string", enum: [...MARKETPLACES] } },
  },
} as const;

const SUBMIT_DRAFT: Tool = {
  name: "submit_draft",
  description: "Submit the finished listing draft. Ends the task.",
  strict: true,
  input_schema: draftSchema as unknown as Tool["input_schema"],
};

const ASK_OWNER: Tool = {
  name: "ask_owner",
  description: "Ask the owner one short question in Russian. Ends the task until the owner answers.",
  strict: true,
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["question"],
    properties: { question: { type: "string" } },
  } as unknown as Tool["input_schema"],
};

const SEARCH_EBAY: Tool = {
  name: "search_ebay",
  description:
    "Search active fixed-price eBay (US) listings by keywords. Returns titles, USD prices and a price summary.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["query", "used"],
    properties: {
      query: { type: "string", description: "English keywords, e.g. 'Sony WH-1000XM4'" },
      used: { type: "boolean", description: "Only used items" },
    },
  } as unknown as Tool["input_schema"],
};

const SEARCH_EBAY_BY_IMAGE: Tool = {
  name: "search_ebay_by_image",
  description: "Find visually similar active eBay (US) listings using one of the photos.",
  input_schema: {
    type: "object",
    additionalProperties: false,
    required: ["photo_index"],
    properties: { photo_index: { type: "integer", description: "1-based photo number" } },
  } as unknown as Tool["input_schema"],
};

const nudge = (tools: Tool[]) =>
  tools.some((t) => t.name === "ask_owner")
    ? "Finish now: call submit_draft, or ask_owner if you really need an answer."
    : "Finish now: call submit_draft.";

export type AgentResult =
  | { kind: "draft"; draft: Draft; comparables: Comparable[]; costUsd: number }
  | { kind: "question"; question: string; costUsd: number };

export async function runAgent(
  input: { photos: Photo[]; caption?: string; answers: Answer[]; usdUah: number },
  deps: AgentDeps,
): Promise<AgentResult> {
  const notes: string[] = [`Photos: ${input.photos.length}. Today's NBU rate: 1 USD = ${input.usdUah} UAH.`];
  if (input.caption) notes.push(`Owner's note: ${input.caption}`);
  for (const a of input.answers) notes.push(`You asked: ${a.question}\nOwner answered: ${a.answer}`);
  const canAsk = input.answers.length < MAX_QUESTIONS;
  if (!canAsk) notes.push("You have asked enough questions: decide on your own and call submit_draft.");

  const comparables = new Map<string, Comparable>();
  const runSearch = async (found: Promise<Comparable[]>) => {
    const list = await found;
    for (const c of list) comparables.set(c.url, c);
    return formatResults(list, input.usdUah);
  };

  return loop(
    [{ role: "user", content: [...photoBlocks(input.photos), { type: "text", text: notes.join("\n\n") }] }],
    canAsk ? [SEARCH_EBAY, SEARCH_EBAY_BY_IMAGE, ASK_OWNER, SUBMIT_DRAFT] : [SEARCH_EBAY, SEARCH_EBAY_BY_IMAGE, SUBMIT_DRAFT],
    deps,
    {
      search_ebay: (raw) => {
        const { query, used } = raw as { query?: unknown; used?: unknown };
        if (typeof query !== "string" || !query.trim()) throw new Error("query is required");
        return runSearch(deps.searchByKeywords(query, { used: used !== false }));
      },
      search_ebay_by_image: (raw) => {
        const index = (raw as { photo_index?: unknown }).photo_index;
        const photo = typeof index === "number" ? input.photos[index - 1] : undefined;
        if (!photo) throw new Error(`photo_index must be between 1 and ${input.photos.length}`);
        return runSearch(deps.searchByImage(photo.base64));
      },
    },
    (draft, costUsd) => ({ kind: "draft", draft, comparables: [...comparables.values()], costUsd }),
  );
}

/** Rewrites the listing text by the owner's instruction; the price stays as it is. */
export async function runRewrite(
  input: { draft: Draft; instruction: string },
  deps: AgentDeps,
): Promise<{ draft: Draft; costUsd: number }> {
  const text = [
    "Here is the current listing draft as JSON:",
    JSON.stringify(toToolInput(input.draft)),
    `The owner asks to change it (in Russian): ${input.instruction}`,
    "Apply the change and call submit_draft with the full updated draft. Keep the prices unchanged.",
    "No searching or questions this time: submit_draft is the only tool available.",
  ].join("\n\n");
  const result = await loop(
    [{ role: "user", content: [{ type: "text", text }] }],
    [SUBMIT_DRAFT],
    deps,
    {},
    (draft, costUsd) => ({ kind: "draft", draft, comparables: [], costUsd }),
  );
  if (result.kind !== "draft") throw new Error("unexpected question during rewrite");
  return {
    draft: { ...result.draft, priceUah: input.draft.priceUah, priceUsd: input.draft.priceUsd },
    costUsd: result.costUsd,
  };
}

type Handlers = Record<string, (input: unknown) => Promise<string>>;

async function loop(
  messages: MessageParam[],
  tools: Tool[],
  deps: AgentDeps,
  handlers: Handlers,
  onDraft: (draft: Draft, costUsd: number) => AgentResult,
): Promise<AgentResult> {
  let costUsd = 0;
  const allowed = new Set(tools.map((t) => t.name));
  const deadline = Date.now() + LOOP_BUDGET_MS;
  for (let i = 0; i < MAX_REQUESTS; i++) {
    if (Date.now() > deadline) throw new Error("Claude думал слишком долго");
    const response = await deps.createMessage({
      model: MODEL,
      max_tokens: 16000,
      // Automatic caching: the photos are re-sent on every step of the loop.
      cache_control: { type: "ephemeral" },
      system: SYSTEM,
      messages: [...messages],
      tools,
      tool_choice: { type: "auto" },
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
    });
    costUsd += cost(response.usage);

    if (response.stop_reason === "refusal") {
      throw new Error("Claude отказался обрабатывать эти фото");
    }
    messages.push({ role: "assistant", content: response.content });

    const calls = response.content.filter(
      (b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use",
    );
    if (calls.length === 0) {
      messages.push({ role: "user", content: [{ type: "text", text: nudge(tools) }] });
      continue;
    }

    const results: ToolResult[] = [];
    for (const call of calls) {
      if (!allowed.has(call.name)) {
        results.push(error(call.id, `tool ${call.name} is not available`));
      } else if (call.name === "ask_owner") {
        const question = (call.input as { question?: unknown }).question;
        if (typeof question === "string" && question.trim() && question.length <= MAX_QUESTION_LENGTH) {
          return { kind: "question", question: question.trim(), costUsd };
        }
        results.push(error(call.id, `question must be 1–${MAX_QUESTION_LENGTH} characters`));
      } else if (call.name === "submit_draft") {
        const parsed = parseDraft(call.input);
        if (parsed.ok) return onDraft(parsed.draft, costUsd);
        results.push(error(call.id, parsed.error));
      } else if (handlers[call.name]) {
        try {
          results.push({ type: "tool_result", tool_use_id: call.id, content: await handlers[call.name](call.input) });
        } catch (e) {
          results.push(error(call.id, e instanceof Error ? e.message : String(e)));
        }
      } else {
        results.push(error(call.id, `unknown tool ${call.name}`));
      }
    }
    messages.push({ role: "user", content: results });
  }
  throw new Error(`Claude не закончил анализ за ${MAX_REQUESTS} запросов`);
}

const error = (id: string, message: string): ToolResult => ({
  type: "tool_result",
  tool_use_id: id,
  is_error: true,
  content: message,
});

function photoBlocks(photos: Photo[]): Anthropic.Beta.BetaImageBlockParam[] {
  return photos.map((p) => ({
    type: "image",
    source: {
      type: "base64",
      media_type: p.mediaType as "image/jpeg",
      data: p.base64,
    },
  }));
}

function formatResults(list: Comparable[], usdUah: number): string {
  if (list.length === 0) return "No listings found.";
  const s = summarize(list.map((c) => c.priceUsd));
  const lines = list
    .slice(0, MAX_LISTED_RESULTS)
    .map((c) => `- ${c.title} — $${c.priceUsd}${c.condition ? ` (${c.condition})` : ""}`);
  const summary =
    s === null
      ? ""
      : `\nSummary of ${s.count} prices (outliers removed): p25 $${s.p25}, median $${s.median}, p75 $${s.p75}` +
        ` (median ≈ ${usdToUah(s.median, usdUah)} UAH).`;
  return `${list.length} listings:\n${lines.join("\n")}${summary}`;
}

function cost(u: Anthropic.Beta.BetaUsage): number {
  return (
    (u.input_tokens * PRICE.input +
      u.output_tokens * PRICE.output +
      (u.cache_read_input_tokens ?? 0) * PRICE.cacheRead +
      (u.cache_creation_input_tokens ?? 0) * PRICE.cacheWrite) /
    1_000_000
  );
}

type Parsed = { ok: true; draft: Draft } | { ok: false; error: string };

export function parseDraft(raw: unknown): Parsed {
  const r = (raw ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const str = (k: string) => (typeof r[k] === "string" ? (r[k] as string).trim() : "");
  const title = str("title_uk");
  const description = str("description_uk");
  if (!title) problems.push("title_uk is empty");
  if (title.length > MAX_TITLE_LENGTH) problems.push(`title_uk must be at most ${MAX_TITLE_LENGTH} characters, got ${title.length}`);
  if (!description) problems.push("description_uk is empty");
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    problems.push(`description_uk must be at most ${MAX_DESCRIPTION_LENGTH} characters, got ${description.length}`);
  }
  if (str("price_reasoning_ru").length > MAX_REASONING_LENGTH) {
    problems.push(`price_reasoning_ru must be at most ${MAX_REASONING_LENGTH} characters`);
  }
  const condition = r.condition as Condition;
  if (!CONDITIONS.includes(condition)) problems.push("condition is invalid");
  const priceUah = Number(r.price_uah);
  const priceUsd = Number(r.price_usd);
  if (!(priceUah > 0)) problems.push("price_uah must be positive");
  if (!(priceUsd > 0)) problems.push("price_usd must be positive");
  const marketplaces = Array.isArray(r.marketplaces)
    ? [...new Set(r.marketplaces.filter((m): m is Marketplace => MARKETPLACES.includes(m as Marketplace)))]
    : [];
  if (marketplaces.length === 0) problems.push("marketplaces must list olx and/or ebay");
  if (problems.length > 0) return { ok: false, error: `Fix and call submit_draft again: ${problems.join("; ")}` };

  const brand = str("brand");
  const model = str("model");
  return {
    ok: true,
    draft: {
      titleUk: title,
      descriptionUk: description,
      category: str("category"),
      ...(brand ? { brand } : {}),
      ...(model ? { model } : {}),
      condition,
      defects: Array.isArray(r.defects)
        ? r.defects
            .filter((d): d is string => typeof d === "string" && d.trim() !== "")
            .slice(0, 10)
            .map((d) => d.trim().slice(0, 150))
        : [],
      priceUah: Math.round(priceUah),
      priceUsd: Math.round(priceUsd * 100) / 100,
      priceReasoningRu: str("price_reasoning_ru"),
      comparablesCount: Math.max(0, Math.round(Number(r.comparables_count) || 0)),
      marketplaces,
    },
  };
}

function toToolInput(d: Draft) {
  return {
    title_uk: d.titleUk,
    description_uk: d.descriptionUk,
    category: d.category,
    brand: d.brand ?? "",
    model: d.model ?? "",
    condition: d.condition,
    defects: d.defects,
    price_uah: d.priceUah,
    price_usd: d.priceUsd,
    price_reasoning_ru: d.priceReasoningRu,
    comparables_count: d.comparablesCount,
    marketplaces: d.marketplaces,
  };
}
