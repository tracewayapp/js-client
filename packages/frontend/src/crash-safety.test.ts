/**
 * CONTRACT §13: the SDK never takes the page down. Internal pieces are made to fail and the page's own operation must
 * still complete, unchanged, while the SDK keeps working afterwards; every public function is called before
 * `init()`, after `shutdown()`, twice, concurrently and with garbage; the page's own crashes still reach the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The fetch instrumentation only patches fetch where PerformanceObserver exists, looked up when its module loads.
vi.hoisted(() => {
  const g = globalThis as { PerformanceObserver?: unknown };
  g.PerformanceObserver ??= class {
    static supportedEntryTypes: string[] = [];
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  };
});

import { context, propagation } from "@opentelemetry/api";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import { NavigationInstrumentation } from "@opentelemetry/browser-instrumentation/experimental/navigation";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import {
  InMemorySpanExporter,
  StackContextManager,
} from "@opentelemetry/sdk-trace";
import {
  ControlState,
  RingBuffer,
  TriggerEngine,
  ceilingsFrom,
  defaultSettings,
} from "@tracewayapp/core";
import { IDBFactory } from "fake-indexeddb";
import {
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  clearAttributes,
  count,
  currentSessionId,
  flush,
  getClient,
  getInstanceId,
  init,
  log,
  metric,
  recordAction,
  recordNavigation,
  refreshConfig,
  removeAttribute,
  setAttribute,
  setAttributes,
  setMetricDimension,
  setRoute,
  shutdown,
  startInteraction,
  tracer,
  track,
  trackRouter,
} from "./index.js";
import { forgetRouters } from "./otel/route-detect.js";
import { ScreenState } from "./screen-state.js";
import { ImageInliner } from "./replay/inline-images.js";
import type { TracewayFrontendOptions } from "./client.js";
import { MetricsRecorder } from "./otel/metrics-recorder.js";
import { interactionTargets } from "./otel/interaction-targets.js";
import { listenForSequenceActions } from "./sequence-listener.js";
import { RecordingsTransport } from "./transport/recordings.js";
import { TelemetryPersistence } from "./persistence/telemetry-persistence.js";
import { resetDatabase } from "./persistence/idb.js";
import { SessionRecorder } from "./session-recorder.js";
import type { BufferedItem } from "./otel/router.js";

const CS = { token: "tok_123", baseUrl: "https://traceway.test" };
let logs: InMemoryLogRecordExporter;
let spans: InMemorySpanExporter;
let network: ReturnType<typeof vi.fn>;
let pageErrors: unknown[];
const onPageError = (event: ErrorEvent) => pageErrors.push(event.error);

function options(extra: TracewayFrontendOptions = {}): TracewayFrontendOptions {
  logs = new InMemoryLogRecordExporter();
  spans = new InMemorySpanExporter();
  return {
    logExporter: logs,
    spanExporter: spans,
    captureWebVitals: false,
    captureResourceTiming: false,
    sessionRecording: false,
    remoteConfig: false,
    ...extra,
  };
}

async function exported(): Promise<ReadableLogRecord[]> {
  await flush();
  return logs.getFinishedLogRecords();
}

function exceptions(records: ReadableLogRecord[]): string[] {
  return records
    .filter((r) => r.eventName === "exception")
    .map((r) => String(r.attributes["exception.message"]));
}

/** An object whose every read throws, as a revoked proxy or a hostile getter would. */
function hostile(): any {
  const { proxy, revoke } = Proxy.revocable({}, {});
  revoke();
  return proxy;
}

beforeEach(() => {
  pageErrors = [];
  addEventListener("error", onPageError);
  network = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", network);
});

afterEach(async () => {
  await shutdown();
  removeEventListener("error", onPageError);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sessionStorage.clear();
  localStorage.clear();
});

