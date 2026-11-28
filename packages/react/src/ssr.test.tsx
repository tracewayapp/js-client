// @vitest-environment node
// JS2-7: the React package on the server and in the Next.js App Router. The SDK itself only runs in the browser.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import { getClient } from "@tracewayapp/frontend";
import { TracewayProvider } from "./index.js";

it("renders the provider on the server, patching nothing and starting nothing", () => {
  const fetchBefore = globalThis.fetch;
  const errorBefore = console.error;
  const html = renderToString(
    <TracewayProvider token="tok" baseUrl="https://traceway.test">
      <div>hi</div>
    </TracewayProvider>,
  );
  expect(html).toBe("<div>hi</div>");
  expect(globalThis.fetch).toBe(fetchBefore);
  expect(console.error).toBe(errorBefore);
  expect(getClient()).toBeNull();
});

it('ships with "use client", so a server layout can render <TracewayProvider> without a wrapper file', () => {
  for (const file of ["index.mjs", "index.js"]) {
    const code = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../dist", file), "utf8");
    expect(code.startsWith('"use client";')).toBe(true);
  }
});
