# Multishop — этап 1 «Черновик из фото»: план реализации

**Goal:** Владелец шлёт боту в Telegram фото вещи; бот распознаёт вещь через Claude, ищет
аналоги на eBay, предлагает цену и присылает черновик объявления с кнопками «Выставить»,
«Изменить цену», «Изменить текст», «Отмена». Публикации на площадки в этом этапе нет:
«Выставить» присылает готовый текст для ручной вставки.

**Architecture:** Весь бэкенд — Convex. Вебхук Telegram (`convex/http.ts`) проверяет секрет
и владельца, записывает событие и сразу отвечает 200; долгая работа идёт в actions через
`ctx.scheduler`. Claude вызывается из action через `@anthropic-ai/sdk` циклом с
инструментами; итог — вызов инструмента `submit_draft` со строгой схемой (`strict: true`).
Внешние API (Telegram, Claude, eBay, курс НБУ) спрятаны за швами в `convex/lib/*`, в тестах
подменяются через `vi.mock`. Фронтенд в этом этапе не трогаем.

**Tech Stack:** как в этапе 0 + `@anthropic-ai/sdk` 1.x. Модель `claude-opus-5-5`, effort
`medium`, адаптивное мышление (параметр `thinking` не передаём — на этой модели оно всегда
включено), серверный fallback (`betas: ["server-side-fallback-2026-07-01"]`,
`fallbacks: "default"`).

**Spec:** `docs/superpowers/specs/2026-11-11-multishop-design.md` (разделы «Сценарий»,
«Архитектура», «Анализ цен», этап 1).

## Global Constraints

- Бот отвечает только `OWNER_TELEGRAM_ID`. Чужие апдейты — 200 без ответа и без записи.
- Тексты бота владельцу — на русском. Тексты объявления (`titleUk`, `descriptionUk`) — на
  украинском. Цена — в гривнах, для eBay дополнительно в долларах.
- Ничего не публикуется без нажатия «Выставить».
- В `convex/`: у каждой публичной функции `args` и `returns`; Telegram-, Claude- и
  eBay-вызовы только в actions; запросы к таблицам — через индексы (`.withIndex`), без
  `.filter()` по полю и без `.collect()` на растущих таблицах.
- Секреты только в env Convex: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
  `OWNER_TELEGRAM_ID`, `ANTHROPIC_API_KEY`, `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET`.
- Тесты до кода: красный → зелёный → коммит. Перед коммитом отдельно `npm test`,
  `npm run lint`, `npm run typecheck`, читать код выхода каждой.
- Сообщения коммитов — на русском.

---

## Карта файлов

| Файл | Ответственность |
|---|---|
| `convex/schema.ts` | таблицы `items`, `priceResearch`, `telegramUpdates`, `fxRates` |
| `convex/lib/validators.ts` | валидаторы статуса, состояния вещи, черновика |
| `convex/lib/telegramUpdate.ts` | чистый разбор апдейта Telegram в `Incoming` |
| `convex/lib/telegramApi.ts` | шов: `sendMessage`, `editMessageText`, `answerCallbackQuery`, `getFileBytes`, `setWebhook` |
| `convex/lib/draftMessage.ts` | чистое форматирование черновика, клавиатуры и текста «для вставки» |
| `convex/lib/pricing.ts` | чистые функции: квартили, медиана, перевод USD→UAH, разбор цены из текста |
| `convex/lib/ebay.ts` | шов: токен client credentials, `searchByKeywords`, `searchByImage` |
| `convex/lib/nbu.ts` | шов: курс USD/UAH НБУ |
| `convex/lib/claude.ts` | шов: `createMessage(params)` — тонкая обёртка над SDK |
| `convex/lib/agent.ts` | цикл с инструментами: промпт, схемы инструментов, разбор ответа |
| `convex/http.ts` | маршрут `POST /telegram` |
| `convex/telegram.ts` | `handleUpdate` (internal mutation), `setWebhook` (internal action) |
| `convex/items.ts` | internal-мутации и запросы по вещам |
| `convex/analyze.ts` | internal actions `start`, `rewrite`; отправка черновика |
| `convex/callbacks.ts` | обработка кнопок и текстовых ответов |

