// CONTRACT §13: the jQuery integration runs inside jQuery's own AJAX event dispatch, which has no try: a throw there
// would skip the request's `complete` callbacks, ajaxComplete and ajaxStop.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tracewayapp/frontend", () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureExceptionWithAttributes: vi.fn(),
  captureMessage: vi.fn(),
  flush: vi.fn(),
}));

import * as traceway from "@tracewayapp/frontend";

let handler: (...args: unknown[]) => void;
(globalThis as any).jQuery = () => ({
  ajaxError: (fn: typeof handler) => {
    handler = fn;
  },
});

const { init } = await import("./index.js");

afterEach(() => {
  vi.mocked(traceway.captureExceptionWithAttributes).mockReset();
  vi.mocked(traceway.init).mockReset();
});

describe("jQuery integration", () => {
  it("init() does not throw when the browser SDK's init fails (JS-1)", () => {
    vi.mocked(traceway.init).mockImplementation(() => {
      throw new Error("sdk bug");
    });
    expect(() => init("", {})).not.toThrow();
    expect(handler).toBeTypeOf("function");
  });

  it("the ajaxError handler never throws (JS-7)", () => {
    vi.mocked(traceway.captureExceptionWithAttributes).mockImplementation(
      () => {
        throw new Error("sdk bug");
      },
    );
    expect(() =>
      handler(
        {},
        { status: 500, statusText: "x" },
        { url: "/a", type: "GET" },
        "err",
      ),
    ).not.toThrow();
    expect(() => handler({}, null, null, null)).not.toThrow();
    expect(() =>
      handler({}, { status: 500 }, { url: "/a", type: {} }, "err"),
    ).not.toThrow();
  });

  it("reports a failed request with its status", () => {
    handler(
      {},
      { status: 500, statusText: "Server Error" },
      { url: "/a", type: "post" },
      "Server Error",
    );
    expect(traceway.captureExceptionWithAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ message: "POST /a failed: 500 Server Error" }),
      { url: "/a", method: "POST", status: "500" },
    );
  });

  it("does not report a request the app aborted (JS-23)", () => {
    handler(
      {},
      { status: 0, statusText: "abort" },
      { url: "/s?q=a", type: "GET" },
      "abort",
    );
    handler(
      {},
      { status: 0, statusText: "abort" },
      { url: "/s?q=ab", type: "GET" },
      "",
    );
    expect(traceway.captureExceptionWithAttributes).not.toHaveBeenCalled();
    // A request that failed without a response is still reported, as the README says.
    handler(
      {},
      { status: 0, statusText: "error" },
      { url: "/s", type: "GET" },
      "",
    );
    expect(traceway.captureExceptionWithAttributes).toHaveBeenCalledWith(
      expect.objectContaining({ message: "GET /s failed: 0 error" }),
      { url: "/s", method: "GET", status: "0" },
    );
  });
});
