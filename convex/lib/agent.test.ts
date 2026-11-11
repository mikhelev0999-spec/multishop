import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, test, vi } from "vitest";
import { runAgent, runRewrite, type AgentDeps, type CreateMessage } from "./agent";
import type { Draft } from "./validators";

type Msg = Anthropic.Beta.BetaMessage;
type Block = Anthropic.Beta.BetaContentBlock;

const usage = { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 };

function reply(content: Block[], stop_reason: Msg["stop_reason"] = "tool_use"): Msg {
  return { id: "m", type: "message", role: "assistant", model: "claude-opus-5-5", content, stop_reason, usage } as unknown as Msg;
}
const toolUse = (id: string, name: string, input: unknown) =>
  ({ type: "tool_use", id, name, input }) as unknown as Block;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Block;

const draftInput = {
  title_uk: "Навушники Sony WH-1000XM4",
  description_uk: "Б/в, повний комплект.",
  category: "Електроніка / Навушники",
  brand: "Sony",
  model: "WH-1000XM4",
  condition: "good",
  defects: [],
  price_uah: 4500,
  price_usd: 110,
  price_reasoning_ru: "Медиана аналогов $120.",
  comparables_count: 14,
  marketplaces: ["olx", "ebay"],
};
const expectedDraft: Draft = {
  titleUk: "Навушники Sony WH-1000XM4",
  descriptionUk: "Б/в, повний комплект.",
  category: "Електроніка / Навушники",
  brand: "Sony",
  model: "WH-1000XM4",
  condition: "good",
  defects: [],
  priceUah: 4500,
  priceUsd: 110,
  priceReasoningRu: "Медиана аналогов $120.",
  comparablesCount: 14,
  marketplaces: ["olx", "ebay"],
};

function setup(replies: Msg[]) {
  const createMessage = vi.fn<CreateMessage>();
  for (const r of replies) createMessage.mockResolvedValueOnce(r);
  const deps: AgentDeps = {
    createMessage,
    searchByKeywords: vi.fn().mockResolvedValue([
      { title: "Sony XM4 used", priceUsd: 120, url: "https://ebay.com/itm/1" },
      { title: "Sony XM4", priceUsd: 130, url: "https://ebay.com/itm/2" },
    ]),
    searchByImage: vi.fn().mockResolvedValue([{ title: "Img match", priceUsd: 100, url: "https://ebay.com/itm/3" }]),
  };
  return { createMessage, deps };
}

const input = {
  photos: [{ mediaType: "image/jpeg", base64: "AAAA" }],
  caption: "торг",
  answers: [{ question: "Какой объём памяти?", answer: "128 ГБ" }],
  usdUah: 41,
};

