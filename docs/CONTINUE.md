# Multishop — где мы

Спека: `docs/superpowers/specs/2026-11-11-multishop-design.md`.
Планы: `docs/superpowers/plans/` (этап 1 — черновик из фото, этап 1б — фотостудия).

## Состояние

- Этап 0: заготовка проекта. Готово.
- Этап 1 «Черновик из фото»: готов, в `main`. Бот работает на dev-деплойменте Convex
  `hip-ocelot-929`, вебхук Telegram подключён.
- Ручной режим: пока в Convex нет `ANTHROPIC_API_KEY`, разбор фото делает Claude в чате
  (`npx convex run manual:queue` / `manual:submitDraft` / `manual:ask`).
- Этап 1б «Фотостудия»: готова и опубликована на самом Convex
  (`https://hip-ocelot-929.convex.site/studio`, `./scripts/publish-studio.sh`), `STUDIO_URL`
  задан. На телефоне ещё не проверялась.
- Нет ключей Anthropic и eBay; поиск цен на eBay не работает.

## Как работать из облачной сессии Claude

- Среда `multishop` пускает к `api.convex.dev`, `auth.convex.dev`, `hip-ocelot-929.convex.cloud`,
  `hip-ocelot-929.convex.site`, `vercel.com`, `api.vercel.com`.
- Node ходит через прокси только с `NODE_USE_ENV_PROXY=1`.
- Вход в Convex: `npx convex login --no-open --login-flow poll`, владелец открывает ссылку.

## Дальше

1. Проверка студии на телефоне; прогон 5–10 вещей (задача 10 этапа 1).
2. На api.vercel.com в среде сохранён токен Vercel, но прокси его не подставлял — не нужен,
   пока сайт на Convex.
3. Публикация на OLX: через браузер на компьютере владельца или Partner API (этап 3).