describe("init() never throws (JS-1)", () => {
  it.each([
    [""],
    ["no-at-sign"],
    [undefined],
    [null],
    [42],
    [{}],
    // CONTRACT §16.1: deprecated strings it cannot read.
    ["@https://cloud.tracewayapp.com"],
    ["tok@"],
    ["tok@ftp://host"],
    [{ token: "tok", baseUrl: "ftp://host" }],
  ])(
    "init(%p) warns once and leaves the SDK off",
    (connectionString) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      expect(() => init(connectionString as any)).not.toThrow();
      expect(getClient()).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(() => captureException(new Error("x"))).not.toThrow();
    },
  );

  it("accepts null options and options it cannot use", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    // The deprecated connection-string form, whose second argument may be anything.
    expect(() => init("tok_123@https://traceway.test", null as any)).not.toThrow();
    expect(getClient()).not.toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it("stays off with a telemetry URL it cannot use, and a later correct init() starts it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      init({ ...CS, ...options({ telemetry: { url: "not a url" } }) }),
    ).not.toThrow();
    expect(getClient()).toBeNull();
    init({ ...CS, ...options() });
    captureException(new Error("after the bad init"));
    expect(exceptions(await exported())).toEqual(["after the bad init"]);
  });

  it("undoes a start that failed half-way, so nothing of it keeps running", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const failing = vi
      .spyOn(MetricsRecorder.prototype, "start")
      .mockImplementation(() => {
        throw new Error("sdk bug");
      });
    expect(() => init({ ...CS, ...options({ baselineSampleRate: 1 }) })).not.toThrow();
    expect(getClient()).toBeNull();
    const halfStarted = logs;
    console.error("after the failed start");
    window.dispatchEvent(
      new ErrorEvent("error", { error: new Error("page error") }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(halfStarted.getFinishedLogRecords()).toEqual([]);

    failing.mockRestore();
    init({ ...CS, ...options() });
    captureException(new Error("second start"));
    expect(exceptions(await exported())).toEqual(["second start"]);
  });

  it("keeps reporting exceptions when ignoreErrors holds garbage", async () => {
    init({ ...CS, ...options({ ignoreErrors: [undefined, 42, {}, "ignored-text"] as any }) });
    captureException(new Error("kept"));
    captureException(new Error("an ignored-text error"));
    expect(exceptions(await exported())).toEqual(["kept"]);
  });

  it("treats ignoreErrors that is not a list as the default list", async () => {
    init({ ...CS, ...options({ ignoreErrors: "kept" as any }) });
    captureException(new Error("kept"));
    expect(exceptions(await exported())).toEqual(["kept"]);
  });

  it("starts where reading indexedDB throws (site data blocked) (JS-5)", async () => {
    Object.defineProperty(globalThis, "indexedDB", {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    try {
      expect(() => init({ ...CS, ...options() })).not.toThrow();
      expect(getClient()).not.toBeNull();
      captureException(new Error("without storage"));
      expect(exceptions(await exported())).toEqual(["without storage"]);
    } finally {
      delete (globalThis as any).indexedDB;
    }
  });
});

describe("the public API before init(), after shutdown(), twice and with garbage (§13.1)", () => {
  function callEverything(): void {
    captureException(new Error("e"));
    captureExceptionWithAttributes(new Error("e"), { a: "b" });
    captureMessage("m");
    log("l", "warn");
    recordAction("ui", "tap", { a: 1 });
    track("t");
    metric("checkout.duration", 1);
    count("cart.added");
    setRoute("/orders/:id");
    recordNavigation("/orders/42", "push", "/orders", "/orders/:id");
    tracer()?.startSpan("mine").end();
    setMetricDimension("plan", "pro");
    setAttribute("k", "v");
    setAttributes({ k: "v" });
    removeAttribute("k");
    clearAttributes();
    currentSessionId();
    getInstanceId();
    const interaction = startInteraction("checkout");
    interaction.run(() => undefined);
    interaction.bind(() => undefined)();
    interaction.captureException(new Error("e"));
    interaction.end();
  }

  it("does nothing, and throws nothing, before init() and after shutdown()", async () => {
    expect(callEverything).not.toThrow();
    await expect(flush(10)).resolves.toBeUndefined();
    await expect(refreshConfig()).resolves.toBeUndefined();
    await expect(shutdown()).resolves.toBeUndefined();
    init({ ...CS, ...options() });
    await shutdown();
    expect(callEverything).not.toThrow();
    await expect(shutdown()).resolves.toBeUndefined();
  });

  it("startInteraction() runs the work and returns its result before init() (JS-2)", () => {
    const work = vi.fn((a: number) => a * 2);
    const interaction = startInteraction("checkout");
    expect(interaction.run(() => work(21))).toBe(42);
    expect(interaction.bind(work)(2)).toBe(4);
    expect(interaction.traceId).toBeNull();
    expect(() => {
      interaction.captureException(new Error("e"));
      interaction.end();
    }).not.toThrow();
  });

  it("still throws the app's own error out of run() and bind()", () => {
    init({ ...CS, ...options() });
    const interaction = startInteraction("checkout");
    const appError = new Error("app");
    const fail = () => {
      throw appError;
    };
    expect(() => interaction.run(fail)).toThrow(appError);
    expect(() => interaction.bind(fail)()).toThrow(appError);
  });

  it("is a no-op when called twice and survives calls that interleave", async () => {
    init({ ...CS, ...options() });
    const first = getClient();
    init({ ...CS, ...options() });
    expect(getClient()).toBe(first);
    const calls = [flush(), shutdown(), flush(), refreshConfig()];
    init({ ...CS, ...options() });
    calls.push(shutdown(), flush());
    init({ ...CS, ...options() });
    await expect(Promise.all(calls)).resolves.toBeDefined();
    captureException(new Error("after the interleaving"));
    expect(exceptions(await exported())).toEqual(["after the interleaving"]);
  });

  it("throws nothing for arguments it cannot use, and keeps working", async () => {
    init({ ...CS, ...options() });
    const circular: any = { name: "loop" };
    circular.self = circular;
    const badError = new Error("bad");
    Object.defineProperty(badError, "stack", {
      get() {
        throw new Error("getter");
      },
    });
    expect(() => {
      setRoute(42 as any);
      setMetricDimension(42 as any, {} as any);
      metric(Symbol("m") as any, NaN, hostile());
      count("cart.added", "x" as any, hostile());
      setAttributes(hostile());
      setAttribute(undefined as any, undefined as any);
      track("t", hostile());
      log("l", "nope" as any, hostile());
      captureMessage(42 as any, hostile());
      captureException(badError);
      captureException(hostile());
      recordAction("ui", "circular", circular); // JS-4
      recordAction("ui", "bigint", { amount: 10n } as any);
      startInteraction(hostile()).run(() => undefined);
      recordNavigation(hostile());
      recordNavigation("/x", hostile(), hostile(), hostile());
      setRoute(hostile());
    }).not.toThrow();
    captureException(new Error("still working"));
    const records = await exported();
    expect(exceptions(records)).toContain("still working");
    expect(pageErrors).toEqual([]);
  });

  it("records action data that JSON.stringify cannot write (JS-4)", async () => {
    init({ ...CS, ...options() });
    getClient()!.control.applyRemote({
      signals: { custom: { mode: "stream" } },
    });
    const circular: any = { step: "pay" };
    circular.self = circular;
    recordAction("ui", "circular", circular);
    recordAction("ui", "bigint", { amount: 10n } as any);
    const data = (await exported())
      .filter((r) => r.eventName === "traceway.action")
      .map((r) => r.attributes["traceway.action.data"]);
    expect(data).toEqual(['{"step":"pay","self":"[…]"}', '{"amount":"10"}']);
  });
});

describe("console.* (JS-3)", () => {
  it("never throws because of the SDK, and the native method still runs", () => {
    const native = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    init({ ...CS, ...options() });
    const revoked = hostile();
    const nullProto: any = Object.create(null);
    nullProto.self = nullProto;
    expect(() => console.log(revoked)).not.toThrow();
    expect(() => console.error(nullProto)).not.toThrow();
    // The very object the page passed, compared by identity: equality would read the revoked proxy.
    expect(native.mock.calls[0]![0]).toBe(revoked);
  });

  it("does not run the page's getters and writes plain values as before", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    init({ ...CS, ...options() });
    getClient()!.control.applyRemote({
      signals: { console: { mode: "stream", minSeverity: "trace" } },
    });
    let reads = 0;
    const observed = {
      get x() {
        reads++;
        return 1;
      },
      toJSON() {
        reads++;
        return {};
      },
      kept: [1, "two", null],
    };
    console.log(observed);
    console.log("cart", { items: 3 }, 7);
    expect(reads).toBe(0);
    const bodies = (await exported())
      .filter((r) => r.eventName === "browser.console")
      .map((r) => r.body);
    expect(bodies).toEqual(['{"kept":[1,"two",null]}', 'cart {"items":3} 7']);
  });
});

