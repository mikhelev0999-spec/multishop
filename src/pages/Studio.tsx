import { useEffect, useRef, useState, type ReactNode } from "react";
import { ConvexError } from "convex/values";
import { useSearchParams } from "react-router";
import {
  composeOnBackground,
  prepareCutout,
  PREVIEW_SIZE,
  renderInto,
  type Prepared,
} from "../lib/compose";
import { removeBackground } from "../lib/removeBackground";
import { loadItem, saveProcessed, type StudioItem } from "../lib/studioApi";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  type StudioSettings,
} from "../lib/studioSettings";
import { closeMiniApp, getInitData, haptic, startMiniApp } from "../lib/telegram";

const BACKGROUNDS = [
  { name: "Белый", color: "#ffffff" },
  { name: "Светло-серый", color: "#f2f2f2" },
  { name: "Бежевый", color: "#efe6da" },
  { name: "Чёрный", color: "#111111" },
];
const MAX_PHOTOS = 10;

interface Result {
  originalUrl: string;
  cutout: Blob;
  /** Small cropped copy for the live preview; the full-size picture is made on save. */
  preview: Prepared;
}

type Phase = "loading" | "ready" | "working" | "processed" | "saving" | "saved";

// Server errors meant for the owner come as ConvexError data; anything else is shown as is.
const message = (e: unknown) =>
  e instanceof ConvexError ? String(e.data) : e instanceof Error ? e.message : String(e);