---

### Task 1: Схема и валидаторы

**Files:** `convex/schema.ts`, `convex/lib/validators.ts`; Test: `convex/schema.test.ts`

Статусы вещи: `collecting` (приходят фото альбома) → `analyzing` → `needs_input` (бот задал
вопрос) | `draft` → `approved` | `cancelled`; `failed` при ошибке анализа.

```ts
items: defineTable({
  chatId: v.number(),
  status: itemStatusValidator,
  photoIds: v.array(v.id("_storage")),
  mediaGroupId: v.optional(v.string()),
  caption: v.optional(v.string()),
  lastPhotoAt: v.number(),
  answers: v.array(v.object({ question: v.string(), answer: v.string() })),
  question: v.optional(v.string()),
  awaiting: v.optional(v.union(v.literal("price"), v.literal("text"))),
  draft: v.optional(draftValidator),
  draftMessageId: v.optional(v.number()),
  costUsd: v.number(),
  error: v.optional(v.string()),
})
  .index("by_media_group", ["mediaGroupId"])
  .index("by_status", ["status"])
  .index("by_awaiting", ["awaiting"]),
priceResearch: defineTable({
  itemId: v.id("items"), source: v.literal("ebay"), title: v.string(),
  priceUsd: v.number(), url: v.string(), condition: v.optional(v.string()),
}).index("by_item", ["itemId"]),
telegramUpdates: defineTable({ updateId: v.number() }).index("by_update_id", ["updateId"]),
fxRates: defineTable({ date: v.string(), usdUah: v.number() }).index("by_date", ["date"]),
```

`draftValidator`: `titleUk` (≤ 70 символов — лимит заголовка OLX), `descriptionUk`,
`category`, `brand?`, `model?`, `condition` (`new` | `like_new` | `good` | `fair` |
`for_parts`), `defects: string[]`, `priceUah`, `priceUsd`, `priceReasoningRu`,
`comparablesCount`, `marketplaces: ("olx" | "ebay")[]`.

Тест: вставка вещи с черновиком проходит, с неизвестным `condition` — падает.

### Task 2: Разбор апдейтов Telegram

**Files:** `convex/lib/telegramUpdate.ts`; Test: `convex/lib/telegramUpdate.test.ts`

```ts
type Incoming =
  | { kind: "photo"; updateId; fromId; chatId; fileId; mediaGroupId?; caption? }
  | { kind: "text"; updateId; fromId; chatId; text }
  | { kind: "command"; updateId; fromId; chatId; command: "start" | "help" }
  | { kind: "callback"; updateId; fromId; chatId; callbackId; messageId; action: CallbackAction; itemId: string }
  | { kind: "ignored"; updateId };
export function parseUpdate(raw: unknown): Incoming;
```

- Фото: берётся последний элемент `message.photo` (самый большой размер). Документ-картинка
  (`message.document` с `mime_type` `image/*`) — тоже `photo`.
- `callback_data` формата `<action>:<itemId>`, action ∈ `publish|price|text|cancel`; иное —
  `ignored`.
- Тесты: одиночное фото, фото из альбома с подписью, документ-картинка, текст, `/start`,
  каждая из четырёх кнопок, мусорный `callback_data`, апдейт без `message` → `ignored`,
  не-объект → `ignored` (не исключение).

### Task 3: Вебхук и приём фото

**Files:** `convex/http.ts`, `convex/telegram.ts`, `convex/items.ts`;
Test: `convex/telegram.test.ts`

`POST /telegram`:
1. Заголовок `X-Telegram-Bot-Api-Secret-Token` ≠ `TELEGRAM_WEBHOOK_SECRET` → 401.
2. Иначе `parseUpdate`, `fromId` ≠ `OWNER_TELEGRAM_ID` → 200 без действий.
3. `ctx.runMutation(internal.telegram.handleUpdate, { incoming })` → 200. Ошибки внутри
   логируются, но ответ всё равно 200, чтобы Telegram не повторял бесконечно.

