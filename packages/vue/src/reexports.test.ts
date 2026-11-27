// JS2-12 (CONTRACT §14.4, §14.7): the wrapper exports every function, value and type of the browser SDK, the same
// objects, so an app that installed only this package never needs @tracewayapp/frontend itself. Left out on purpose:
// init,TracewayFrontendClient,trackRouter.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import * as frontend from "@tracewayapp/frontend";
import * as wrapper from "./index.js";

const OMITTED = new Set(["init", "TracewayFrontendClient", "trackRouter"]);

/** The names in the `export type { … }` lists of a source file. */
function typeNames(path: string): string[] {
  const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), path), "utf8");
  return [...source.matchAll(/export type \{([^}]*)\}/g)].flatMap((m) =>
    m[1]!.split(",").map((name) => name.trim()).filter(Boolean),
  );
}

it("re-exports every value of the browser SDK, the same objects", () => {
  for (const key of Object.keys(frontend))
    if (!OMITTED.has(key))
      expect((wrapper as Record<string, unknown>)[key], key).toBe(
        (frontend as Record<string, unknown>)[key],
      );
});

it("re-exports every type of the browser SDK", () => {
  const own = typeNames("./index.ts");
  for (const name of typeNames("../../frontend/src/index.ts")) expect(own, name).toContain(name);
});

it("the re-exported functions do nothing before init()", () => {
  expect(() => wrapper.recordNavigation("/orders/42", "push", "/orders", "/orders/:id")).not.toThrow();
  expect(wrapper.tracer()).toBeUndefined();
  expect(wrapper.getClient()).toBeNull();
  expect(wrapper.startInteraction("checkout").spanId).toBeNull();
});