export default function Studio() {
  const [params] = useSearchParams();
  const itemId = params.get("item") ?? "";
  const [initData] = useState(getInitData);

  const [item, setItem] = useState<StudioItem | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set([0]));
  const [keep, setKeep] = useState<Set<string>>(new Set());
  const [settings, setSettings] = useState<StudioSettings>(loadSettings);
  const [results, setResults] = useState<Result[]>([]);
  const [phase, setPhase] = useState<Phase>("loading");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  useEffect(() => saveSettings(settings), [settings]);

  useEffect(() => {
    if (!initData || !itemId) return;
    startMiniApp();
    loadItem(initData, itemId)
      .then((loaded) => {
        setItem(loaded);
        setKeep(new Set(loaded.studio.map((p) => p.storageId)));
        setPhase("ready");
      })
      .catch((e) => setError(message(e)));
  }, [initData, itemId]);

  const update = (patch: Partial<StudioSettings>) => setSettings((prev) => ({ ...prev, ...patch }));

  if (!initData || !itemId) {
    return (
      <Screen>
        <Empty icon="🎨" title="Фотостудия">
          Откройте эту страницу из бота в Telegram — кнопкой «🎨 Обработать фото».
        </Empty>
      </Screen>
    );
  }

  const toggleSelected = (i: number) => {
    haptic("select");
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };
  const toggleKeep = (id: string) =>
    setKeep((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  async function process() {
    if (!item) return;
    setError("");
    setPhase("working");
    const chosen = item.photos.filter((_, i) => selected.has(i));
    const out: Result[] = [];
    try {
      for (const [n, photo] of chosen.entries()) {
        setStatus(`Фото ${n + 1} из ${chosen.length}: убираю фон…`);
        const res = await fetch(photo.url);
        if ("ok" in res && !res.ok) throw new Error(`Не удалось скачать фото ${n + 1}`);
        const original = await res.blob();
        const cutout = await removeBackground(original, (done, total) => {
          if (total > 0 && done < total) {
            setStatus(
              `Загружаю модель: ${Math.round((done / total) * 100)}% (только в первый раз)`,
            );
          }
        });
        out.push({
          originalUrl: photo.url,
          cutout,
          preview: await prepareCutout(cutout, PREVIEW_SIZE),
        });
      }
      setResults(out);
      setPhase("processed");
      haptic("success");
    } catch (e) {
      setError(message(e));
      setPhase("ready");
      haptic("error");
    } finally {
      setStatus("");
    }
  }

  const total = keep.size + results.length;

  async function save() {
    setError("");
    setPhase("saving");
    try {
      const outputs: Blob[] = [];
      for (const [n, r] of results.entries()) {
        setStatus(`Готовлю фото ${n + 1} из ${results.length} в полном размере…`);
        outputs.push(await composeOnBackground(r.cutout, settings));
      }
      setStatus("Сохраняю…");
      await saveProcessed(initData, itemId, outputs, [...keep]);
      setPhase("saved");
      haptic("success");
      setTimeout(closeMiniApp, 1500);
    } catch (e) {
      setError(message(e));
      setPhase("processed");
      haptic("error");
    } finally {
      setStatus("");
    }
  }

  const busy = phase === "working" || phase === "saving";
  const showResults = phase === "processed" || phase === "saving" || phase === "saved";

  if (phase === "saved") {
    return (
      <Screen>
        <Empty icon="✅" title="Готово">
          Фото сохранены — бот пришлёт их в чат.
        </Empty>
      </Screen>
    );
  }

  return (
    <Screen
      footer={
        item &&
        (showResults ? (
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => setPhase("ready")}
              className="rounded-xl bg-tg-section px-5 py-3.5 font-medium text-tg-accent disabled:opacity-50"
            >
              Назад
            </button>
            <MainButton
              disabled={busy || total > MAX_PHOTOS}
              onClick={save}
              busy={phase === "saving"}
            >
              Сохранить
            </MainButton>
          </div>
        ) : (
          <MainButton
            disabled={busy || selected.size === 0}
            onClick={process}
            busy={phase === "working"}
          >
            Обработать
          </MainButton>
        ))
      }
    >
      {error && (
        <p role="alert" className="rounded-2xl bg-tg-section p-4 text-sm text-tg-destructive">
          {error}
        </p>
      )}

      {!item && !error && <Spinner label="Загружаю…" />}

      {item && (
        <>
          <header className="px-1 pt-2">
            <p className="text-xs font-medium tracking-wide text-tg-hint uppercase">Фотостудия</p>
            <h1 className="mt-1 text-xl leading-tight font-semibold">{item.title}</h1>
          </header>

          {status && (
            <div
              aria-live="polite"
              className="flex items-center gap-3 rounded-2xl bg-tg-section p-4"
            >
              <Dots />
              <span className="text-sm">{status}</span>
            </div>
          )}

          {showResults ? (
            <Section
              title={results.length > 1 ? `Результат · ${results.length} фото` : "Результат"}
            >
              <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-1">
                {results.map((r, i) => (
                  <figure key={r.originalUrl} className="relative w-full shrink-0 snap-center">
                    <LivePreview
                      prepared={r.preview}
                      settings={settings}
                      label={`После ${i + 1}`}
                    />
                    <img
                      src={r.originalUrl}
                      alt={`До ${i + 1}`}
                      className="absolute bottom-2 left-2 h-16 w-16 rounded-lg border-2 border-white object-cover shadow-md"
                    />
                  </figure>
                ))}
              </div>
              {results.length > 1 && (
                <p className="mt-2 text-center text-xs text-tg-hint">
                  Листайте вбок, чтобы посмотреть все
                </p>
              )}
            </Section>
          ) : (
            <Section
              title="Какие фото обработать"
              hint="Фото не покидают телефон, пока вы не нажмёте «Сохранить»."
            >
              <ul className="grid grid-cols-3 gap-2">
                {item.photos.map((p, i) => (
                  <li key={p.storageId}>
                    <label className="relative block cursor-pointer">
                      <input
                        type="checkbox"
                        aria-label={`Обработать фото ${i + 1}`}
                        checked={selected.has(i)}
                        disabled={busy}
                        onChange={() => toggleSelected(i)}
                        className="peer sr-only"
                      />
                      <img
                        src={p.url}
                        alt={`Фото ${i + 1}`}
                        className="aspect-square w-full rounded-xl object-cover opacity-60 transition peer-checked:opacity-100 peer-checked:ring-3 peer-checked:ring-tg-accent"
                      />
                      <span
                        aria-hidden
                        className={`absolute top-1.5 right-1.5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-xs font-bold text-white shadow ${
                          selected.has(i) ? "bg-tg-accent" : "bg-black/25"
                        }`}
                      >
                        {selected.has(i) ? "✓" : ""}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
              {phase === "ready" && (
                <p className="mt-3 text-xs text-tg-hint">
                  Первый раз телефон скачает модель (~40 МБ) — это может занять минуту.
                </p>
              )}
            </Section>
          )}

          <Section title="Фон">
            <div className="flex items-center gap-3">
              {BACKGROUNDS.map((b) => (
                <button
                  key={b.color}
                  type="button"
                  aria-label={b.name}
                  aria-pressed={settings.background === b.color}
                  disabled={busy}
                  onClick={() => {
                    haptic("select");
                    update({ background: b.color });
                  }}
                  className={`h-10 w-10 rounded-full border border-tg-separator shadow-inner transition ${
                    settings.background === b.color
                      ? "ring-3 ring-tg-accent ring-offset-2 ring-offset-tg-section"
                      : ""
                  }`}
                  style={{ background: b.color }}
                />
              ))}
              <label
                className="relative flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border border-tg-separator text-lg"
                style={{
                  background:
                    "conic-gradient(#f44336, #ffeb3b, #4caf50, #00bcd4, #3f51b5, #e91e63, #f44336)",
                }}
                title="Свой цвет"
              >
                <span className="sr-only">Свой цвет</span>
                <input
                  type="color"
                  value={settings.background}
                  disabled={busy}
                  onChange={(e) => update({ background: e.target.value })}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
            </div>
          </Section>

          <details className="group rounded-2xl bg-tg-section">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3.5 font-medium">
              Настройки качества
              <span className="text-tg-hint transition group-open:rotate-90">›</span>
            </summary>
            <div className="space-y-4 border-t border-tg-separator px-4 pt-3 pb-4 text-sm">
              <Toggle
                label="Авто-коррекция света и цвета"
                checked={settings.auto}
                disabled={busy}
                onChange={(auto) => update({ auto })}
              />
              <Slider
                label="Резкость"
                value={settings.sharpness}
                min={0}
                max={100}
                disabled={busy}
                onChange={(v) => update({ sharpness: v })}
              />
              <Slider
                label="Яркость"
                value={settings.brightness}
                min={-50}
                max={50}
                disabled={busy}
                onChange={(v) => update({ brightness: v })}
              />
              <Slider
                label="Контраст"
                value={settings.contrast}
                min={-50}
                max={50}
                disabled={busy}
                onChange={(v) => update({ contrast: v })}
              />
              <Slider
                label="Насыщенность"
                value={settings.saturation}
                min={-50}
                max={50}
                disabled={busy}
                onChange={(v) => update({ saturation: v })}
              />
              <Slider
                label="Поля вокруг вещи, %"
                value={settings.padding}
                min={0}
                max={20}
                disabled={busy}
                onChange={(v) => update({ padding: v })}
              />
              <Toggle
                label="Тень под вещью"
                checked={settings.shadow}
                disabled={busy}
                onChange={(shadow) => update({ shadow })}
              />
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setSettings({ ...DEFAULT_SETTINGS, background: settings.background })
                }
                className="w-full rounded-xl py-2.5 font-medium text-tg-accent"
              >
                Сбросить настройки
              </button>
            </div>
          </details>

          {item.studio.length > 0 && (
            <Section
              title="Уже обработаны"
              hint="Снимите галочку, чтобы удалить фото при сохранении."
            >
              <ul className="grid grid-cols-4 gap-2">
                {item.studio.map((p, i) => (
                  <li key={p.storageId}>
                    <label className="relative block cursor-pointer">
                      <input
                        type="checkbox"
                        aria-label={`Оставить обработанное ${i + 1}`}
                        checked={keep.has(p.storageId)}
                        disabled={busy}
                        onChange={() => toggleKeep(p.storageId)}
                        className="peer sr-only"
                      />
                      <img
                        src={p.url}
                        alt={`Обработанное ${i + 1}`}
                        className="aspect-square w-full rounded-lg object-cover opacity-40 transition peer-checked:opacity-100"
                      />
                      <span
                        aria-hidden
                        className={`absolute top-1 right-1 flex h-5 w-5 items-center justify-center rounded-full border-2 border-white text-[10px] font-bold text-white ${
                          keep.has(p.storageId) ? "bg-tg-accent" : "bg-black/25"
                        }`}
                      >
                        {keep.has(p.storageId) ? "✓" : ""}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {showResults && total > MAX_PHOTOS && (
            <p className="rounded-2xl bg-tg-section p-4 text-sm text-tg-destructive">
              Всего обработанных фото будет {total}, а можно не больше {MAX_PHOTOS} — снимите
              галочки у старых.
            </p>
          )}
        </>
      )}
    </Screen>
  );
}

/** Redrawn on every settings change, at most once per animation frame. */
function LivePreview(props: { prepared: Prepared; settings: StudioSettings; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const { prepared, settings } = props;
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (ref.current) renderInto(ref.current, prepared, settings, PREVIEW_SIZE);
    });
    return () => cancelAnimationFrame(frame);
  }, [prepared, settings]);
  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={props.label}
      className="aspect-square w-full rounded-xl shadow-sm"
      width={PREVIEW_SIZE}
      height={PREVIEW_SIZE}
    />
  );
}

function Screen({ children, footer }: { children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="min-h-screen bg-tg-secondary">
      <main className={`mx-auto max-w-xl space-y-3 p-3 ${footer ? "pb-28" : ""}`}>{children}</main>
      {footer && (
        <div className="fixed inset-x-0 bottom-0 bg-tg-secondary/90 px-3 pt-2 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur">
          <div className="mx-auto max-w-xl">{footer}</div>
        </div>
      )}
    </div>
  );
}

function Section(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={props.title} className="rounded-2xl bg-tg-section p-4">
      <h2 className="mb-3 text-xs font-medium tracking-wide text-tg-hint uppercase">
        {props.title}
      </h2>
      {props.children}
      {props.hint && <p className="mt-3 text-xs text-tg-hint">{props.hint}</p>}
    </section>
  );
}

function MainButton(props: {
  children: ReactNode;
  disabled: boolean;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex flex-1 w-full items-center justify-center gap-2 rounded-xl bg-tg-accent py-3.5 font-semibold text-tg-accent-text transition active:scale-[0.98] disabled:opacity-50"
    >
      {props.busy && <Dots light />}
      {props.children}
    </button>
  );
}

function Toggle(props: {
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3">
      <span>{props.label}</span>
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="relative h-7 w-12 shrink-0 rounded-full bg-tg-separator transition peer-checked:bg-tg-accent after:absolute after:top-0.5 after:left-0.5 after:h-6 after:w-6 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-5"
      />
    </label>
  );
}

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between">
        <span>{props.label}</span>
        <span className="text-tg-hint tabular-nums">{props.value}</span>
      </span>
      <input
        type="range"
        className="w-full"
        min={props.min}
        max={props.max}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

function Empty(props: { icon: string; title: string; children: ReactNode }) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-center">
      <div className="text-6xl">{props.icon}</div>
      <h1 className="text-xl font-semibold">{props.title}</h1>
      <p className="max-w-xs text-sm text-tg-hint">{props.children}</p>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-tg-hint">
      <Dots />
      <p className="text-sm">{label}</p>
    </div>
  );
}

function Dots({ light }: { light?: boolean }) {
  return (
    <span aria-hidden className="inline-flex gap-1">
      {[0, 150, 300].map((delay) => (
        <span
          key={delay}
          className={`h-1.5 w-1.5 animate-bounce rounded-full ${light ? "bg-tg-accent-text" : "bg-tg-accent"}`}
          style={{ animationDelay: `${delay}ms` }}
        />
      ))}
    </span>
  );
}
