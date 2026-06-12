import { afterEach, describe, expect, it } from "vitest";

import {
  collectDebugIds,
  debugIdsForStackTrace,
  resetDebugIdCache,
} from "./debug-ids";

const g = globalThis as Record<string, unknown>;

afterEach(() => {
  delete g._tracewayDebugIds;
  delete g._sentryDebugIds;
  resetDebugIdCache();
});

const ID_A = "85314830-023f-4cf1-a267-535f4e37bb17";
const ID_B = "395835f4-03e0-4436-80d3-136f0749a893";

describe("collectDebugIds", () => {
  it("returns undefined when no registry exists", () => {
    expect(collectDebugIds()).toBeUndefined();
  });

  it("maps v8 stack keys to bundle filenames", () => {
    g._tracewayDebugIds = {
      "Error\n    at http://localhost:5173/assets/app-abc123.js:1:50": ID_A,
    };
    expect(collectDebugIds()).toEqual({ "app-abc123.js": ID_A });
  });

  it("maps firefox stack keys to bundle filenames", () => {
    g._tracewayDebugIds = {
      "@https://cdn.example.com/main.js:1:1\n@https://cdn.example.com/main.js:1:30":
        ID_A,
    };
    expect(collectDebugIds()).toEqual({ "main.js": ID_A });
  });

  it("reads sentry registries as a fallback", () => {
    g._sentryDebugIds = {
      "Error\n    at injected (https://cdn.example.com/vendor.js:1:2)": ID_B,
    };
    expect(collectDebugIds()).toEqual({ "vendor.js": ID_B });
  });

  it("prefers traceway registry entries over sentry ones", () => {
    g._tracewayDebugIds = {
      "Error\n    at https://cdn.example.com/app.js:1:2": ID_A,
    };
    g._sentryDebugIds = {
      "Error\n    at https://cdn.example.com/app.js:1:2": ID_B,
    };
    expect(collectDebugIds()).toEqual({ "app.js": ID_A });
  });

  it("refreshes the cache when new bundles register", () => {
    g._tracewayDebugIds = {
      "Error\n    at https://cdn.example.com/app.js:1:2": ID_A,
    };
    expect(collectDebugIds()).toEqual({ "app.js": ID_A });
    (g._tracewayDebugIds as Record<string, string>)[
      "Error\n    at https://cdn.example.com/chunk.js:1:2"
    ] = ID_B;
    expect(collectDebugIds()).toEqual({ "app.js": ID_A, "chunk.js": ID_B });
  });
});

describe("debugIdsForStackTrace", () => {
  it("keeps only filenames present in the stack trace", () => {
    g._tracewayDebugIds = {
      "Error\n    at https://cdn.example.com/app.js:1:2": ID_A,
      "Error\n    at https://cdn.example.com/vendor.js:1:2": ID_B,
    };
    const trace = "TypeError: boom\nhandleClick()\n    app.js:1:4242";
    expect(debugIdsForStackTrace(trace)).toEqual({ "app.js": ID_A });
  });

  it("returns undefined when nothing matches", () => {
    g._tracewayDebugIds = {
      "Error\n    at https://cdn.example.com/vendor.js:1:2": ID_A,
    };
    expect(
      debugIdsForStackTrace("TypeError: boom\nfn()\n    other.js:1:1"),
    ).toBeUndefined();
  });
});
