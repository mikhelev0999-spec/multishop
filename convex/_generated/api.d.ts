/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as fx from "../fx.js";
import type * as health from "../health.js";
import type * as lib_ebay from "../lib/ebay.js";
import type * as lib_nbu from "../lib/nbu.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_telegramApi from "../lib/telegramApi.js";
import type * as lib_telegramUpdate from "../lib/telegramUpdate.js";
import type * as lib_validators from "../lib/validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  fx: typeof fx;
  health: typeof health;
  "lib/ebay": typeof lib_ebay;
  "lib/nbu": typeof lib_nbu;
  "lib/pricing": typeof lib_pricing;
  "lib/telegramApi": typeof lib_telegramApi;
  "lib/telegramUpdate": typeof lib_telegramUpdate;
  "lib/validators": typeof lib_validators;
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
