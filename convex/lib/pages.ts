// Small HTML pages served from Convex HTTP routes: OAuth results and the privacy policy.
import { esc } from "./botTexts";

const STYLE = `
  :root { color-scheme: light dark; --bg: #f4f4f7; --card: #fff; --text: #111; --hint: #6b6b76; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #17171c; --card: #22222a; --text: #f2f2f5; --hint: #9a9aa6; }
  }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 640px; margin: 0 auto; padding: 32px 16px; }
  .card { background: var(--card); border-radius: 16px; padding: 24px; }
  h1 { font-size: 22px; margin: 0 0 12px; }
  h2 { font-size: 17px; margin: 20px 0 6px; }
  p, li { color: var(--text); } .hint { color: var(--hint); font-size: 14px; }
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title><style>${STYLE}</style></head>
<body><main><div class="card">${body}</div></main></body></html>`;
}

/** A one-message page, e.g. "OLX подключён — вернитесь в Telegram". */
export function messagePage(title: string, text: string): string {
  return page(
    title,
    `<h1>${esc(title)}</h1><p>${esc(text)}</p><p class="hint">Эту вкладку можно закрыть.</p>`,
  );
}

export function privacyPage(): string {
  return page(
    "Multishop — Privacy Policy",
    `<h1>Multishop — Privacy Policy</h1>
<p class="hint">Last updated: 12 November 2026</p>
<p>Multishop is a private tool used by one person, its owner, to prepare and publish listings
of their own used items on marketplaces (eBay, OLX). It is not offered to other users.</p>
<h2>What is stored</h2>
<ul>
<li>Photos and descriptions of the owner's items, and the listings drafted from them.</li>
<li>Access tokens that eBay or OLX issue when the owner connects an account. They are used
only to manage the owner's own listings.</li>
<li>Public prices of comparable items, used to suggest a price.</li>
</ul>
<h2>What is not done</h2>
<p>No data of other eBay or OLX users is collected, stored, sold or shared. No advertising or
tracking is used.</p>
<h2>Where and how long</h2>
<p>Data is kept in the owner's Convex database until the owner deletes it. Disconnecting an
account deletes its tokens.</p>
<h2>Contact and deletion</h2>
<p>To delete data, the owner deletes it in the Telegram bot or the database. Questions: write
to the owner through the marketplace where you saw the listing.</p>`,
  );
}
