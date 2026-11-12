import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import Studio from "./Studio";

vi.mock("../lib/telegram", () => ({
  getInitData: vi.fn(() => "signed"),
  startMiniApp: vi.fn(),
  closeMiniApp: vi.fn(),
}));
vi.mock("../lib/studioApi", () => ({ loadItem: vi.fn(), saveProcessed: vi.fn() }));
vi.mock("../lib/removeBackground", () => ({ removeBackground: vi.fn() }));
vi.mock("../lib/compose", () => ({
  composeOnBackground: vi.fn(),
  prepareCutout: vi.fn(),
  renderInto: vi.fn(),
  PREVIEW_SIZE: 480,
}));

import { getInitData } from "../lib/telegram";
import { loadItem, saveProcessed } from "../lib/studioApi";
import { removeBackground } from "../lib/removeBackground";
import { composeOnBackground, prepareCutout, renderInto } from "../lib/compose";

const item = {
  title: "Чоботи Chloé Betty",
  photos: [
    { storageId: "s1", url: "https://cdn/1.jpg" },
    { storageId: "s2", url: "https://cdn/2.jpg" },
  ],
  studio: [],
};

beforeEach(() => {
  vi.mocked(loadItem).mockResolvedValue(item);
  vi.mocked(removeBackground).mockImplementation(
    async (b) => new Blob(["cut:", b], { type: "image/png" }),
  );
  vi.mocked(composeOnBackground).mockImplementation(
    async (_b, settings) => new Blob([settings.background], { type: "image/jpeg" }),
  );
  vi.mocked(prepareCutout).mockImplementation(async () => ({ pixels: {} as ImageData }));
  localStorage.clear();
  vi.mocked(saveProcessed).mockResolvedValue();
  // jsdom Blobs have no stream(), so new Response(blob) fails there.
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => ({ blob: async () => new Blob([url]) })),
  );
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const renderStudio = (path = "/studio?item=item1") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Studio />
    </MemoryRouter>,
  );

test("outside Telegram it asks to open the page from the bot", () => {
  vi.mocked(getInitData).mockReturnValueOnce("");
  renderStudio();
  expect(screen.getByText(/Откройте эту страницу из бота/)).toBeInTheDocument();
  expect(loadItem).not.toHaveBeenCalled();
});

test("shows the item and its photos, the first one selected", async () => {
  renderStudio();
  expect(await screen.findByText("Чоботи Chloé Betty")).toBeInTheDocument();
  expect(loadItem).toHaveBeenCalledWith("signed", "item1");
  const boxes = screen.getAllByRole("checkbox", { name: /Обработать фото/ });
  expect(boxes).toHaveLength(2);
  expect(boxes[0]).toBeChecked();
  expect(boxes[1]).not.toBeChecked();
});

test("processes the selected photos on the chosen background and saves them", async () => {
  const user = userEvent.setup();
  renderStudio();
  await screen.findByText("Чоботи Chloé Betty");
  await user.click(screen.getAllByRole("checkbox", { name: /Обработать фото/ })[1]);
  await user.click(screen.getByRole("button", { name: "Бежевый" }));
  await user.click(screen.getByRole("button", { name: "Обработать" }));

  await screen.findByRole("button", { name: "Сохранить" });
  expect(removeBackground).toHaveBeenCalledTimes(2);
  expect(prepareCutout).toHaveBeenCalledTimes(2);
  expect(composeOnBackground).not.toHaveBeenCalled();
  expect(screen.getByRole("img", { name: "После 1" }).tagName).toBe("CANVAS");

  await user.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(saveProcessed).toHaveBeenCalled());
  expect(vi.mocked(composeOnBackground).mock.calls.map((c) => c[1].background)).toEqual([
    "#efe6da",
    "#efe6da",
  ]);
  const [initData, itemId, blobs, keep] = vi.mocked(saveProcessed).mock.calls[0];
  expect([initData, itemId, blobs.length, keep]).toEqual(["signed", "item1", 2, []]);
  expect(await screen.findByText(/Готово/)).toBeInTheDocument();
});

test("changing the background redraws the live preview, no model run, no full render", async () => {
  const user = userEvent.setup();
  renderStudio();
  await screen.findByText("Чоботи Chloé Betty");
  await user.click(screen.getByRole("button", { name: "Обработать" }));
  await screen.findByRole("button", { name: "Сохранить" });
  await user.click(screen.getByRole("button", { name: "Чёрный" }));
  await waitFor(() =>
    expect(renderInto).toHaveBeenLastCalledWith(
      expect.any(HTMLCanvasElement),
      expect.anything(),
      expect.objectContaining({ background: "#111111" }),
      480,
    ),
  );
  expect(removeBackground).toHaveBeenCalledTimes(1);
  expect(composeOnBackground).not.toHaveBeenCalled();
});

