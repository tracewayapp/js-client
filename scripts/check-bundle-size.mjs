// Fails when a built browser bundle grows past its gzipped budget. Run after `npm run build`.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const budgets = [
  // The IIFE inlines rrweb (~60 KB gzipped); ESM consumers load it lazily, only when replay is on.
  { file: "packages/frontend/dist/traceway.iife.global.js", maxKb: 145 },
  // Includes the long task and route timing instrumentations,
  // the metrics recorder, sequence listeners with per-tab navigation recovery, reading route templates from
  // the app's router, the web vitals instrumentation with its stable element selector (the Browser SIG one it
  // replaces was a dependency, outside this file), `log()`, the replay's traceway-mask / traceway-blank selectors and
  // the masking of what rrweb misses inside them, the screen keys with `recordNavigation`, `tracer()`, and the
  // `replay.images` policy with its image inliner. The build strips comments (scripts/strip-comments.mjs).
  { file: "packages/frontend/dist/index.mjs", maxKb: 46 },
  { file: "packages/opamp/dist/index.mjs", maxKb: 6 },
  // The jQuery CDN build carries the whole browser SDK, rrweb included, like the frontend IIFE.
  { file: "packages/jquery/dist/traceway-jquery.iife.global.js", maxKb: 146 },
];

let failed = false;
for (const { file, maxKb } of budgets) {
  const kb = gzipSync(readFileSync(file)).length / 1024;
  const ok = kb <= maxKb;
  failed ||= !ok;
  console.log(`${ok ? "ok  " : "FAIL"} ${file}: ${kb.toFixed(1)} KB gzipped (budget ${maxKb} KB)`);
}
process.exit(failed ? 1 : 0);