describe("listeners and timers contain SDK failures (JS-8)", () => {
  afterEach(() => {
    delete (document as any).visibilityState;
  });

  it("a failure on visibilitychange stays inside the SDK and is not reported as the page's", async () => {
    init({ ...CS, ...options() });
    const client = getClient() as any;
    client.metrics.flush = () => {
      throw new Error("sdk");
    };
    client.flushQueued = () => {
      throw new Error("sdk");
    };
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });
    expect(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    ).not.toThrow();
    window.dispatchEvent(new Event("pagehide"));
    expect(pageErrors).toEqual([]);
    delete client.flushQueued;
    expect(exceptions(await exported())).not.toContain("sdk");
  });

  it("keeps the metrics flush timer going after a flush that failed", () => {
    vi.useFakeTimers();
    init({ ...CS, ...options() });
    const flushes = vi.fn(() => {
      throw new Error("sdk");
    });
    (getClient() as any).metrics.flush = flushes;
    vi.advanceTimersByTime(2 * 300_000 + 10);
    expect(flushes).toHaveBeenCalledTimes(2);
  });

  it("contains failures of the trigger listener in the page's click dispatch", () => {
    const add = vi.spyOn(document, "addEventListener");
    const stop = listenForSequenceActions(() => {
      throw new Error("sdk");
    });
    const listener = add.mock.calls.find(([type]) => type === "click")![1] as (
      e: unknown,
    ) => void;
    const trusted = {
      isTrusted: true,
      type: "click",
      composedPath: () => [document.body],
    };
    expect(() => listener(trusted)).not.toThrow();
    stop();
  });

  it("contains failures of the input listener that names interaction targets", () => {
    interactionTargets.retain();
    const names = (interactionTargets as any).names;
    (interactionTargets as any).names = {
      has() {
        throw new Error("sdk");
      },
    };
    const button = document.createElement("button");
    document.body.append(button);
    const page = vi.fn();
    button.addEventListener("pointerdown", page);
    button.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(page).toHaveBeenCalled();
    expect(pageErrors).toEqual([]);
    (interactionTargets as any).names = names;
    interactionTargets.release();
    button.remove();
  });

  it("contains click recording failures, and the page's click handler still runs", async () => {
    init({ ...CS, ...options() });
    const button = document.createElement("button");
    document.body.append(button);
    const page = vi.fn();
    button.addEventListener("click", page);
    vi.spyOn(Element.prototype, "hasAttribute").mockImplementation(() => {
      throw new Error("sdk");
    });
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    expect(page).toHaveBeenCalled();
    expect(pageErrors).toEqual([]);
    button.remove();
  });

  it("contains failures of the navigation record in the app's history.pushState", () => {
    init({ ...CS, ...options() });
    const descriptor = Object.getOwnPropertyDescriptor(
      NavigationInstrumentation.prototype,
      "logger",
    );
    Object.defineProperty(NavigationInstrumentation.prototype, "logger", {
      configurable: true,
      get() {
        throw new Error("sdk");
      },
    });
    try {
      expect(() => history.pushState({}, "", "/after-push")).not.toThrow();
      expect(location.pathname).toBe("/after-push");
      expect(() =>
        window.dispatchEvent(new PopStateEvent("popstate")),
      ).not.toThrow();
    } finally {
      if (descriptor)
        Object.defineProperty(
          NavigationInstrumentation.prototype,
          "logger",
          descriptor,
        );
      else delete (NavigationInstrumentation.prototype as any).logger;
      history.replaceState({}, "", "/");
    }
  });

  it("contains failures of the health and capture timers", () => {
    vi.useFakeTimers();
    init({ ...CS, ...options({ collectionLimits: { maxEvents: 1 }, baselineSampleRate: 1 }) });
    const client = getClient() as any;
    client.emitSessionEvent = () => {
      throw new Error("sdk");
    };
    client.applyReplay = () => {
      throw new Error("sdk");
    };
    track("one");
    track("two");
    track("over the limit");
    client.control.applyRemote({
      captures: [
        { id: "c", until: new Date(Date.now() + 5_000).toISOString() },
      ],
    });
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
  });
});

