import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "convex/_generated", ".vercel"]),
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ["convex/**/*.ts"],
    ignores: ["convex/_generated/**", "convex/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "CallExpression[callee.property.name='filter'][callee.object.callee.property.name=/^(query|withIndex|order)$/]",
          message: "Фильтруй индексом: .withIndex(...), а не .filter() по полю.",
        },
        {
          selector: "CallExpression[callee.property.name='collect']",
          message: ".collect() на растущей таблице читает её целиком. Используй .take(n) или .paginate().",
        },
      ],
    },
  },
]);
