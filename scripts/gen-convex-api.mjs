// Offline stand-in for `npx convex codegen`: rewrites the module list in
// convex/_generated/api.d.ts. `npx convex dev` overwrites this file with the
// same content once a deployment exists.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = "convex";
const modules = [];
function walk(dir) {
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name !== "_generated") walk(path);
    } else if (/\.ts$/.test(name) && !/\.test\.ts$/.test(name) && !/\.d\.ts$/.test(name)) {
      const rel = relative(root, path).replace(/\\/g, "/").replace(/\.ts$/, "");
      if (rel !== "schema" && !rel.startsWith("_")) modules.push(rel);
    }
  }
}
walk(root);
modules.sort();

const ident = (m) => m.replace(/[/.-]/g, "_");
const imports = modules.map((m) => `import type * as ${ident(m)} from "../${m}.js";`).join("\n");
const entries = modules
  .map((m) => `  ${m.includes("/") ? JSON.stringify(m) : m}: typeof ${ident(m)};`)
  .join("\n");

const file = "convex/_generated/api.d.ts";
let src = readFileSync(file, "utf8");
src = src.replace(/(import type \* as [^\n]+\n)+/, imports + "\n");
src = src.replace(/declare const fullApi: ApiFromModules<\{[\s\S]*?\}>;/, `declare const fullApi: ApiFromModules<{\n${entries}\n}>;`);
writeFileSync(file, src);
console.log(`api.d.ts: ${modules.length} modules`);