test("an error is shown as text", async () => {
  const user = userEvent.setup();
  vi.mocked(removeBackground).mockRejectedValueOnce(new Error("нет памяти"));
  renderStudio();
  await screen.findByText("Чоботи Chloé Betty");
  await user.click(screen.getByRole("button", { name: "Обработать" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("нет памяти");
});

test("a load failure is shown", async () => {
  vi.mocked(loadItem).mockRejectedValueOnce(new Error("Обработать можно только черновик"));
  renderStudio();
  expect(await screen.findByRole("alert")).toHaveTextContent("только черновик");
});

test("earlier processed photos are shown and kept unless unticked", async () => {
  const user = userEvent.setup();
  vi.mocked(loadItem).mockResolvedValueOnce({
    ...item,
    studio: [
      { storageId: "p1", url: "https://cdn/p1.jpg" },
      { storageId: "p2", url: "https://cdn/p2.jpg" },
    ],
  });
  renderStudio();
  await screen.findByText(/Уже обработаны/);
  await user.click(screen.getByRole("checkbox", { name: "Оставить обработанное 1" }));
  await user.click(screen.getByRole("button", { name: "Обработать" }));
  await user.click(await screen.findByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(saveProcessed).toHaveBeenCalled());
  expect(vi.mocked(saveProcessed).mock.calls[0][3]).toEqual(["p2"]);
});

test("more than 10 processed photos in total blocks saving", async () => {
  const user = userEvent.setup();
  vi.mocked(loadItem).mockResolvedValueOnce({
    ...item,
    studio: Array.from({ length: 10 }, (_, i) => ({
      storageId: `p${i}`,
      url: `https://cdn/p${i}.jpg`,
    })),
  });
  renderStudio();
  await screen.findByText(/Уже обработаны/);
  await user.click(screen.getByRole("button", { name: "Обработать" }));
  expect(await screen.findByRole("button", { name: "Сохранить" })).toBeDisabled();
  expect(screen.getByText(/можно не больше 10/)).toBeInTheDocument();
});

test("a server error shows only its message for the owner", async () => {
  const { ConvexError } = await import("convex/values");
  vi.mocked(loadItem).mockRejectedValueOnce(
    new ConvexError("Студия доступна только владельцу бота"),
  );
  renderStudio();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /^Студия доступна только владельцу бота$/,
  );
});

test("quality settings: defaults are automatic, sliders redo the preview and are remembered", async () => {
  const user = userEvent.setup();
  const { fireEvent } = await import("@testing-library/react");
  renderStudio();
  await screen.findByText("Чоботи Chloé Betty");
  await user.click(screen.getByRole("button", { name: "Обработать" }));
  await screen.findByRole("button", { name: "Сохранить" });
  await waitFor(() =>
    expect(vi.mocked(renderInto).mock.calls.at(-1)?.[2]).toMatchObject({
      auto: true,
      sharpness: 30,
      shadow: true,
    }),
  );

  await user.click(screen.getByText("Настройки качества"));
  fireEvent.change(screen.getByRole("slider", { name: /Резкость/ }), { target: { value: "70" } });
  await user.click(screen.getByRole("checkbox", { name: "Тень под вещью" }));
  await waitFor(() =>
    expect(vi.mocked(renderInto).mock.calls.at(-1)?.[2]).toMatchObject({
      sharpness: 70,
      shadow: false,
    }),
  );
  expect(removeBackground).toHaveBeenCalledTimes(1);

  // The saved picture uses exactly what the preview showed.
  await user.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(saveProcessed).toHaveBeenCalled());
  expect(vi.mocked(composeOnBackground).mock.calls[0][1]).toMatchObject({
    sharpness: 70,
    shadow: false,
  });
  expect(JSON.parse(localStorage.getItem("multishop.studio.settings")!)).toMatchObject({
    sharpness: 70,
    shadow: false,
  });
});

test("reset brings the settings back to automatic defaults", async () => {
  const user = userEvent.setup();
  localStorage.setItem("multishop.studio.settings", JSON.stringify({ sharpness: 90, auto: false }));
  renderStudio();
  await screen.findByText("Чоботи Chloé Betty");
  await user.click(screen.getByText("Настройки качества"));
  expect(screen.getByRole("checkbox", { name: /Авто-коррекция/ })).not.toBeChecked();
  await user.click(screen.getByRole("button", { name: "Сбросить настройки" }));
  expect(screen.getByRole("checkbox", { name: /Авто-коррекция/ })).toBeChecked();
  expect(screen.getByRole("slider", { name: /Резкость/ })).toHaveValue("30");
});