describe("runAgent", () => {
  test("immediate submit_draft", async () => {
    const { deps, createMessage } = setup([reply([toolUse("t1", "submit_draft", draftInput)])]);
    const r = await runAgent(input, deps);
    expect(r).toMatchObject({ kind: "draft", draft: expectedDraft, comparables: [] });
    const params = createMessage.mock.calls[0][0];
    expect(params.model).toBe("claude-opus-5-5");
    expect(params.fallbacks).toBe("default");
    expect(params.betas).toEqual(["server-side-fallback-2026-07-01"]);
    expect(params.output_config).toEqual({ effort: "medium" });
    expect(params.tool_choice).toEqual({ type: "auto" });
    expect(params.thinking).toBeUndefined();
    const first = JSON.stringify(params.messages[0]);
    expect(first).toContain("AAAA");
    expect(first).toContain("торг");
    expect(first).toContain("128 ГБ");
  });

  test("search result goes back as tool_result with the same id", async () => {
    const { deps, createMessage } = setup([
      reply([toolUse("s1", "search_ebay", { query: "sony xm4", used: true })]),
      reply([toolUse("t2", "submit_draft", draftInput)]),
    ]);
    const r = await runAgent(input, deps);
    expect(deps.searchByKeywords).toHaveBeenCalledWith("sony xm4", { used: true });
    const second = createMessage.mock.calls[1][0].messages;
    expect(second).toHaveLength(3);
    const results = second[2].content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results[0]).toMatchObject({ type: "tool_result", tool_use_id: "s1" });
    expect(JSON.stringify(results[0].content)).toContain("Sony XM4 used");
    expect(JSON.stringify(results[0].content)).toContain("4");
    if (r.kind !== "draft") throw new Error("expected draft");
    expect(r.comparables.map((c) => c.url)).toEqual(["https://ebay.com/itm/1", "https://ebay.com/itm/2"]);
  });

  test("ask_owner ends with a question", async () => {
    const { deps } = setup([reply([toolUse("q", "ask_owner", { question: "Работает ли шумоподавление?" })])]);
    expect(await runAgent(input, deps)).toMatchObject({ kind: "question", question: "Работает ли шумоподавление?" });
  });

  test("invalid submit_draft is returned as an error and corrected", async () => {
    const { deps, createMessage } = setup([
      reply([toolUse("bad", "submit_draft", { ...draftInput, title_uk: "x".repeat(80), price_uah: 0 })]),
      reply([toolUse("good", "submit_draft", draftInput)]),
    ]);
    const r = await runAgent(input, deps);
    expect(r.kind).toBe("draft");
    const err = (createMessage.mock.calls[1][0].messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(err).toMatchObject({ tool_use_id: "bad", is_error: true });
    expect(JSON.stringify(err.content)).toMatch(/70/);
  });

  test("two tool calls in one reply produce one user turn with two results", async () => {
    const { deps, createMessage } = setup([
      reply([
        toolUse("a", "search_ebay", { query: "x", used: true }),
        toolUse("b", "search_ebay_by_image", { photo_index: 1 }),
      ]),
      reply([toolUse("t", "submit_draft", draftInput)]),
    ]);
    await runAgent(input, deps);
    expect(deps.searchByImage).toHaveBeenCalledWith("AAAA");
    const results = createMessage.mock.calls[1][0].messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results.map((b) => b.tool_use_id)).toEqual(["a", "b"]);
  });

  test("a failing tool is reported with is_error", async () => {
    const { deps, createMessage } = setup([
      reply([toolUse("a", "search_ebay", { query: "x", used: true })]),
      reply([toolUse("t", "submit_draft", draftInput)]),
    ]);
    vi.mocked(deps.searchByKeywords).mockRejectedValueOnce(new Error("eBay down"));
    await runAgent(input, deps);
    const res = (createMessage.mock.calls[1][0].messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(res).toMatchObject({ is_error: true });
    expect(JSON.stringify(res.content)).toContain("eBay down");
  });

  test("bad photo index is a tool error, not a crash", async () => {
    const { deps, createMessage } = setup([
      reply([toolUse("a", "search_ebay_by_image", { photo_index: 5 })]),
      reply([toolUse("t", "submit_draft", draftInput)]),
    ]);
    await runAgent(input, deps);
    const res = (createMessage.mock.calls[1][0].messages[2].content as Anthropic.Beta.BetaToolResultBlockParam[])[0];
    expect(res).toMatchObject({ is_error: true });
  });

  test("plain text reply gets a nudge to finish", async () => {
    const { deps, createMessage } = setup([
      reply([text("Думаю...")], "end_turn"),
      reply([toolUse("t", "submit_draft", draftInput)]),
    ]);
    expect((await runAgent(input, deps)).kind).toBe("draft");
    const nudge = createMessage.mock.calls[1][0].messages[2];
    expect(nudge.role).toBe("user");
    expect(JSON.stringify(nudge.content)).toContain("submit_draft");
  });

  test("refusal throws", async () => {
    const { deps } = setup([reply([], "refusal")]);
    await expect(runAgent(input, deps)).rejects.toThrow(/отказ/i);
  });

  test("gives up after 8 requests", async () => {
    const loop = Array.from({ length: 9 }, (_, i) => reply([toolUse(`s${i}`, "search_ebay", { query: "x", used: true })]));
    const { deps, createMessage } = setup(loop);
    await expect(runAgent(input, deps)).rejects.toThrow(/8/);
    expect(createMessage).toHaveBeenCalledTimes(8);
  });

  test("cost is summed over requests", async () => {
    const { deps } = setup([
      reply([toolUse("s", "search_ebay", { query: "x", used: true })]),
      reply([toolUse("t", "submit_draft", draftInput)]),
    ]);
    const r = await runAgent(input, deps);
    // 2 × (1000 × $4 + 500 × $20) / 1M = $0.028
    expect(r.costUsd).toBeCloseTo(0.028, 6);
  });
});

describe("runRewrite", () => {
  test("offers only submit_draft and keeps the price", async () => {
    const { deps, createMessage } = setup([
      reply([toolUse("t", "submit_draft", { ...draftInput, description_uk: "З коробкою.", price_uah: 9999 })]),
    ]);
    const r = await runRewrite({ draft: expectedDraft, instruction: "добавь, что есть коробка" }, deps);
    expect(r.draft.descriptionUk).toBe("З коробкою.");
    expect(r.draft.priceUah).toBe(4500);
    expect(r.draft.priceUsd).toBe(110);
    const params = createMessage.mock.calls[0][0];
    expect(params.tools?.map((t) => (t as { name: string }).name)).toEqual(["submit_draft"]);
    expect(JSON.stringify(params.messages[0])).toContain("добавь, что есть коробка");
  });
});
