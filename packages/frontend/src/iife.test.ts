// JS2-12: the CDN build (`window.Traceway`) exposes exactly what the ESM entry exports. Run after `npm run build`.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import * as esm from "./index.js";

it("the CDN build exposes the same functions and values as the ESM entry", () => {
  const code = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "../dist/traceway.iife.global.js"),
    "utf8",
  );
  const cdn = new Function(`${code}\n;return Traceway;`)();
  expect(Object.keys(cdn).sort()).toEqual(Object.keys(esm).sort());
});
