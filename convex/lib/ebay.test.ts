import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resetTokenCache, searchByImage, searchByKeywords } from "./ebay";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubEnv("EBAY_CLIENT_ID", "id");
  vi.stubEnv("EBAY_CLIENT_SECRET", "secret");
  vi.stubGlobal("fetch", fetchMock);
  resetTokenCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const token = () => json({ access_token: "T", expires_in: 7200 });
const results = () => json({
  itemSummaries: [
    {
      title: "Sony WH-1000XM4",
      price: { value: "120.00", currency: "USD" },
      itemWebUrl: "https://ebay.com/itm/1",
      condition: "Used",
    },
    { title: "In euros", price: { value: "100", currency: "EUR" }, itemWebUrl: "https://ebay.com/itm/2" },
    { title: "No price", itemWebUrl: "https://ebay.com/itm/3" },
  ],
});

test("searchByKeywords gets a token, filters used fixed-price items and parses USD results", async () => {
  fetchMock.mockResolvedValueOnce(token()).mockResolvedValueOnce(results());
  const items = await searchByKeywords("sony wh-1000xm4", { used: true });

  const [tokenUrl, tokenInit] = fetchMock.mock.calls[0];
  expect(String(tokenUrl)).toBe("https://api.ebay.com/identity/v1/oauth2/token");
  expect((tokenInit as RequestInit).headers).toMatchObject({ authorization: `Basic ${btoa("id:secret")}` });
  expect(String((tokenInit as RequestInit).body)).toContain("grant_type=client_credentials");

  const [url, init] = fetchMock.mock.calls[1];
  const u = new URL(String(url));
  expect(u.pathname).toBe("/buy/browse/v1/item_summary/search");
  expect(u.searchParams.get("q")).toBe("sony wh-1000xm4");
  expect(u.searchParams.get("filter")).toBe("buyingOptions:{FIXED_PRICE},conditionIds:{3000}");
  expect((init as RequestInit).headers).toMatchObject({
    authorization: "Bearer T",
    "x-ebay-c-marketplace-id": "EBAY_US",
  });

  expect(items).toEqual([
    { title: "Sony WH-1000XM4", priceUsd: 120, url: "https://ebay.com/itm/1", condition: "Used" },
  ]);
});

test("token is reused between calls", async () => {
  fetchMock
    .mockResolvedValueOnce(token())
    .mockResolvedValueOnce(json({}))
    .mockResolvedValueOnce(json({}));
  await searchByKeywords("a", { used: false });
  await searchByKeywords("b", { used: false });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  expect(new URL(String(fetchMock.mock.calls[2][0])).searchParams.get("filter")).toBe(
    "buyingOptions:{FIXED_PRICE}",
  );
});

test("searchByImage posts the base64 image", async () => {
  fetchMock.mockResolvedValueOnce(token()).mockResolvedValueOnce(results());
  const items = await searchByImage("AAAA");
  const [url, init] = fetchMock.mock.calls[1];
  expect(new URL(String(url)).pathname).toBe("/buy/browse/v1/item_summary/search_by_image");
  expect(JSON.parse(String((init as RequestInit).body))).toEqual({ image: "AAAA" });
  expect(items).toHaveLength(1);
});

test("empty result is an empty list", async () => {
  fetchMock.mockResolvedValueOnce(token()).mockResolvedValueOnce(json({ total: 0 }));
  expect(await searchByKeywords("nothing", { used: true })).toEqual([]);
});

test("rejected credentials give an actionable error", async () => {
  fetchMock.mockResolvedValueOnce(json({ error: "invalid_client" }, 401));
  await expect(searchByKeywords("x", { used: true })).rejects.toThrow("EBAY_CLIENT_ID");
});
