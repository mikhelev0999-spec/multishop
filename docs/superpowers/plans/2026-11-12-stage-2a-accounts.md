# Multishop — этап 2а «Подключение аккаунтов OLX и eBay»: план

**Spec:** `docs/superpowers/specs/2026-11-11-multishop-design.md`, «Дополнение 2026-11-12:
подключение аккаунтов».

1. **OAuth-шов** (`convex/lib/oauth.ts`): провайдеры OLX и eBay — ссылка входа, обмен кода на
   токены, конфиг из переменных. Ошибки без токенов и секретов. Тесты на запросы.
2. **Страницы** (`convex/lib/pages.ts`): политика конфиденциальности, «подключено»,
   «не получилось». Экранирование. Тесты.
3. **Данные**: таблицы `oauthStates` (state, provider, chatId) и `accounts`
   (provider, токены, сроки).
4. **Логика** (`convex/accounts.ts`): `show` (статус + кнопки-ссылки), `newState`,
   `consumeState` (одноразово, 15 минут), `save`, `complete` (весь возврат). Тесты.
5. **Бот и HTTP**: кнопка меню «🔗 Аккаунты», `/accounts`, кнопки-ссылки в Telegram, маршруты
   `/privacy`, `/oauth/{olx,ebay}/callback`, `/oauth/ebay/declined`. Тесты.
6. Деплой, `telegram:setWebhook` (меню команд), `OLX_CLIENT_ID=6005`, ревью, итог.