describe("replay recording inside the page's own CSSOM calls (JS-6)", () => {
  it("an SDK failure while recording does not break insertRule, and the page's own errors still throw", async () => {
    const recorder = new SessionRecorder();
    await recorder.start();
    const style = document.createElement("style");
    document.head.append(style);
    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      (recorder as any).onEvent = () => {
        throw new Error("sdk bug");
      };
      expect(() =>
        style.sheet!.insertRule(".a { color: red; }", 0),
      ).not.toThrow();
      expect(style.sheet!.cssRules.length).toBe(1);
      expect(() => style.sheet!.insertRule("}{ not a rule", 0)).toThrow();
    } finally {
      recorder.stop();
      style.remove();
    }
  });
});

describe("clicks (JS-17)", () => {
  it("records a click on an icon inside a button as a click on the button", async () => {
    // jsdom has no CSS.escape, which the selector of an element with classes needs.
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    init({ ...CS, ...options() });
    getClient()!.control.applyRemote({
      signals: { userActions: { mode: "stream" } },
    });
    document.body.innerHTML = `<button class="pay"><svg><path></path></svg></button>`;
    document
      .querySelector("path")!
      .dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
    const clicks = (await exported()).filter(
      (r) => r.eventName === "browser.user_action.click",
    );
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.attributes["browser.tag_name"]).toBe("BUTTON");
    document.body.replaceChildren();
  });
});

