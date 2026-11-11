import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.*s");

test("ping returns ok and the site name", async () => {
  const t = convexTest(schema, modules);
  const result = await t.query(api.health.ping, {});
  expect(result).toEqual({ ok: true, name: "multishop" });
});
