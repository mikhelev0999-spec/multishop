import { afterEach, expect, test, vi } from "vitest";
import { fetchUsdUah, kyivDate } from "./nbu";

afterEach(() => vi.unstubAllGlobals());

test("fetchUsdUah reads the rate from the NBU response", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify([{ r030: 840, txt: "Долар США", rate: 41.3725, cc: "USD" }])),
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(await fetchUsdUah()).toBe(41.3725);
  expect(String(fetchMock.mock.calls[0][0])).toBe(
    "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json",
  );
});

test("fetchUsdUah throws on an unexpected response", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]")));
  await expect(fetchUsdUah()).rejects.toThrow("NBU");
});

test("kyivDate uses the Kyiv calendar day", () => {
  // 22:30 UTC on Nov 11 is already Nov 12 in Kyiv (UTC+2 in winter).
  expect(kyivDate(Date.UTC(2026, 10, 11, 22, 30))).toBe("2026-11-12");
  expect(kyivDate(Date.UTC(2026, 10, 11, 12, 0))).toBe("2026-11-11");
});