describe("the fetch instrumentation (JS-12, JS-15, JS-10)", () => {
  it("lets the app's body.cancel() stop the download", async () => {
    let pulls = 0;
    let cancelled = false;
    network.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            pull(controller) {
              pulls++;
              controller.enqueue(new Uint8Array(1024));
            },
            cancel() {
              cancelled = true;
            },
          }),
        ),
    );
    init({ ...CS, ...options() });
    const response = await fetch(`${location.origin}/stream`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await response.body!.cancel();
    expect(cancelled).toBe(true);
    const pulled = pulls;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(pulls).toBe(pulled);
    expect(typeof response.clone).toBe("function");
    expect(Object.prototype.hasOwnProperty.call(response, "clone")).toBe(false);
  });

  it("ends the span when the response arrives, also for a body that never ends", async () => {
    network.mockImplementation(
      async () => new Response(new ReadableStream({ pull() {} })),
    );
    init({ ...CS, ...options() });
    getClient()!.control.applyRemote({
      signals: { network: { mode: "stream" } },
    });
    const response = await fetch(`${location.origin}/long-poll`);
    await flush();
    const span = spans
      .getFinishedSpans()
      .find((s) => s.attributes["url.full"] === `${location.origin}/long-poll`);
    expect(span?.attributes["http.response.status_code"]).toBe(200);
    await response.body!.cancel();
  });

  it("does not change the app's own Request, and still sends traceparent (JS-15, JS-10)", async () => {
    init({ ...CS, ...options() });
    const request = new Request(`${location.origin}/api`, {
      headers: { "x-app": "1" },
    });
    await fetch(request);
    expect(request.headers.has("traceparent")).toBe(false);
    const sent = network.mock.calls.at(-1)![0] as Request;
    expect(sent).not.toBe(request);
    expect(sent.headers.get("x-app")).toBe("1");
    expect(sent.headers.get("traceparent")).toMatch(
      /^00-[0-9a-f]{32}-[0-9a-f]{16}-0[01]$/,
    );
  });

  it("lets the app register its own propagator and context manager after init(), and keeps working", async () => {
    init({ ...CS, ...options() });
    const appPropagator = new W3CTraceContextPropagator();
    const appContextManager = new StackContextManager().enable();
    try {
      expect(propagation.setGlobalPropagator(appPropagator)).toBe(true);
      expect(context.setGlobalContextManager(appContextManager)).toBe(true);
      await fetch(`${location.origin}/after-app-setup`);
      const [, init_] = network.mock.calls.at(-1)! as [string, RequestInit];
      expect(new Headers(init_.headers).get("traceparent")).toMatch(/^00-/);
    } finally {
      propagation.disable();
      context.disable();
    }
  });

  it("leaves a propagator and context manager the app registered before init() in place", async () => {
    const appContextManager = new StackContextManager().enable();
    expect(context.setGlobalContextManager(appContextManager)).toBe(true);
    try {
      init({ ...CS, ...options() });
      await shutdown();
      // The app's registration is still the one in use: registering another one is refused.
      expect(context.setGlobalContextManager(new StackContextManager())).toBe(
        false,
      );
    } finally {
      context.disable();
    }
  });

  it("propagates an interaction's context without registering globals", async () => {
    init({ ...CS, ...options() });
    const interaction = startInteraction("checkout");
    await interaction.run(() => fetch(`${location.origin}/in-interaction`));
    const [, init_] = network.mock.calls.at(-1)! as [string, RequestInit];
    expect(new Headers(init_.headers).get("traceparent")).toContain(
      interaction.traceId!,
    );
    interaction.end();
    await shutdown();
    expect(context.setGlobalContextManager(new StackContextManager())).toBe(
      true,
    );
    context.disable();
  });
});

describe("remote config with an attribute the app left undefined (JS-11)", () => {
  it("still describes the client, and never sends to /api/report", async () => {
    network.mockImplementation(
      async () => new Response(new Uint8Array(), { status: 200 }),
    );
    init({
      ...CS,
      ...options(),
      remoteConfig: true,
      attributes: { "user.id": undefined as any, plan: 42 as any },
    });
    await refreshConfig();
    expect(
      network.mock.calls.some(([url]) => String(url).endsWith("/opamp")),
    ).toBe(true);
    expect(network.mock.calls.some(([url]) => String(url).includes("/api/report"))).toBe(false);
    const description = (getClient() as any).describe().nonIdentifying;
    expect(description.plan).toBe(42);
    expect("user.id" in description).toBe(false);
  });
});