`handleUpdate`:
- Повторный `updateId` (по `telegramUpdates.by_update_id`) — ничего не делает.
- `photo`: файл скачивается в action `items.storePhoto` (Telegram `getFile` → байты →
  `ctx.storage.store`), затем мутация `items.attachPhoto`:
  - есть `mediaGroupId` и вещь в `collecting` с ним → добавить фото, обновить `lastPhotoAt`;
  - иначе — новая вещь в `collecting`.
  - Запланировать `analyze.start({ itemId, photoAt: lastPhotoAt })` через 4 с.
    `start` выходит, если `item.lastPhotoAt !== photoAt` (пришло ещё фото альбома) —
    так альбом из 10 фото даёт один анализ.
  - Больше 10 фото в одной вещи — лишние не сохраняются, бот пишет об этом один раз.
- `text`: см. Task 8.
- `command start|help`: короткая инструкция «Пришлите фото вещи (до 10 штук, можно альбомом)…».
- `callback`: см. Task 8.

Тесты (convex-test, `telegramApi` замокан): 401 без секрета; чужой `fromId` → нет записей;
повтор `updateId` → одна вещь; альбом из 3 апдейтов → одна вещь с 3 фото и один реальный
запуск анализа (`vi.useFakeTimers` + `t.finishAllScheduledFunctions`); два одиночных фото
→ две вещи.

### Task 4: Шов Telegram API

**Files:** `convex/lib/telegramApi.ts`; Test: `convex/lib/telegramApi.test.ts`

Функции над `fetch("https://api.telegram.org/bot<token>/<method>")`: `sendMessage(chatId,
text, keyboard?)` → `messageId`, `editMessageText`, `answerCallbackQuery`,
`getFileBytes(fileId)` → `ArrayBuffer` + `mimeType`, `setWebhook(url, secret)`.
`parse_mode` не используем (обычный текст — без проблем с экранированием).
Ответ `ok: false` → исключение с `description` из ответа.
Тесты на `vi.stubGlobal("fetch", …)`: URL и тело запроса, разбор `ok: false`.

### Task 5: Цены и курс

**Files:** `convex/lib/pricing.ts`, `convex/lib/nbu.ts`;
Test: `convex/lib/pricing.test.ts`, `convex/lib/nbu.test.ts`

- `summarize(pricesUsd: number[])` → `{ count, p25, median, p75 }` после отброса
  выбросов за 1.5×IQR; пустой массив → `count: 0`.
- `usdToUah(usd, rate)` — округление до 10 грн для цен ≥ 500 грн, до 1 грн — ниже.
- `parsePrice(text)` — «1500», «1 500 грн», «1500₴», «1,5к» → 1500; «$40» →
  `{ usd: 40 }`; бессмыслица → `null`.
- `getUsdUah(ctx)` — берёт `fxRates` за сегодня (Europe/Kyiv), иначе
  `https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?valcode=USD&json` и
  сохраняет. НБУ недоступен → последний сохранённый курс; нет ни одного → ошибка.

### Task 6: Шов eBay Browse API

**Files:** `convex/lib/ebay.ts`; Test: `convex/lib/ebay.test.ts`

- Токен: `POST https://api.ebay.com/identity/v1/oauth2/token`,
  `grant_type=client_credentials`, `scope=https://api.ebay.com/oauth/api_scope`, Basic-auth
  `EBAY_CLIENT_ID:EBAY_CLIENT_SECRET`. Кэш в памяти action до `expires_in − 60 с`.
- `searchByKeywords(query, { used })` →
  `GET /buy/browse/v1/item_summary/search?q=…&limit=30&filter=buyingOptions:{FIXED_PRICE}[,conditionIds:{3000}]`,
  заголовок `X-EBAY-C-MARKETPLACE-ID: EBAY_US`.
