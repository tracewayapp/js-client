import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TracewayReactNativeClient } from "./client.js";
import {
  installXhrInstrumentation,
  setXhrApiHost,
} from "./xhr-instrumentation.js";

type Listener = (event?: unknown) => void;

class FakeXHR {
  static lastInstance: FakeXHR | null = null;

  status = 0;
  statusText = "";
  private listeners: Record<string, Listener[]> = {};
  private headers: Record<string, string> = {};
  public lastBody: unknown = undefined;

  constructor() {
    FakeXHR.lastInstance = this;
  }

  open(_method: string, _url: string | URL): void {
    // Stays empty — the Traceway instrumentation captures method/url before
    // delegating here.
  }

  send(body?: unknown): void {
    this.lastBody = body;
  }

  addEventListener(name: string, fn: Listener): void {
    (this.listeners[name] ??= []).push(fn);
  }

  removeEventListener(name: string, fn: Listener): void {
    this.listeners[name] = (this.listeners[name] ?? []).filter((l) => l !== fn);
  }

  getResponseHeader(name: string): string | null {
    return this.headers[name.toLowerCase()] ?? null;
  }

  // Test helpers
  fire(name: string): void {
    for (const l of this.listeners[name] ?? []) l();
  }

  setResponse(status: number, contentLength?: number, statusText?: string): void {
    this.status = status;
    if (statusText !== undefined) this.statusText = statusText;
    if (contentLength !== undefined) {
      this.headers["content-length"] = String(contentLength);
    }
  }
}

describe("installXhrInstrumentation", () => {
  let client: TracewayReactNativeClient;
  let originalXHR: typeof XMLHttpRequest | undefined;

  beforeEach(() => {
    client = new TracewayReactNativeClient(
      "tok@https://traceway.example.com/api/report",
      { debounceMs: 10_000 },
    );
    setXhrApiHost(null);
    originalXHR = (globalThis as { XMLHttpRequest?: typeof XMLHttpRequest })
      .XMLHttpRequest;
    (globalThis as Record<string, unknown>).XMLHttpRequest = FakeXHR;
  });

  afterEach(() => {
    setXhrApiHost(null);
    if (originalXHR !== undefined) {
      (globalThis as Record<string, unknown>).XMLHttpRequest = originalXHR;
    } else {
      delete (globalThis as Record<string, unknown>).XMLHttpRequest;
    }
    FakeXHR.lastInstance = null;
    vi.restoreAllMocks();
  });

  it("records a network event when an XHR succeeds", () => {
    installXhrInstrumentation(client);
    const recordSpy = vi.spyOn(client, "recordNetworkEvent");

    const xhr = new (globalThis as unknown as { XMLHttpRequest: typeof FakeXHR })
      .XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/users");
    xhr.send(undefined);
    xhr.setResponse(200, 128);
    xhr.fire("load");

    expect(recordSpy).toHaveBeenCalledTimes(1);
    const event = recordSpy.mock.calls[0][0];
    expect(event.method).toBe("GET");
    expect(event.url).toBe("https://api.example.com/users");
    expect(event.statusCode).toBe(200);
    expect(event.responseBytes).toBe(128);
    expect(event.error).toBeUndefined();
  });

  it("records the request body byte count", () => {
    installXhrInstrumentation(client);
    const recordSpy = vi.spyOn(client, "recordNetworkEvent");

    const xhr = new (globalThis as unknown as { XMLHttpRequest: typeof FakeXHR })
      .XMLHttpRequest();
    xhr.open("POST", "https://api.example.com/widgets");
    xhr.send("payload-string");
    xhr.setResponse(201);
    xhr.fire("load");

    const event = recordSpy.mock.calls[0][0];
    expect(event.method).toBe("POST");
    expect(event.requestBytes).toBe("payload-string".length);
  });

  it("records an error string when the request fails", () => {
    installXhrInstrumentation(client);
    const recordSpy = vi.spyOn(client, "recordNetworkEvent");

    const xhr = new (globalThis as unknown as { XMLHttpRequest: typeof FakeXHR })
      .XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/oops");
    xhr.send();
    xhr.setResponse(0, undefined, "boom");
    xhr.fire("error");

    const event = recordSpy.mock.calls[0][0];
    expect(event.statusCode).toBeUndefined();
    expect(event.error).toContain("boom");
  });

  it("only records once even if both load and error fire", () => {
    installXhrInstrumentation(client);
    const recordSpy = vi.spyOn(client, "recordNetworkEvent");

    const xhr = new (globalThis as unknown as { XMLHttpRequest: typeof FakeXHR })
      .XMLHttpRequest();
    xhr.open("GET", "https://api.example.com/once");
    xhr.send();
    xhr.setResponse(200);
    xhr.fire("load");
    xhr.fire("error");

    expect(recordSpy).toHaveBeenCalledTimes(1);
  });

  it("skips Traceway's own ingestion endpoint", () => {
    installXhrInstrumentation(client);
    setXhrApiHost("traceway.example.com");
    const recordSpy = vi.spyOn(client, "recordNetworkEvent");

    const xhr = new (globalThis as unknown as { XMLHttpRequest: typeof FakeXHR })
      .XMLHttpRequest();
    xhr.open("POST", "https://traceway.example.com/api/report");
    xhr.send("{}");
    xhr.setResponse(200);
    xhr.fire("load");

    expect(recordSpy).not.toHaveBeenCalled();
  });

  it("does nothing when XMLHttpRequest is absent", () => {
    delete (globalThis as Record<string, unknown>).XMLHttpRequest;
    expect(() => installXhrInstrumentation(client)).not.toThrow();
  });
});
