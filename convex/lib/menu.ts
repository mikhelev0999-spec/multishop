// The bot's persistent menu: reply-keyboard buttons and the Telegram command list.

export const MENU_BUTTONS = {
  new: "📸 Новая вещь",
  items: "📦 Мои вещи",
  stats: "📊 Статистика",
  help: "❓ Помощь",
} as const;

export type MenuCommand = keyof typeof MENU_BUTTONS;

/** Layout of the reply keyboard shown under the message box. */
export const MENU_LAYOUT: string[][] = [
  [MENU_BUTTONS.new, MENU_BUTTONS.items],
  [MENU_BUTTONS.stats, MENU_BUTTONS.help],
];

/** Shown in Telegram's "/" menu. */
export const BOT_COMMANDS = [
  { command: "start", description: "Начать и показать меню" },
  { command: "items", description: "Мои вещи" },
  { command: "stats", description: "Статистика продаж" },
  { command: "help", description: "Как пользоваться" },
];
