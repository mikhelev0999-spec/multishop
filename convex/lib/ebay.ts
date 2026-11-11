// eBay Browse API: comparable active listings for price research. Mocked in tests.
import type { Comparable } from "./validators";

const API = "https://api.ebay.com";
const MARKETPLACE = "EBAY_US";
const USED_CONDITION_ID = 3000;

let cached: { token: string; expiresAt: number } | null = null;

export function resetTokenCache(): void {
  cached = null;
}

async function appToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now()) return cached.token;
  const id = process.env.EBAY_CLIENT_ID;
  const secret = process.env.EBAY_CLIENT_SECRET;
  if (!id || !secret) throw new Error("EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set");
  const res = await fetch(`${API}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${id}:${secret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      scope: "https://api.ebay.com/oauth/api_scope",
    }).toString(),
  });
  if (res.status === 401 || res.status === 400) {
    throw new Error("eBay rejected the credentials — check EBAY_CLIENT_ID / EBAY_CLIENT_SECRET (Production keys)");
  }
  if (!res.ok) throw new Error(`eBay token request failed: HTTP ${res.status}`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in - 60) * 1000 };
  return json.access_token;
}

async function browse(path: string, init: RequestInit = {}): Promise<Comparable[]> {
  const res = await fetch(`${API}/buy/browse/v1${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${await appToken()}`,
      "x-ebay-c-marketplace-id": MARKETPLACE,
      "content-type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`eBay search failed: HTTP ${res.status}`);
  return parseSummaries(await res.json());
}

interface Summary {
  title?: string;
  price?: { value?: string; currency?: string };
  itemWebUrl?: string;
  condition?: string;
}

function parseSummaries(json: unknown): Comparable[] {
  const list = (json as { itemSummaries?: Summary[] })?.itemSummaries ?? [];
  const out: Comparable[] = [];
  for (const s of list) {
    const priceUsd = Number(s.price?.value);
    if (!s.title || !s.itemWebUrl || s.price?.currency !== "USD" || !(priceUsd > 0)) continue;
    out.push({
      title: s.title,
      priceUsd,
      url: s.itemWebUrl,
      ...(s.condition ? { condition: s.condition } : {}),
    });
  }
  return out;
}

export async function searchByKeywords(query: string, opts: { used: boolean }): Promise<Comparable[]> {
  const filter = ["buyingOptions:{FIXED_PRICE}"];
  if (opts.used) filter.push(`conditionIds:{${USED_CONDITION_ID}}`);
  const params = new URLSearchParams({ q: query, limit: "30", filter: filter.join(",") });
  return browse(`/item_summary/search?${params}`);
}

export async function searchByImage(base64: string): Promise<Comparable[]> {
  return browse("/item_summary/search_by_image?limit=30", {
    method: "POST",
    body: JSON.stringify({ image: base64 }),
  });
}
