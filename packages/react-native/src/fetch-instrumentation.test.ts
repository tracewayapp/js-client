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

  it("does NOT inject the traceway-trace-id header by default (empty allow-list)", async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse(200));
    globalThis.fetch = inner as unknown as typeof fetch;

    installFetchInstrumentation(client);
    await fetch("https://api.example.com/users");

    expect(inner).toHaveBeenCalledTimes(1);
    const [, init] = inner.mock.calls[0];
    const headers = init?.headers ? new Headers(init.headers) : new Headers();
    expect(headers.get("traceway-trace-id")).toBeNull();
  });

  it("injects the traceway-trace-id header when host matches the allow-list", async () => {
    const trackedClient = new TracewayReactNativeClient(
      "tok@https://traceway.example.com/api/report",
      { debounceMs: 10_000, distributedTraceHosts: ["api.example.com"] },
    );
    const inner = vi.fn().mockResolvedValue(makeResponse(200));
    globalThis.fetch = inner as unknown as typeof fetch;

    installFetchInstrumentation(trackedClient);
    await fetch("https://api.example.com/users");

    expect(inner).toHaveBeenCalledTimes(1);
    const [, init] = inner.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("traceway-trace-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("does not inject for unmatched hosts", async () => {
    const trackedClient = new TracewayReactNativeClient(
      "tok@https://traceway.example.com/api/report",
      { debounceMs: 10_000, distributedTraceHosts: ["api.example.com"] },
    );
    const inner = vi.fn().mockResolvedValue(makeResponse(200));
    globalThis.fetch = inner as unknown as typeof fetch;

    installFetchInstrumentation(trackedClient);
    await fetch("https://other.example.com/users");

    const [, init] = inner.mock.calls[0];
    const headers = new Headers(((init as RequestInit) ?? {}).headers);
    expect(headers.get("traceway-trace-id")).toBeNull();
  });

  it("does NOT promote 5xx responses to captured exceptions by default", async () => {
    const inner = vi.fn().mockResolvedValue(makeResponse(503));
    globalThis.fetch = inner as unknown as typeof fetch;

    installFetchInstrumentation(client);
    const captureSpy = vi.spyOn(client, "captureHttpServerError");

    await fetch("https://api.example.com/x");

    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("promotes 5xx responses to captured exceptions when captureHttpServerErrors is true", async () => {
    const errClient = new TracewayReactNativeClient(
      "tok@https://traceway.example.com/api/report",
      { debounceMs: 10_000, captureHttpServerErrors: true },
    );
    const inner = vi.fn().mockResolvedValue(makeResponse(502));
    globalThis.fetch = inner as unknown as typeof fetch;

    installFetchInstrumentation(errClient);
    const captureSpy = vi.spyOn(errClient, "captureHttpServerError");

    await fetch("https://api.example.com/x");

    expect(captureSpy).toHaveBeenCalledWith("GET", "https://api.example.com/x", 502);
  });

  it("does NOT promote 4xx responses even when captureHttpServerErrors is true", async () => {
    const errClient = new TracewayReactNativeClient(
      "tok@https://traceway.example.com/api/report",
      { debounceMs: 10_000, captureHttpServerErrors: true },
    );
    const inner = vi.fn().mockResolvedValue(makeResponse(404));
    globalThis.fetch = inner as unknown as typeof fetch;

    installFetchInstrumentation(errClient);
    const captureSpy = vi.spyOn(errClient, "captureHttpServerError");

    await fetch("https://api.example.com/x");

    expect(captureSpy).not.toHaveBeenCalled();
  });

  it("supports a RegExp entry in distributedTraceHosts", async () => {
    const trackedClient = new TracewayReactNativeClient(
      "tok@https://traceway.example.com/api/report",
      { debounceMs: 10_000, distributedTraceHosts: [/\.example\.com$/] },
    );
    const inner = vi.fn().mockResolvedValue(makeResponse(200));
    globalThis.fetch = inner as unknown as typeof fetch;

    installFetchInstrumentation(trackedClient);
    await fetch("https://api.example.com/users");

    const [, init] = inner.mock.calls[0];
    const headers = new Headers((init as RequestInit).headers);
    expect(headers.get("traceway-trace-id")).not.toBeNull();
  });
});
