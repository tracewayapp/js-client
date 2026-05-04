import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { gunzipSync, strFromU8 } from "fflate";

vi.mock("./device-info.js", () => ({
  collectSyncDeviceInfo: () => ({
    "os.name": "ios",
    "os.version": "17.4",
    "screen.resolution": "393x852",
    "screen.density": "3.0",
    "runtime.engine": "hermes",
  }),
}));

import {
  init,
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  recordAction,
  recordNavigation,
  setDeviceAttributes,
  flush,
  _resetForTesting,
  _getClient,
} from "./sdk.js";

const ORIGINAL_FETCH = globalThis.fetch;
let mockFetch: ReturnType<typeof vi.fn>;

function lastReportBody(): {
  collectionFrames: Array<{
    stackTraces: Array<{
      stackTrace: string;
      isMessage: boolean;
      attributes?: Record<string, string>;
      sessionRecordingId?: string;
      distributedTraceId?: string;
    }>;
    sessionRecordings?: Array<{
      logs?: Array<{ message: string }>;
      actions?: Array<{
        type: string;
        name?: string;
        from?: string;
        to?: string;
      }>;
    }>;
  }>;
  appVersion: string;
} {
  const calls = mockFetch.mock.calls;
  const last = calls[calls.length - 1];
  const init = last[1] as RequestInit;
  const body = init.body;
  if (!(body instanceof Uint8Array)) {
    throw new Error("expected gzipped Uint8Array body");
  }
  return JSON.parse(strFromU8(gunzipSync(body)));
}

describe("react-native sdk facade", () => {
  beforeEach(() => {
    // Note: init() calls installFetchInstrumentation which wraps globalThis.fetch.
    // So globalThis.fetch is no longer our mock after init — it's the wrapper.
    // We hold a direct reference to the underlying mock to inspect calls.
    mockFetch = vi.fn().mockResolvedValue({ status: 200 });
    globalThis.fetch = mockFetch as unknown as typeof fetch;
  });

  afterEach(() => {
    _resetForTesting();
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it("captureException is a no-op before init", () => {
    captureException(new Error("nope"));
    expect(_getClient()).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("init constructs a client and captureException flows through it", async () => {
    init("tok@https://example.com/api/report", {
      debounceMs: 20,
      version: "9.9.9",
      ignoreErrors: [],
    });
    expect(_getClient()).not.toBeNull();

    captureException(new Error("first"));
    await flush();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const body = lastReportBody();
    expect(body.appVersion).toBe("9.9.9");
    const trace = body.collectionFrames[0].stackTraces[0];
    expect(trace.isMessage).toBe(false);
    expect(trace.stackTrace).toContain("first");
  });

  it("captureExceptionWithAttributes attaches the attribute map", async () => {
    init("tok@https://example.com/api/report", {
      debounceMs: 20,
      ignoreErrors: [],
      captureDeviceInfo: false,
    });

    captureExceptionWithAttributes(new Error("attrs"), {
      tenant: "acme",
      region: "us-east",
    });
    await flush();

    const trace = lastReportBody().collectionFrames[0].stackTraces[0];
    expect(trace.attributes).toEqual({ tenant: "acme", region: "us-east" });
  });

  it("captureMessage records as a message (not an exception)", async () => {
    init("tok@https://example.com/api/report", { debounceMs: 20 });

    captureMessage("user reached checkout");
    await flush();

    const trace = lastReportBody().collectionFrames[0].stackTraces[0];
    expect(trace.isMessage).toBe(true);
    expect(trace.stackTrace).toBe("user reached checkout");
  });

  it("recordAction and recordNavigation ride along the next exception", async () => {
    init("tok@https://example.com/api/report", {
      debounceMs: 20,
      ignoreErrors: [],
    });

    recordAction("cart", "add_item", { sku: "X" });
    recordNavigation("Home", "Cart");
    captureException(new Error("ship-it"));
    await flush();

    const recording = lastReportBody().collectionFrames[0]
      .sessionRecordings![0];
    const types = (recording.actions ?? []).map((a) => a.type);
    expect(types).toContain("custom");
    expect(types).toContain("navigation");

    const navEvent = (recording.actions ?? []).find(
      (a) => a.type === "navigation",
    );
    expect(navEvent?.from).toBe("Home");
    expect(navEvent?.to).toBe("Cart");
  });

  it("attaches a distributedTraceId when supplied", async () => {
    init("tok@https://example.com/api/report", {
      debounceMs: 20,
      ignoreErrors: [],
    });

    captureException(new Error("dist"), { distributedTraceId: "trace-abc" });
    await flush();

    const trace = lastReportBody().collectionFrames[0].stackTraces[0];
    expect(trace.distributedTraceId).toBe("trace-abc");
  });

  it("flush is a no-op before init", async () => {
    await expect(flush()).resolves.toBeUndefined();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("init auto-collects device info and attaches it to every report", async () => {
    init("tok@https://example.com/api/report", {
      debounceMs: 20,
      ignoreErrors: [],
    });

    const attrs = _getClient()!.bufferedDeviceAttributes();
    expect(attrs["os.name"]).toBe("ios");
    expect(attrs["os.version"]).toBe("17.4");
    expect(attrs["screen.resolution"]).toBe("393x852");
    expect(attrs["screen.density"]).toBe("3.0");

    captureException(new Error("with-device"));
    await flush();

    const trace = lastReportBody().collectionFrames[0].stackTraces[0];
    expect(trace.attributes?.["os.name"]).toBe("ios");
    expect(trace.attributes?.["screen.resolution"]).toBe("393x852");
  });

  it("captureDeviceInfo: false skips auto-collection at init", async () => {
    init("tok@https://example.com/api/report", {
      debounceMs: 20,
      ignoreErrors: [],
      captureDeviceInfo: false,
    });

    expect(_getClient()!.bufferedDeviceAttributes()).toEqual({});

    captureException(new Error("no-device"));
    await flush();

    const trace = lastReportBody().collectionFrames[0].stackTraces[0];
    expect(trace.attributes).toBeUndefined();
  });

  it("setDeviceAttributes from the public facade replaces the map", async () => {
    init("tok@https://example.com/api/report", {
      debounceMs: 20,
      ignoreErrors: [],
    });

    setDeviceAttributes({ tenant: "acme", region: "us-east" });

    captureException(new Error("custom-attrs"));
    await flush();

    const trace = lastReportBody().collectionFrames[0].stackTraces[0];
    // The original device-collected keys are gone; replaced with our custom set.
    expect(trace.attributes).toEqual({ tenant: "acme", region: "us-east" });
  });

  it("init wires the apiHost so self-reports are not re-recorded as network events", async () => {
    init("tok@https://traceway.example.com/api/report", {
      debounceMs: 20,
      ignoreErrors: [],
    });

    captureException(new Error("recurse"));
    await flush();

    const body = lastReportBody();
    const networkEvents =
      body.collectionFrames[0].sessionRecordings?.[0]?.actions?.filter(
        (a) => a.type === "network",
      ) ?? [];
    expect(networkEvents).toHaveLength(0);
  });
});