- `searchByImage(base64)` → `POST /buy/browse/v1/item_summary/search_by_image` с
  `{ image }`.
- Оба возвращают `Comparable[] = { title, priceUsd, url, condition? }`; позиции не в USD
  отбрасываются.
- Тесты на замоканном `fetch`: заголовки, фильтр б/у, разбор ответа, пустой результат,
  401 → понятная ошибка «проверьте EBAY_CLIENT_ID/SECRET».

### Task 7: Агент Claude

**Files:** `convex/lib/claude.ts`, `convex/lib/agent.ts`, `convex/analyze.ts`;
Test: `convex/lib/agent.test.ts`, `convex/analyze.test.ts`

`claude.ts` — единственное место, где создаётся `new Anthropic()` (ключ из
`ANTHROPIC_API_KEY`); экспортирует `createMessage(params)` над
`client.beta.messages.create`.

`agent.ts`:

```ts
export async function runAgent(input: {
  photos: { mediaType: string; base64: string }[];
  caption?: string;
  answers: { question: string; answer: string }[];
  usdUah: number;
  tools: { searchByKeywords; searchByImage };
}): Promise<
  | { kind: "draft"; draft: Draft; comparables: Comparable[]; costUsd: number }
  | { kind: "question"; question: string; costUsd: number }
>;
```

- Запрос: `model: "claude-opus-5-5"`, `max_tokens: 16000`,
  `output_config: { effort: "medium" }`, `betas: ["server-side-fallback-2026-07-01"]`,
  `fallbacks: "default"`, `tool_choice: { type: "auto" }`. Системный промпт (стабильный,
  с `cache_control`) описывает задачу: распознать вещь, искать аналоги, назначить цену для
  быстрой продажи на OLX.ua, написать объявление на украинском без выдумок о том, чего не
  видно на фото, перечислить дефекты, спросить владельца только если без ответа цена или
  описание будут заведомо неверны.
- Инструменты: `search_ebay(query, used)`, `search_ebay_by_image(photo_index)` — результат
  отдаётся моделью в виде краткого списка + `summarize` в USD и UAH;
  `ask_owner(question)` и `submit_draft(...)` — завершающие, `strict: true`,
  `additionalProperties: false`.
- Цикл: не больше 8 запросов. Все `tool_use` одного ответа исполняются, результаты — одним
  `user`-сообщением. Ошибка инструмента → `tool_result` с `is_error: true`. Ответ с
  `submit_draft` или `ask_owner` завершает цикл. `stop_reason: "refusal"` или лимит
  итераций → исключение с понятным текстом.
- `submit_draft.input` дополнительно проверяется кодом (длина заголовка, цена > 0, известные
  `marketplaces`); провал → `tool_result` с ошибкой, модель исправляет.
- Стоимость: `usage` каждого ответа × $4 / $20 за 1M (вход/выход), кэш-чтение $0.20 за 1M.
- Тесты `agent.test.ts` (замокан `createMessage`, сценарии ответов заданы списком):
  сразу `submit_draft`; `search_ebay` → `submit_draft` (проверить, что результат поиска
  ушёл в следующий запрос как `tool_result` с тем же `tool_use_id`); `ask_owner`;
  неверный `submit_draft` → исправленный; два инструмента в одном ответе → один `user`-ход
  с двумя `tool_result`; отказ; превышение 8 итераций.

`analyze.ts`:
- `start({ itemId, photoAt })`: проверка `lastPhotoAt`, статус → `analyzing`, сообщение
  «Разбираюсь…», байты фото из storage → base64, `runAgent`, затем:
  - `draft` → сохранить черновик и аналоги, статус `draft`, отредактировать сообщение
    «Разбираюсь…» в черновик с клавиатурой (`draftMessageId`);
  - `question` → статус `needs_input`, `question`, отправить вопрос;
  - исключение → статус `failed`, `error`, сообщение «Не получилось разобрать: … Пришлите
    фото ещё раз».
