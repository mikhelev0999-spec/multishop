import { useEffect, useRef, useState } from "react";
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
import { closeMiniApp, getInitData, startMiniApp } from "../lib/telegram";

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
      <Shell>
        <p>Откройте эту страницу из бота в Telegram — кнопкой «🎨 Обработать фото».</p>
      </Shell>
    );
  }

  const toggleSelected = (i: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
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
    } catch (e) {
      setError(message(e));
      setPhase("ready");
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
      setTimeout(closeMiniApp, 1500);
    } catch (e) {
      setError(message(e));
      setPhase("processed");
    } finally {
      setStatus("");
    }
  }

  const busy = phase === "working" || phase === "saving";
  const showResults = phase === "processed" || phase === "saving" || phase === "saved";

  return (
    <Shell>
      {error && (
        <p role="alert" className="rounded bg-red-50 p-3 text-red-700">
          {error}
        </p>
      )}
      {item && (
        <>
          <h1 className="text-lg font-semibold">{item.title}</h1>

          <section aria-label="Фон" className="flex flex-wrap gap-2">
            {BACKGROUNDS.map((b) => (
              <button
                key={b.color}
                type="button"
                disabled={busy}
                aria-pressed={settings.background === b.color}
                onClick={() => update({ background: b.color })}
                className={`rounded border px-3 py-1 text-sm ${settings.background === b.color ? "ring-2 ring-blue-500" : ""}`}
              >
                <span
                  className="mr-1 inline-block h-3 w-3 rounded-full border align-middle"
                  style={{ background: b.color }}
                />
                {b.name}
              </button>
            ))}
            <label className="flex items-center gap-1 text-sm">
              Свой
              <input
                type="color"
                value={settings.background}
                disabled={busy}
                onChange={(e) => update({ background: e.target.value })}
              />
            </label>
          </section>

          <details className="rounded border p-3">
            <summary className="cursor-pointer font-medium">Настройки качества</summary>
            <div className="mt-3 space-y-3 text-sm">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.auto}
                  disabled={busy}
                  onChange={(e) => update({ auto: e.target.checked })}
                />
                Авто-коррекция света и цвета
              </label>
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
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={settings.shadow}
                  disabled={busy}
                  onChange={(e) => update({ shadow: e.target.checked })}
                />
                Тень под вещью
              </label>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  setSettings({ ...DEFAULT_SETTINGS, background: settings.background })
                }
                className="rounded border px-3 py-1"
              >
                Сбросить настройки
              </button>
            </div>
          </details>

          {item.studio.length > 0 && (
            <section aria-label="Уже обработаны">
              <p className="text-sm">Уже обработаны (снимите галочку, чтобы удалить):</p>
              <ul className="grid grid-cols-4 gap-2">
                {item.studio.map((p, i) => (
                  <li key={p.storageId}>
                    <label className="block text-sm">
                      <img
                        src={p.url}
                        alt={`Обработанное ${i + 1}`}
                        className="aspect-square w-full rounded object-cover"
                      />
                      <input
                        type="checkbox"
                        aria-label={`Оставить обработанное ${i + 1}`}
                        checked={keep.has(p.storageId)}
                        disabled={busy || phase === "saved"}
                        onChange={() => toggleKeep(p.storageId)}
                      />{" "}
                      оставить
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {!showResults && (
            <>
              <ul className="grid grid-cols-3 gap-2">
                {item.photos.map((p, i) => (
                  <li key={p.storageId}>
                    <label className="block">
                      <img
                        src={p.url}
                        alt={`Фото ${i + 1}`}
                        className="aspect-square w-full rounded object-cover"
                      />
                      <input
                        type="checkbox"
                        aria-label={`Обработать фото ${i + 1}`}
                        checked={selected.has(i)}
                        disabled={busy}
                        onChange={() => toggleSelected(i)}
                        className="mt-1"
                      />{" "}
                      Фото {i + 1}
                    </label>
                  </li>
                ))}
              </ul>
              <p className="text-sm text-gray-500">
                Первый раз телефон скачает модель (~40 МБ) — это может занять минуту. Фото не
                покидают телефон, пока вы не нажмёте «Сохранить».
              </p>
              <button
                type="button"
                disabled={busy || selected.size === 0}
                onClick={process}
                className="w-full rounded bg-blue-600 py-3 font-semibold text-white disabled:opacity-50"
              >
                Обработать
              </button>
            </>
          )}

          {status && <p aria-live="polite">{status}</p>}

          {showResults && (
            <>
              <ul className="space-y-3">
                {results.map((r, i) => (
                  <li key={r.originalUrl} className="grid grid-cols-2 gap-2">
                    <img
                      src={r.originalUrl}
                      alt={`До ${i + 1}`}
                      className="aspect-square w-full rounded object-cover"
                    />
                    <LivePreview
                      prepared={r.preview}
                      settings={settings}
                      label={`После ${i + 1}`}
                    />
                  </li>
                ))}
              </ul>
              {total > MAX_PHOTOS && (
                <p className="text-sm text-red-700">
                  Всего обработанных фото будет {total}, а можно не больше {MAX_PHOTOS} — снимите
                  галочки у старых.
                </p>
              )}
              {phase === "saved" ? (
                <p className="font-semibold text-green-700">Готово — бот пришлёт фото в чат.</p>
              ) : (
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setPhase("ready")}
                    className="flex-1 rounded border py-3"
                  >
                    Назад
                  </button>
                  <button
                    type="button"
                    disabled={busy || total > MAX_PHOTOS}
                    onClick={save}
                    className="flex-1 rounded bg-blue-600 py-3 font-semibold text-white disabled:opacity-50"
                  >
                    Сохранить
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
      {!item && !error && <p>Загружаю…</p>}
    </Shell>
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
      className="aspect-square w-full rounded"
      width={PREVIEW_SIZE}
      height={PREVIEW_SIZE}
    />
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
      <span className="flex justify-between">
        <span>{props.label}</span>
        <span>{props.value}</span>
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

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto max-w-xl space-y-4 p-4">{children}</main>;
}
