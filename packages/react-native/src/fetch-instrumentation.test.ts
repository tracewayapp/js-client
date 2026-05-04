import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TracewayReactNativeClient } from "./client.js";
import {
  installFetchInstrumentation,
  setApiHost,
} from "./fetch-instrumentation.js";

const ORIGINAL_FETCH = globalThis.fetch;

function makeResponse(status: number, contentLength?: number): Response {
  const headers = new Headers();
  if (contentLength !== undefined) {
    headers.set("content-length", String(contentLength));
  }
  return { status, headers } as unknown as Response;
}

describe("installFetchInstrumentation", () => {
  let client: TracewayReactNativeClient;

  beforeEach(() => {
    client = new TracewayReactNativeClient(
      "tok@https://traceway.example.com/api/report",
      { debounceMs: 10_000 },
    );
    setApiHost(null);
  });

  afterEach(() => {
    setApiHost(null);
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("records a network event for a successful fetch", async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse(200, 42));
    globalThis.fetch = inner as unknown as typeof fetch;

    installFetchInstrumentation(client);
    const recordSpy = vi.spyOn(client, "recordNetworkEvent");

    const resp = await fetch("https://api.example.com/users", {
      method: "POST",
      body: "hello",
    });
    expect(resp.status).toBe(200);

    expect(inner).toHaveBeenCalledTimes(1);
    expect(recordSpy).toHaveBeenCalledTimes(1);
    const event = recordSpy.mock.calls[0][0];
    expect(event.method).toBe("POST");
    expect(event.url).toBe("https://api.example.com/users");
    expect(event.statusCode).toBe(200);
    expect(event.requestBytes).toBe(5);
    expect(event.responseBytes).toBe(42);
    expect(event.error).toBeUndefined();
    expect(typeof event.durationMs).toBe("number");
  });

  it("records a network event with an error string when fetch rejects", async () => {
    const inner = vi.fn().mockRejectedValue(new Error("dns failure"));
    globalThis.fetch = inner as unknown as typeof fetch;

    installFetchInstrumentation(client);
    const recordSpy = vi.spyOn(client, "recordNetworkEvent");

    await expect(fetch("https://api.example.com/x")).rejects.toThrow(
      "dns failure",
    );

    expect(recordSpy).toHaveBeenCalledTimes(1);
    const event = recordSpy.mock.calls[0][0];
    expect(event.statusCode).toBeUndefined();
    expect(event.error).toContain("dns failure");
  });

  it("skips calls to the configured Traceway api host", async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse(200));
    globalThis.fetch = inner as unknown as typeof fetch;

    installFetchInstrumentation(client);
    setApiHost("traceway.example.com");
    const recordSpy = vi.spyOn(client, "recordNetworkEvent");

    await fetch("https://traceway.example.com/api/report", {
      method: "POST",
      body: "{}",
    });

    expect(inner).toHaveBeenCalledTimes(1);
    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("falls through cleanly when fetch is not defined", () => {
    const before = globalThis.fetch;
    delete (globalThis as Record<string, unknown>).fetch;
    expect(() => installFetchInstrumentation(client)).not.toThrow();
    globalThis.fetch = before;
  });

  it("infers method from a Request-like input", async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse(204));
    globalThis.fetch = inner as unknown as typeof fetch;

    installFetchInstrumentation(client);
    const recordSpy = vi.spyOn(client, "recordNetworkEvent");

    const requestLike = {
      url: "https://api.example.com/widgets",
      method: "DELETE",
    } as unknown as RequestInfo;
    await fetch(requestLike);

    const event = recordSpy.mock.calls[0][0];
    expect(event.method).toBe("DELETE");
    expect(event.url).toBe("https://api.example.com/widgets");
  });
});