- Тест `analyze.test.ts`: замоканные `runAgent` и `telegramApi`; по каждому из трёх исходов
  — статус, записанные поля, текст отправленного сообщения.

### Task 8: Кнопки и ответы владельца

**Files:** `convex/lib/draftMessage.ts`, `convex/callbacks.ts`, `convex/analyze.ts`
(`rewrite`); Test: `convex/lib/draftMessage.test.ts`, `convex/callbacks.test.ts`

Черновик в сообщении:

```
📦 <titleUk>
💰 <priceUah> грн (eBay: $<priceUsd>)
Состояние: <по-русски>  ·  Дефекты: <список или «не видно»>
Почему такая цена: <priceReasoningRu> (аналогов: <comparablesCount>)

<descriptionUk>

Площадки: OLX, eBay   ·   анализ: $0.14
[Выставить] [Изменить цену]
[Изменить текст] [Отмена]
```

Сообщения длиннее 4096 символов обрезаются по описанию с «…».

Кнопки (каждая сначала `answerCallbackQuery`; кнопка у вещи не в статусе `draft` →
«Эта вещь уже обработана»):
- `publish` → статус `approved`, отдельным сообщением текст для вставки (заголовок,
  цена, описание), клавиатура у черновика убирается.
- `price` → `awaiting: "price"`, «Напишите новую цену в гривнах».
- `text` → `awaiting: "text"`, «Что поменять в тексте?».
- `cancel` → статус `cancelled`, клавиатура убирается.

Текст от владельца, по порядку:
1. Есть вещь с `awaiting: "price"` → `parsePrice`; успех — новая цена (USD пересчитывается
   по курсу), черновик перерисовывается, `awaiting` снимается; провал — «Не понял цену,
   пример: 1500».
2. Есть вещь с `awaiting: "text"` → запуск `analyze.rewrite({ itemId, instruction })`:
   один запрос к Claude без поиска, только `submit_draft` с прежней ценой.
3. Есть вещь в `needs_input` → ответ добавляется в `answers`, повторный `analyze.start`.
4. Иначе — «Пришлите фото вещи, чтобы начать».

Одновременно ждать можно только одну вещь: новый `awaiting` снимает прежний.

Тесты: формат черновика (с дефектами и без, обрезка длинного), каждая кнопка, кнопка по
обработанной вещи, все четыре ветки текста.

### Task 9: Регистрация вебхука и запуск

**Files:** `convex/telegram.ts` (`setWebhook`), `README.md`, `docs/CONTINUE.md`

- `setWebhook` (internal action): URL `${process.env.CONVEX_SITE_URL}/telegram`,
  `secret_token` из env, `allowed_updates: ["message", "callback_query"]`.
- README: как получить токен у @BotFather, свой Telegram ID (бот @userinfobot), ключи
  Anthropic и eBay; список переменных для `npx convex env set`; команда
  `npx convex run telegram:setWebhook`.

### Task 10: Проверка на реальном боте

Владелец задаёт секреты в дашборде Convex, затем `npx convex run telegram:setWebhook`.
Прогон на 5–10 настоящих вещах разных типов (электроника, одежда, посуда, вещь без бренда,
альбом из нескольких фото). Записать в «Итог выполнения»: качество распознавания, разумность
цен, среднюю стоимость анализа, проблемы. По итогам — решение, оставлять ли
`claude-opus-5-5` или пробовать `claude-sonnet-5-5` (решает владелец).

---

## Критерии завершения этапа 1

- `npm test`, `npm run lint`, `npm run typecheck`, `npm run build` — без ошибок.
- На dev-деплойменте бот отвечает владельцу и молчит для других.
- Фото или альбом → один черновик с ценой и обоснованием в течение ~1 минуты.
- Все четыре кнопки и правка цены и текста работают; вопрос бота и ответ владельца
  приводят к черновику.
- Стоимость анализа видна в черновике; секретов в репозитории нет.

## Итог выполнения

_Заполняется после этапа._