describe("bounded buffers and timers (JS-18, JS-20, JS-21, JS-22)", () => {
  it("keeps the replay upload queue bounded while uploads fail (JS-18)", async () => {
    vi.useFakeTimers();
    const transport = new RecordingsTransport(
      "https://t/api/recordings",
      "tok",
      () => Promise.reject(new TypeError("offline")),
    );
    for (let i = 0; i < 300; i++) {
      transport.send([{ sessionId: "s", segmentIndex: i, events: [{}] }]);
      await vi.advanceTimersByTimeAsync(30_000);
    }
    expect(transport.pending()).toBeLessThanOrEqual(50);
    expect(transport.failedSegments).toBeGreaterThan(200);
  });

  it("does not put a large buffer into the page's session storage (JS-20)", async () => {
    globalThis.indexedDB = new IDBFactory();
    resetDatabase();
    try {
      const control = new ControlState(defaultSettings(), ceilingsFrom({}));
      const buffer = new RingBuffer<BufferedItem>({
        maxBytes: 64 * 1024 * 1024,
        maxAgeMs: 600_000,
      });
      const persistence = new TelemetryPersistence(
        "tok",
        control,
        buffer,
        async () => "sent",
      );
      persistence.start("session");
      await persistence.flush();
      // The app's own data: with the buffer's copy on top, its next write would not fit in the 5 MB.
      sessionStorage.setItem("host:state", "s".repeat(3_600_000));
      const batch = (body: string): BufferedItem => ({
        kind: "stored",
        batch: {
          token: "tok",
          kind: "logs",
          body,
          createdAtMs: 0,
          attempts: 0,
        },
      });
      buffer.push({
        timeMs: Date.now(),
        signal: "custom",
        bytes: 2,
        item: batch("{}"),
      });
      persistence.save("session");
      await persistence.flush();
      expect(sessionStorage.getItem("traceway:buffer:tok")).not.toBeNull();
      buffer.push({
        timeMs: Date.now(),
        signal: "custom",
        bytes: 2_000_000,
        item: batch("x".repeat(1_000_000)),
      });
      persistence.save("session");
      await persistence.flush();
      expect(sessionStorage.getItem("traceway:buffer:tok")).toBeNull();
      expect(() =>
        sessionStorage.setItem("host:draft", "d".repeat(500_000)),
      ).not.toThrow();
      persistence.stop();
    } finally {
      delete (globalThis as any).indexedDB;
    }
  });

  it("goes on with a lookback flush past a corrupt stored batch (JS-21)", async () => {
    init({ ...CS, ...options() });
    const client = getClient() as any;
    client.buffer.restore([
      {
        timeMs: Date.now() - 5000,
        signal: "custom",
        bytes: 2,
        item: {
          kind: "stored",
          batch: {
            kind: "logs",
            body: "{",
            token: "tok_123",
            createdAtMs: 0,
            attempts: 0,
          },
        },
      },
    ]);
    track("before");
    captureException(new Error("x"));
    const records = await exported();
    expect(records.some((r) => r.eventName === "before")).toBe(true);
  });

  it("never asks the browser for a delay it would wrap to zero (JS-22)", () => {
    const delays = vi.spyOn(globalThis, "setTimeout");
    init({ ...CS, ...options() });
    getClient()!.control.applyRemote({
      captures: [
        { id: "c", until: new Date(Date.now() + 30 * 864e5).toISOString() },
      ],
    });
    const asked = delays.mock.calls.map(([, delay]) => Number(delay ?? 0));
    expect(Math.max(...asked)).toBeLessThanOrEqual(2 ** 31 - 1);
  });
});

describe("internal pieces that fail (§13.6 fault injection)", () => {
  it("an exporter that throws loses its batch, not the page's call or later records", async () => {
    init({ ...CS, ...options() });
    let failures = 1;
    const export_ = logs.export.bind(logs);
    logs.export = (batch, done) => {
      if (failures-- > 0) throw new Error("exporter bug");
      export_(batch, done);
    };
    expect(() => captureException(new Error("first"))).not.toThrow();
    await expect(flush()).resolves.toBeUndefined();
    captureException(new Error("second"));
    expect(exceptions(await exported())).toContain("second");
  });

  it("a transport that rejects every upload never reaches the page", async () => {
    network.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    init({ ...CS, ...options(), remoteConfig: true, captureMetrics: true });
    captureException(new Error("offline"));
    await expect(flush()).resolves.toBeUndefined();
    await expect(refreshConfig()).resolves.toBeUndefined();
    expect(pageErrors).toEqual([]);
  });

  it("a trigger engine that throws loses the record, and the SDK works once it recovers", async () => {
    init({ ...CS, ...options() });
    const broken = vi
      .spyOn(TriggerEngine.prototype, "observe")
      .mockImplementation(() => {
        throw new Error("engine bug");
      });
    expect(() =>
      captureException(new Error("during the failure")),
    ).not.toThrow();
    broken.mockRestore();
    captureException(new Error("after"));
    expect(exceptions(await exported())).toContain("after");
  });

  it("a beforeCapture that throws does not drop the exception", async () => {
    init({
      ...CS,
      ...options({
        beforeCapture: () => {
          throw new Error("callback bug");
        },
      }),
    });
    captureException(new Error("kept"));
    expect(exceptions(await exported())).toEqual(["kept"]);
  });

  it("remote settings it cannot parse leave the local ones in place", async () => {
    init({ ...CS, ...options() });
    const result = (getClient() as any).applyRemoteConfig({
      configMap: { traceway: { body: new TextEncoder().encode("{not json") } },
      configHash: new Uint8Array([1]),
    });
    expect(result.applied).toBe(false);
    captureException(new Error("with local settings"));
    expect(exceptions(await exported())).toEqual(["with local settings"]);
  });
});

