// JS2-11: a bundled jQuery (`import $ from "jquery"`) sets no window.jQuery; it is passed as the jQuery option, and
// a page where jQuery cannot be found says so. JS2-10: the published types declare no globals.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tracewayapp/frontend", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  flush: vi.fn(),
}));

/** A fresh copy of the package, whose handler is not bound yet, with core's console.warn being the spy. */
async function load() {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const traceway = await import("@tracewayapp/frontend");
  const { init } = await import("./index.js");
  return { init, warn, traceway };
}

function fakeJQuery() {
  let handler: ((...args: unknown[]) => void) | undefined;
  const $ = vi.fn(() => ({
    ajaxError: (fn: typeof handler) => {
      handler = fn;
    },
  }));
  return { $, fire: (...args: unknown[]) => handler!(...args) };
}

beforeEach(() => vi.resetModules());

afterEach(() => {
  delete (globalThis as { jQuery?: unknown }).jQuery;
  delete (globalThis as { $?: unknown }).$;
  vi.restoreAllMocks();
});

describe("the jQuery option", () => {
  it("binds to the jQuery it is given, which a bundler leaves off window", async () => {
    const { init, warn, traceway } = await load();
    const jq = fakeJQuery();
    init({ token: "tok", baseUrl: "https://traceway.test", jQuery: jq.$ as never });
    expect(jq.$).toHaveBeenCalledWith(document);
    jq.fire({}, { status: 500, statusText: "Server Error" }, { url: "/a", type: "post" }, "Server Error");
    expect(traceway.captureExceptionWithAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ message: "POST /a failed: 500 Server Error" }),
      { url: "/a", method: "POST", status: "500" },
    );
    expect(traceway.init).toHaveBeenCalledWith(
      expect.objectContaining({ token: "tok", baseUrl: "https://traceway.test" }),
      undefined,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("passes the replay privacy limits through to the browser SDK next to it (§14.5)", async () => {
    const { init, traceway } = await load();
    const jq = fakeJQuery();
    init({
      token: "tok",
      jQuery: jq.$ as never,
      replayImages: "off",
      collection: { replay: { maskAllInputs: true } },
    });
    expect(traceway.init).toHaveBeenCalledWith(
      expect.objectContaining({
        replayImages: "off",
        collection: { replay: { maskAllInputs: true } },
      }),
      undefined,
    );
  });

  it("takes it from the deprecated connection-string form's options too", async () => {
    const { init } = await load();
    const jq = fakeJQuery();
    init("tok@https://traceway.test", { jQuery: jq.$ as never });
    expect(jq.$).toHaveBeenCalledWith(document);
  });

  it("still finds window.jQuery without the option", async () => {
    const { init, warn } = await load();
    const jq = fakeJQuery();
    (globalThis as { jQuery?: unknown }).jQuery = jq.$;
    init({ token: "tok" });
    expect(jq.$).toHaveBeenCalledWith(document);
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns once, without debug, when there is no jQuery to bind to", async () => {
    const { init, warn } = await load();
    init({ token: "tok" });
    init({ token: "tok" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe(
      "Traceway: jQuery was not found on window, so failed $.ajax calls are not reported. Pass it as the jQuery option: init({ token, jQuery: $ })",
    );
  });
});

describe("the published package", () => {
  const dist = (file: string) =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../dist", file), "utf8");

  it("declares no global jQuery or $ types, which would clash with @types/jquery (JS2-10)", () => {
    for (const file of ["index.d.ts", "index.d.mts"]) {
      expect(dist(file)).not.toMatch(/declare global/);
      expect(dist(file)).not.toMatch(/function \$\(/);
    }
  });

  it("the CDN build exposes the same functions and values as the ESM entry (JS2-9)", async () => {
    vi.doUnmock("@tracewayapp/frontend");
    const esm = await import("./index.js");
    const cdn = new Function(`${dist("traceway-jquery.iife.global.js")}\n;return TracewayJQuery;`)();
    expect(Object.keys(cdn).sort()).toEqual(Object.keys(esm).sort());
    expect(Object.keys(cdn)).toEqual(expect.arrayContaining(["recordAction", "getClient", "SDK_VERSION", "init"]));
  });
});
