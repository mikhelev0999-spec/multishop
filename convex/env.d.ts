// Convex exposes environment variables on process.env in every runtime. Declared here instead
// of pulling in @types/node, so Node-only APIs (Buffer, fs…) don't typecheck in non-"use node" files.
declare const process: { env: Record<string, string | undefined> };