describe("the page's own crashes still reach the page (§13.3)", () => {
  it("passes uncaught errors on to the page's handlers, unchanged, and records each once", async () => {
    init({ ...CS, ...options() });
    const handler = vi.fn();
    const previous = window.onerror;
    window.onerror = handler;
    try {
      const error = new Error("page crash");
      const event = new ErrorEvent("error", {
        error,
        message: "page crash",
        cancelable: true,
      });
      window.dispatchEvent(event);
      expect(handler).toHaveBeenCalledTimes(1);
      expect(pageErrors).toEqual([error]);
      expect(event.defaultPrevented).toBe(false);
      expect(exceptions(await exported())).toEqual(["page crash"]);
    } finally {
      window.onerror = previous;
    }
  });

  it("passes unhandled rejections on to the page's listeners", () => {
    init({ ...CS, ...options() });
    const listener = vi.fn();
    addEventListener("unhandledrejection", listener);
    const event = Object.assign(
      new Event("unhandledrejection", { cancelable: true }),
      {
        reason: new Error("rejected"),
      },
    );
    window.dispatchEvent(event);
    removeEventListener("unhandledrejection", listener);
    expect(listener).toHaveBeenCalledWith(event);
    expect(event.defaultPrevented).toBe(false);
  });
});

describe("the hooks of §14: screen context, pictures in the replay, the app's spans", () => {
  afterEach(() => {
    forgetRouters();
    history.replaceState({}, "", "/");
  });

  it("a screen context that cannot be built leaves the record, the page's pushState and its console call as they were", async () => {
    // Taken before init(): the console instrumentation wraps it, so it is the native method the page's call reaches.
    const native = vi.spyOn(console, "info").mockImplementation(() => {});
    init({ ...CS, ...options() });
    getClient()!.control.applyRemote({
      signals: { console: { mode: "stream" }, navigation: { mode: "stream" } },
    });
    vi.spyOn(ScreenState.prototype, "context").mockImplementation(() => {
      throw new Error("sdk");
    });
    vi.spyOn(ScreenState.prototype, "navigated").mockImplementation(() => {
      throw new Error("sdk");
    });
    expect(() => history.pushState({}, "", "/after-push")).not.toThrow();
    expect(location.pathname).toBe("/after-push");
    expect(() => console.info("still logged")).not.toThrow();
    expect(() => recordNavigation("/manual")).not.toThrow();
    expect(() => setRoute("/orders/:id")).not.toThrow();
    captureException(new Error("still recorded"));
    const records = await exported();
    expect(exceptions(records)).toEqual(["still recorded"]);
    expect(records.some((r) => String(r.body).includes("still logged"))).toBe(true);
    expect(records.some((r) => r.eventName === "browser.navigation")).toBe(true);
    expect(pageErrors).toEqual([]);
    expect(native).toHaveBeenCalledWith("still logged");
  });

  it("a router whose getters throw does not stop the screen from being named by its path", async () => {
    trackRouter({
      get currentRoute(): unknown {
        throw new Error("router");
      },
    });
    init({ ...CS, ...options() });
    history.pushState({}, "", "/orders/42");
    captureException(new Error("on orders"));
    const exception = (await exported()).find((r) => r.eventName === "exception");
    expect(exception?.attributes["app.screen.name"]).toBe("/orders/42");
    expect(pageErrors).toEqual([]);
  });

  it("an image encoder that fails loses the picture, not the recording, and the page's image is untouched", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
      throw new Error("out of memory");
    });
    document.body.innerHTML = `<img src="https://app.test/photo.jpg">`;
    const img = document.querySelector("img")!;
    for (const [key, value] of Object.entries({ complete: true, naturalWidth: 640, naturalHeight: 480, width: 320, height: 240 }))
      Object.defineProperty(img, key, { configurable: true, value });
    const recorder = new SessionRecorder();
    try {
      await recorder.start({ images: "always" });
      expect(recorder.getClipEvents().some((event) => event.type === 2)).toBe(true);
      expect(JSON.stringify(recorder.getClipEvents())).not.toContain("rr_dataURL");
      // A bug in the encoder must still allow safe text through and remove original inline pixels.
      vi.spyOn(ImageInliner.prototype, "inline").mockImplementation(() => {
        throw new Error("sdk");
      });
      const added = document.createElement("p");
      added.textContent = "added later";
      const inline = document.createElement("img");
      inline.src = "data:image/png;base64,b3JpZ2luYWxwaXhlbHM=";
      added.append(inline);
      document.body.append(added);
      await vi.waitFor(() =>
        expect(JSON.stringify(recorder.getClipEvents())).toContain("added later"),
      );
      expect(JSON.stringify(recorder.getClipEvents())).not.toContain("b3JpZ2luYWxwaXhlbHM=");
      expect(img.hasAttribute("crossorigin")).toBe(false);
      expect(img.getAttribute("src")).toBe("https://app.test/photo.jpg");
      expect(pageErrors).toEqual([]);
    } finally {
      recorder.stop();
      document.body.replaceChildren();
    }
  });

  it("masking that fails drops the event, never keeps it unmasked, and the page's DOM change goes through", async () => {
    document.body.innerHTML = `<div class="traceway-mask" id="box"></div>`;
    const recorder = new SessionRecorder();
    try {
      await recorder.start({ maskAllInputs: false });
      const node = (recorder as any).node;
      (recorder as any).node = () => {
        throw new Error("sdk");
      };
      const box = document.querySelector("#box")!;
      box.attachShadow({ mode: "open" }).innerHTML = "<b>Shadow secret</b>";
      expect(box.shadowRoot!.textContent).toBe("Shadow secret");
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(JSON.stringify(recorder.getClipEvents())).not.toContain("Shadow secret");
      (recorder as any).node = node;
      const later = document.createElement("p");
      later.textContent = "recorded again";
      document.body.append(later);
      await vi.waitFor(() =>
        expect(JSON.stringify(recorder.getClipEvents())).toContain("recorded again"),
      );
      expect(pageErrors).toEqual([]);
    } finally {
      recorder.stop();
      document.body.replaceChildren();
    }
  });

  it("the app's spans: an SDK failure on them stays inside, the app's own error and result come back unchanged", async () => {
    init({ ...CS, ...options() });
    (getClient() as any).router.stampSpan = () => {
      throw new Error("sdk");
    };
    const appError = new Error("app");
    expect(tracer()!.startActiveSpan("ok", (span) => (span.end(), 42))).toBe(42);
    expect(() =>
      tracer()!.startActiveSpan("fails", () => {
        throw appError;
      }),
    ).toThrow(appError);
    expect(() => tracer()!.startSpan(42 as any, "x" as any).end()).not.toThrow();
    await flush();
    expect(pageErrors).toEqual([]);
  });
});

