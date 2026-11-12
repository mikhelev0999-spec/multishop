# Multishop

Telegram-бот, который из фото б/у вещи делает объявление для OLX.ua и eBay: распознаёт
вещь (Claude), ищет похожие объявления и цены (eBay), предлагает цену и присылает черновик.
Ничего не публикуется без кнопки «Выставить».

Стек: Convex (бэкенд, вебхук, хранилище фото), Vite + React (веб-кабинет — этап 4),
Anthropic API, eBay Browse API, курс НБУ.

## Проверки

```bash
npm test
npm run lint
npm run typecheck
```

Пока нет деплоймента Convex, список модулей в `convex/_generated/api.d.ts` обновляет
`npm run codegen:offline`. После первого `npx convex dev` это делает Convex сам.

## Первый запуск бота

### 1. Что получить

| Что | Где | Переменная |
|---|---|---|
| Токен бота | Telegram, @BotFather → `/newbot` | `TELEGRAM_BOT_TOKEN` |
| Ваш Telegram ID (число) | Telegram, @userinfobot | `OWNER_TELEGRAM_ID` |
| Ключ Anthropic | console.anthropic.com → API Keys (пополнить баланс) | `ANTHROPIC_API_KEY` |
| eBay App ID и Cert ID (Production) | developer.ebay.com → Application Keys | `EBAY_CLIENT_ID`, `EBAY_CLIENT_SECRET` |
| Секрет вебхука | любая длинная случайная строка из латиницы и цифр | `TELEGRAM_WEBHOOK_SECRET` |

Ключи не присылать в чат и не коммитить — только в дашборд Convex.

### 2. Деплоймент Convex

```bash
npx convex dev
```

Первый запуск попросит войти и создаст проект и dev-деплоймент. Команду можно оставить
работать — она заливает изменения кода.

### 3. Секреты

В дашборде Convex: Settings → Environment Variables — добавить все шесть переменных из
таблицы.

### 4. Вебхук Telegram

```bash
npx convex run telegram:setWebhook
```

Команда печатает адрес вебхука. После этого напишите боту `/start` и пришлите фото.

## Ручной режим (без ключа Anthropic)

Пока в Convex нет `ANTHROPIC_API_KEY`, бот ставит фото в очередь и пишет владельцу
«Напишите Claude в чат „разбери“». Разбор делает Claude в сессии Claude Code:

```bash
npx convex run manual:queue
```

```bash
npx convex run manual:submitDraft '{"itemId": "...", "draft": {"title_uk": "...", "description_uk": "...", "category": "...", "brand": "", "model": "", "condition": "good", "defects": [], "price_uah": 400, "price_usd": 10, "price_reasoning_ru": "...", "comparables_count": 0, "marketplaces": ["olx"]}}'
```

```bash
npx convex run manual:ask '{"itemId": "...", "question": "..."}'
```

Тот же `submitDraft` выполняет запросы «Изменить текст» из `queue.rewrite`; цена при этом
не меняется. Как только `ANTHROPIC_API_KEY` добавлен, бот разбирает фото сам.

## Фотостудия (мини-приложение Telegram)

Страница `/studio` убирает фон с фото прямо на телефоне (открытая модель
`@imgly/background-removal`, лицензия AGPL — для личного использования владельцем это
не ограничение) и сохраняет результат в Convex.

1. Разместить сайт на Vercel: vercel.com → Add New → Project → импортировать репозиторий
   `multishop`, в Environment Variables добавить `VITE_CONVEX_URL` (адрес из `.env.local`,
   `https://…convex.cloud`) и нажать Deploy.
2. Адрес сайта (`https://….vercel.app`) записать в Convex переменной `STUDIO_URL`.
3. Под новыми черновиками в боте появится кнопка «🎨 Обработать фото».
