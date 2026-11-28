// JS2-15: what `debug: true` says about what is captured and why something is dropped, and the deprecation
// warnings of CONTRACT §16. The SDK writes these with the page's own console.warn, which it takes when it loads, so
// the spy is installed before any module is imported.
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lines = vi.hoisted(() => {
  const lines: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args);
  };
  (globalThis as { restoreWarn?: () => void }).restoreWarn = () => {
    console.warn = original;
  };
  return lines;
});

import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import type { TracewayFrontendOptions } from "./client.js";
import {
  captureException,
  captureMessage,
  currentSessionId,
  flush,
  getClient,
  init,
  shutdown,
  track,
} from "./index.js";

let logs: InMemoryLogRecordExporter;

function options(extra: TracewayFrontendOptions = {}): TracewayFrontendOptions {
  logs = new InMemoryLogRecordExporter();
  return {
    token: "tok_123",
    baseUrl: "https://traceway.test",
    logExporter: logs,
    spanExporter: new InMemorySpanExporter(),
    captureWebVitals: false,
    captureResourceTiming: false,
    sessionRecording: false,
    remoteConfig: false,
    debug: true,
    ...extra,
  };
}

function texts(): string[] {
  return lines.map((args) => String(args[0]));
}

async function exported(): Promise<ReadableLogRecord[]> {
  await flush();
  return logs.getFinishedLogRecords();
}

beforeEach(() => {
  lines.length = 0;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 200 })));
});

afterEach(async () => {
  await shutdown();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

afterAll(() => (globalThis as { restoreWarn?: () => void }).restoreWarn?.());

describe("debug: true (JS2-15)", () => {
  it("says where the SDK sends to when it starts, and that a second init() is ignored", () => {
    init(options());
    expect(texts()).toEqual([
      `Traceway: started (https://traceway.test/api/otel/v1/logs), session ${currentSessionId()}`,
    ]);
    init(options());
    expect(texts()[1]).toBe("Traceway: init() already ran; ignored until shutdown()");
  });

  it("says why an exception or a message was dropped, and the lines are not recorded as the page's logs", async () => {
    init(
      options({
        ignoreErrors: ["Failed to fetch"],
        beforeCapture: (e) => e.message !== "private",
        collection: { signals: { console: { mode: "stream" } } },
      }),
    );
    lines.length = 0;
    captureException(new TypeError("Failed to fetch"));
    captureMessage("private");
    const twice = new Error("twice");
    captureException(twice);
    captureException(twice);
    expect(texts()).toEqual([
      "Traceway: dropped by ignoreErrors: TypeError: Failed to fetch",
      "Traceway: dropped by beforeCapture: private",
      "Traceway: dropped by errorLimits: Error: twice",
    ]);
    const records = await exported();
    expect(records.some((r) => String(r.body ?? "").startsWith("Traceway:"))).toBe(false);
  });

  it("says once that the session upload budget is used up", () => {
    init(options({ baselineSampleRate: 1, collectionLimits: { maxEvents: 1 } }));
    lines.length = 0;
    for (let i = 0; i < 5; i++) track("over the budget");
    expect(texts()).toEqual(["Traceway: session upload budget used up (collectionLimits)"]);
  });

  it("says what a beforeCapture that throws threw, with the page's console.warn, not console.error", () => {
    const error = new Error("callback bug");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    init(
      options({
        beforeCapture: () => {
          throw error;
        },
      }),
    );
    lines.length = 0;
    captureException(new Error("kept"));
    expect(lines).toEqual([["Traceway: beforeCapture threw", error]]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("says when remote config was applied and when it was rejected", () => {
    init(options());
    lines.length = 0;
    const client = getClient() as any;
    client.applyRemoteConfig({
      configMap: { traceway: { body: new TextEncoder().encode("{}") } },
      configHash: Uint8Array.of(0xab, 0x01),
    });
    client.applyRemoteConfig({
      configMap: { traceway: { body: new TextEncoder().encode("{ not json") } },
      configHash: Uint8Array.of(1),
    });
    expect(texts()).toEqual([
      "Traceway: remote config applied (ab01)",
      "Traceway: remote config rejected",
    ]);
  });

  it("is silent without debug", () => {
    init(options({ debug: false, ignoreErrors: ["x"] }));
    captureException(new Error("x"));
    init(options({ debug: false }));
    expect(lines).toEqual([]);
  });
});

describe("deprecation warnings (CONTRACT §16)", () => {
  it("warns once, without debug, that connection strings are deprecated, naming the new form", () => {
    const { token, baseUrl, ...rest } = options({ debug: false });
    void token;
    void baseUrl;
    init("tok_123@https://traceway.test/api/report", rest);
    expect(getClient()!.endpoints.base).toBe("https://traceway.test");
    expect(texts()).toEqual([
      'Traceway: connection strings are deprecated: use init({ token: "…", baseUrl: "https://traceway.test" })',
    ]);
  });
});

describe("setup warnings", () => {
  it("warns once, without debug, about a replayImages that is not a policy (§14.5)", async () => {
    init(options({ debug: false, replayImages: "sometimes" as never }));
    expect(getClient()).not.toBeNull();
    await shutdown();
    init(options({ debug: false, replayImages: false as never }));
    await shutdown();
    init(options({ debug: false, replayImages: "wifi" }));
    expect(texts()).toEqual([
      'Traceway: replayImages must be "off", "wifi" or "always"; the replay records no pictures',
    ]);
  });
});
