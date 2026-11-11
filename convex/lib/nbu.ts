// National Bank of Ukraine official rate. Mocked in tests.

const NBU_URL = "https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json";

export async function fetchUsdUah(): Promise<number> {
  const res = await fetch(NBU_URL);
  const json = (await res.json().catch(() => null)) as { rate?: unknown }[] | null;
  const rate = Array.isArray(json) ? json[0]?.rate : undefined;
  if (!res.ok || typeof rate !== "number" || !(rate > 0)) {
    throw new Error(`NBU rate unavailable (HTTP ${res.status})`);
  }
  return rate;
}

/** YYYY-MM-DD in Kyiv time — NBU publishes one rate per Kyiv calendar day. */
export function kyivDate(nowMs: number): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Kyiv",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(nowMs));
}
