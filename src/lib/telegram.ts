// Thin wrapper over the Telegram Mini App script (loaded in index.html).

interface WebApp {
  initData: string;
  ready(): void;
  expand(): void;
  close(): void;
}

function webApp(): WebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;
}

/** Signed data Convex checks; empty outside Telegram. */
export function getInitData(): string {
  return webApp()?.initData ?? "";
}

export function startMiniApp(): void {
  webApp()?.ready();
  webApp()?.expand();
}

export function closeMiniApp(): void {
  webApp()?.close();
}
