# Multishop — где мы

Спека: `docs/superpowers/specs/2026-11-11-multishop-design.md`.
Планы: `docs/superpowers/plans/` (1 — черновик из фото, 1б — фотостудия, 1в — удобный бот,
2а — подключение аккаунтов).

## Состояние

- Этап 0: заготовка проекта. Готово.
- Этап 1 «Черновик из фото»: готов, в `main`. Бот работает на dev-деплойменте Convex
  `hip-ocelot-929`, вебхук Telegram подключён.
- Ручной режим: пока в Convex нет `ANTHROPIC_API_KEY`, разбор фото делает Claude в чате
  (`npx convex run manual:queue` / `manual:submitDraft` / `manual:ask`).
- Этап 1б «Фотостудия»: готова и опубликована на самом Convex
  (`https://hip-ocelot-929.convex.site/studio`, `./scripts/publish-studio.sh`), `STUDIO_URL`
  задан. На телефоне ещё не проверялась.
- Этап 1в «Удобный бот» и время ожидания: готовы, в `main`.
- Этап 2а «Подключение аккаунтов»: готов, в `main`. Кнопка «🔗 Аккаунты», OAuth, `/privacy`.
  **OLX подключён** (2026-11-13, `OLX_CLIENT_ID` = Client ID 203464, секрет в Convex).
  Секрет OLX владелец прислал в чат — после запуска стоит выпустить новый.
- Нет ключей Anthropic и eBay; поиск цен на eBay не работает, вход eBay ждёт App ID, RuName и
  `EBAY_CLIENT_SECRET` (Cert ID).

## Как работать из облачной сессии Claude

- Среда `multishop` пускает к `api.convex.dev`, `auth.convex.dev`, `hip-ocelot-929.convex.cloud`,
  `hip-ocelot-929.convex.site`, `vercel.com`, `api.vercel.com`, `developer.olx.ua`, `www.olx.ua`.
- Node ходит через прокси только с `NODE_USE_ENV_PROXY=1`.
- Вход в Convex: `npx convex login --no-open --login-flow poll`, владелец открывает ссылку.

## Дальше

1. Проверка студии на телефоне; прогон 5–10 вещей (задача 10 этапа 1).
2. На api.vercel.com в среде сохранён токен Vercel, но прокси его не подставлял — не нужен,
   пока сайт на Convex.
3. Публикация на OLX через Partner API (этап 2б): токен есть, нужны формат объявления
   (категория, атрибуты, город, контакт) и обновление токена по refresh token.
4. eBay: ключи → «Подключить eBay» → бизнес-политики → публикация.
