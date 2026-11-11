/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as analyze from "../analyze.js";
import type * as bot from "../bot.js";
import type * as crons from "../crons.js";
import type * as fx from "../fx.js";
import type * as health from "../health.js";
import type * as http from "../http.js";
import type * as items from "../items.js";
import type * as lib_agent from "../lib/agent.js";
import type * as lib_claude from "../lib/claude.js";
import type * as lib_draftMessage from "../lib/draftMessage.js";
import type * as lib_ebay from "../lib/ebay.js";
import type * as lib_itemState from "../lib/itemState.js";
import type * as lib_nbu from "../lib/nbu.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_telegramApi from "../lib/telegramApi.js";
import type * as lib_telegramUpdate from "../lib/telegramUpdate.js";
import type * as lib_validators from "../lib/validators.js";
import type * as telegram from "../telegram.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  analyze: typeof analyze;
  bot: typeof bot;
  crons: typeof crons;
  fx: typeof fx;
  health: typeof health;
  http: typeof http;
  items: typeof items;
  "lib/agent": typeof lib_agent;
  "lib/claude": typeof lib_claude;
  "lib/draftMessage": typeof lib_draftMessage;
  "lib/ebay": typeof lib_ebay;
  "lib/itemState": typeof lib_itemState;
  "lib/nbu": typeof lib_nbu;
  "lib/pricing": typeof lib_pricing;
  "lib/telegramApi": typeof lib_telegramApi;
  "lib/telegramUpdate": typeof lib_telegramUpdate;
  "lib/validators": typeof lib_validators;
  telegram: typeof telegram;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
