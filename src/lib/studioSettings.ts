// Photo studio look settings, remembered on the owner's phone between sessions.

export interface StudioSettings {
  background: string;
  /** Automatic light/contrast correction (per-channel levels). */
  auto: boolean;
  /** 0…100; 30 is a light touch. */
  sharpness: number;
  /** −50…50, 0 = unchanged. */
  brightness: number;
  contrast: number;
  saturation: number;
  shadow: boolean;
  /** Margin around the item, % of the picture side on each edge: 0…20. */
  padding: number;
}

export const DEFAULT_SETTINGS: StudioSettings = {
  background: "#ffffff",
  auto: true,
  sharpness: 30,
  brightness: 0,
  contrast: 0,
  saturation: 0,
  shadow: true,
  padding: 8,
};

const STORAGE_KEY = "multishop.studio.settings";

const clamp = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v)
    ? Math.min(max, Math.max(min, Math.round(v)))
    : fallback;
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/** Saved JSON → settings; anything missing or invalid falls back to the default for that field. */
export function parseSettings(raw: string | null): StudioSettings {
  let s: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") s = parsed as Record<string, unknown>;
  } catch {
    s = {};
  }
  const d = DEFAULT_SETTINGS;
  return {
    background:
      typeof s.background === "string" && /^#[0-9a-f]{6}$/i.test(s.background)
        ? s.background
        : d.background,
    auto: bool(s.auto, d.auto),
    sharpness: clamp(s.sharpness, 0, 100, d.sharpness),
    brightness: clamp(s.brightness, -50, 50, d.brightness),
    contrast: clamp(s.contrast, -50, 50, d.contrast),
    saturation: clamp(s.saturation, -50, 50, d.saturation),
    shadow: bool(s.shadow, d.shadow),
    padding: clamp(s.padding, 0, 20, d.padding),
  };
}

export function loadSettings(): StudioSettings {
  try {
    return parseSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: StudioSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private mode or blocked storage: settings just aren't remembered.
  }
}