describe("the replay's privacy limits with values they cannot use (§13.1, §14.5)", () => {
  it("replayImages that is not a policy starts the SDK and records no pictures", async () => {
    // The one warning it logs is in debug-log.test.ts, which sees the console the SDK took when it loaded.
    for (const replayImages of ["sometimes", "ALWAYS", 42, true, false, {}, [], hostile()]) {
      expect(() =>
        init({ ...CS, ...options({ sessionRecording: true, replayImages }) }),
      ).not.toThrow();
      expect(getClient()).not.toBeNull();
      expect(getClient()!.control.settings().replay.images).toBe("off");
      getClient()!.control.applyRemote({ replay: { images: "always" } });
      expect(getClient()!.control.settings().replay.images).toBe("off");
      captureException(new Error("still reported"));
      expect(exceptions(await exported())).toEqual(["still reported"]);
      await shutdown();
    }
    // Left out or null: the default, which lets the settings decide.
    for (const replayImages of [undefined, null]) {
      init({ ...CS, ...options({ sessionRecording: true, replayImages: replayImages as any }) });
      getClient()!.control.applyRemote({ replay: { images: "always" } });
      expect(getClient()!.control.settings().replay.images).toBe("always");
      await shutdown();
    }
  });

  it("collection.replay or a rule it cannot read changes nothing, and never unmasks inputs", async () => {
    for (const replay of [null, "masked", 7, [], { maskAllInputs: "true" }, { maskAllInputs: 1 }]) {
      expect(() =>
        init({ ...CS, ...options({ collection: { replay: replay as any } }) }),
      ).not.toThrow();
      // Not a boolean true, so no floor: inputs stay masked by default.
      expect(getClient()!.control.settings().replay.maskAllInputs).toBe(true);
      await shutdown();
    }
    init({
      ...CS,
      ...options({
        sessionRecording: true,
        replayImages: "wifi",
        collection: { replay: { maskAllInputs: true } },
      }),
    });
    const client = getClient() as any;
    for (const body of [
      '{"replay":{"maskAllInputs":"false","images":"ALWAYS"}}',
      '{"replay":null}',
      '{"replay":"off"}',
      '{"replay":{"maskAllInputs":false,"images":"always"}}',
      "{not json",
    ]) {
      expect(() =>
        client.applyRemoteConfig({
          configMap: { traceway: { body: new TextEncoder().encode(body) } },
          configHash: new Uint8Array([3]),
        }),
      ).not.toThrow();
      expect(client.control.settings().replay.maskAllInputs).toBe(true);
      expect(client.control.settings().replay.images).toBe("wifi");
    }
    captureException(new Error("after the rules"));
    expect(exceptions(await exported())).toEqual(["after the rules"]);
  });

  it("a collection.replay whose reads throw does not reach the app, and a later init() keeps the floor", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() =>
      init({ ...CS, ...options({ collection: { replay: hostile() } }) }),
    ).not.toThrow();
    await shutdown();
    init({ ...CS, ...options({ collection: { replay: { maskAllInputs: true } } }) });
    getClient()!.control.applyRemote({ replay: { maskAllInputs: false } });
    expect(getClient()!.control.settings().replay.maskAllInputs).toBe(true);
  });
});
