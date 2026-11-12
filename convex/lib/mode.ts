/**
 * Manual mode: no Anthropic key yet, so photos wait for Claude in the owner's chat session,
 * which reads the queue and submits drafts with `npx convex run manual:…`.
 * Setting ANTHROPIC_API_KEY switches the bot to automatic analysis.
 */
export function isManualMode(): boolean {
  return process.env.ANALYZER_MODE === "manual" || !process.env.ANTHROPIC_API_KEY;
}
