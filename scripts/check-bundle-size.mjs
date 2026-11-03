// Fails when a built browser bundle grows past its gzipped budget. Run after `npm run build`.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const budgets = [
  // The IIFE inlines rrweb (~60 KB gzipped); ESM consumers load it lazily, only when replay is on.
  { file: "packages/frontend/dist/traceway.iife.global.js", maxKb: 145 },
  { file: "packages/frontend/dist/index.mjs", maxKb: 25 },
  { file: "packages/opamp/dist/index.mjs", maxKb: 6 },
];

let failed = false;
for (const { file, maxKb } of budgets) {
  const kb = gzipSync(readFileSync(file)).length / 1024;
  const ok = kb <= maxKb;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"} ${file}: ${kb.toFixed(1)} KB gzipped (budget ${maxKb} KB)`);
}
process.exit(failed ? 1 : 0);
