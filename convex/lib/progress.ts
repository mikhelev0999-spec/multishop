// "How long is left" for the bot's waiting message. Pure, so it is tested without Telegram.

const BAR_CELLS = 10;
/** The bar stops short of full until the result is really there. */
const MAX_SHARE_WHILE_WAITING = 0.95;
/** Durations outside this range are glitches (clock skew, an item left for hours). */
const PLAUSIBLE_MS = { min: 1_000, max: 60 * 60 * 1000 };

export function progressBar(share: number): string {
  const filled = Math.round(Math.min(1, Math.max(0, share)) * BAR_CELLS);
  return "▓".repeat(filled) + "░".repeat(BAR_CELLS - filled);
}

/** Rounded up to 5 s under a minute (better to promise a bit more), to whole minutes above. */
export function formatLeft(ms: number): string {
  const s = Math.max(1, ms / 1000);
  if (s < 60) return `≈ ${Math.max(5, Math.ceil(s / 5) * 5)} с`;
  return `≈ ${Math.round(s / 60)} мин`;
}

/** Median of recent analysis durations, or the fallback when there is no sensible history. */
export function estimateMs(durations: number[], fallbackMs: number): number {
  const ok = durations
    .filter((d) => d >= PLAUSIBLE_MS.min && d <= PLAUSIBLE_MS.max)
    .sort((a, b) => a - b);
  if (ok.length === 0) return fallbackMs;
  const mid = Math.floor(ok.length / 2);
  return ok.length % 2 ? ok[mid] : Math.round((ok[mid - 1] + ok[mid]) / 2);
}

export function progressText(p: { photos: number; elapsedMs: number; etaMs: number }): string {
  const share = Math.min(MAX_SHARE_WHILE_WAITING, p.elapsedMs / p.etaMs);
  const left = p.etaMs - p.elapsedMs;
  return [
    `⏳ Разбираю фото (${p.photos})…`,
    `${progressBar(share)} ${Math.round(share * 100)}%`,
    left > 2_000 ? `Осталось ${formatLeft(left)}` : "Почти готово, ещё чуть-чуть…",
  ].join("\n");
}
