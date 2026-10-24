import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** @type {import('next').NextConfig} */
export default {
  // Route handlers import /server, /engine, /analyzer, /github and /shared from the repo root.
  experimental: { externalDir: true },
  outputFileTracingRoot: root,
};
