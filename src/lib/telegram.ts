// Thin wrapper over the Telegram Mini App script (loaded in index.html).

interface WebApp {
  initData: string;
  ready(): void;
  expand(): void;
  close(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  HapticFeedback?: {
    notificationOccurred(type: "success" | "error" | "warning"): void;
    selectionChanged(): void;
  };
}

function webApp(): WebApp | undefined {
  return (window as unknown as { Telegram?: { WebApp?: WebApp } }).Telegram?.WebApp;
}

/** Signed data Convex checks; empty outside Telegram. */
export function getInitData(): string {
  return webApp()?.initData ?? "";
}

export function startMiniApp(): void {
  const app = webApp();
  app?.ready();
  app?.expand();
  // Blend the Telegram header with the page background. Older clients lack these.
  try {
    app?.setHeaderColor?.("secondary_bg_color");
    app?.setBackgroundColor?.("secondary_bg_color");
  } catch {
    // Not supported by this Telegram version.
  }
}

export function closeMiniApp(): void {
  webApp()?.close();
}

/** A short vibration on phones that support it. */
export function haptic(kind: "success" | "error" | "select"): void {
  try {
    const h = webApp()?.HapticFeedback;
    if (kind === "select") h?.selectionChanged();
    else h?.notificationOccurred(kind);
  } catch {
    // Not supported by this Telegram version.
  }
}
