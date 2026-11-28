/** CONTRACT §14.4 and §14.7: the screen keys of the mobile SDKs, `recordNavigation` and `tracer()`. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { trace } from "@opentelemetry/api";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter, TracerProvider } from "@opentelemetry/sdk-trace";
import type { TracewayFrontendOptions } from "./client.js";
import {
  captureException,
  captureMessage,
  currentSessionId,
  flush,
  init,
  log,
  recordAction,
  recordNavigation,
  setRoute,
  shutdown,
  startInteraction,
  tracer,
  trackRouter,
} from "./index.js";
import { forgetRouters } from "./otel/route-detect.js";
import { routeTemplate, ScreenState } from "./screen-state.js";

const CS = { token: "tok_123", baseUrl: "https://traceway.test" };
const SCREEN_KEYS = [
  "app.screen.name",
  "app.screen.route",
  "app.screen.previous",
  "app.screen.duration_ms",
  "viewport",
];
let logs: InMemoryLogRecordExporter;
let spans: InMemorySpanExporter;

function start(extra: TracewayFrontendOptions = {}): void {
  logs = new InMemoryLogRecordExporter();
  spans = new InMemorySpanExporter();
  init({
    ...CS,
    logExporter: logs,
    spanExporter: spans,
    captureWebVitals: false,
    captureResourceTiming: false,
    sessionRecording: false,
    remoteConfig: false,
    collection: {
      signals: {
        console: { mode: "stream" },
        navigation: { mode: "stream" },
        userActions: { mode: "stream" },
        custom: { mode: "stream" },
        network: { mode: "stream" },
      },
    },
    ...extra,
  });
}

async function exported(): Promise<ReadableLogRecord[]> {
  await flush();
  return logs.getFinishedLogRecords();
}

function screenOf(record: ReadableLogRecord | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of SCREEN_KEYS)
    if (record?.attributes[key] !== undefined) out[key] = record.attributes[key];
  return out;
}

function navigations(records: ReadableLogRecord[]): ReadableLogRecord[] {
  return records.filter((r) => r.eventName === "browser.navigation");
}

beforeEach(() => {
  history.replaceState({}, "", "/");
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null)));
});

afterEach(async () => {
  await shutdown();
  forgetRouters();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  history.replaceState({}, "", "/");
  document.body.replaceChildren();
  sessionStorage.clear();
  localStorage.clear();
});

describe("ScreenState", () => {
  it("names a screen by its route template, else its path, and remembers the one before", () => {
    const screen = new ScreenState();
    expect(screen.context(5)).toEqual({});
    screen.navigated("/orders/42", 1_000);
    expect(screen.context(1_250)).toEqual({
      "app.screen.name": "/orders/42",
      "app.screen.duration_ms": 250,
    });
    screen.route = routeTemplate("orders/:id ");
    screen.navigated("/orders/42", 2_000);
    expect(screen.context(2_000)).toEqual({
      "app.screen.name": "/orders/:id",
      "app.screen.route": "/orders/:id",
      "app.screen.duration_ms": 1_000,
    });
    screen.navigated("/cart", 3_000, "/cart");
    expect(screen.context(2_500)).toEqual({
      "app.screen.name": "/cart",
      "app.screen.route": "/cart",
      "app.screen.previous": "/orders/:id",
      "app.screen.duration_ms": 0,
    });
    screen.navigated("", 4_000, "/ignored");
    expect(screen.path).toBe("/cart");
  });

  it("writes route templates as the mobile SDKs do", () => {
    expect(routeTemplate("  /a/:id  ")).toBe("/a/:id");
    expect(routeTemplate("a")).toBe("/a");
    expect(routeTemplate("/" + "x".repeat(100))).toHaveLength(64);
    for (const raw of ["", "   ", null, undefined, 42, {}]) expect(routeTemplate(raw)).toBeNull();
  });
});

describe("screen context on records (§14.4)", () => {
  it("stamps the mobile screen keys on exceptions, messages, log lines and actions", async () => {
    vi.stubGlobal("CSS", { escape: (value: string) => value });
    history.replaceState({}, "", "/orders/42");
    start();
    history.pushState({}, "", "/checkout");
    setRoute("/checkout/:step");
    captureException(new Error("boom"));
    captureMessage("hello");
    log("a line", "warn");
    console.info("a console line");
    recordAction("ui", "pay");
    document.body.innerHTML = `<button id="pay">Pay</button>`;
    document.querySelector("button")!.dispatchEvent(
      new MouseEvent("click", { bubbles: true, button: 0 }),
    );
    const records = await exported();
    const expected = {
      "app.screen.name": "/checkout/:step",
      "app.screen.route": "/checkout/:step",
      "app.screen.previous": "/orders/42",
      viewport: `${innerWidth}x${innerHeight}`,
    };
    const stamped = [
      records.find((r) => r.eventName === "exception"),
      records.find((r) => r.eventName === "traceway.message"),
      records.find((r) => r.body === "a line"),
      records.find((r) => String(r.body).includes("a console line")),
      records.find((r) => r.eventName === "traceway.action"),
      records.find((r) => r.eventName === "browser.user_action.click"),
    ];
    for (const record of stamped) {
      expect(screenOf(record)).toMatchObject(expected);
      expect(record!.attributes["app.screen.duration_ms"]).toBeGreaterThanOrEqual(0);
    }
  });

  it("names the screen by its path without a route, and counts the time since the screen was reached", async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
    start();
    history.pushState({}, "", "/orders/42?tab=items");
    vi.setSystemTime(1_000_750);
    // A query change is the same screen.
    history.replaceState({}, "", "/orders/42?tab=history");
    captureException(new Error("on the orders page"));
    const exception = (await exported()).find((r) => r.eventName === "exception");
    expect(screenOf(exception)).toEqual({
      "app.screen.name": "/orders/42",
      "app.screen.previous": "/",
      "app.screen.duration_ms": 750,
      viewport: `${innerWidth}x${innerHeight}`,
    });
  });

  it("keeps the app's own attributes over the screen keys", async () => {
    start();
    captureException(new Error("x"), { "app.screen.name": "Mine", viewport: "1x1" });
    const exception = (await exported()).find((r) => r.eventName === "exception");
    expect(exception?.attributes["app.screen.name"]).toBe("Mine");
    expect(exception?.attributes.viewport).toBe("1x1");
  });

  it("takes a route set before the screen was looked at again for the new address", async () => {
    // Without the navigation instrumentation nothing looks at the address when it changes.
    start({ captureNavigation: false });
    history.pushState({}, "", "/orders/7");
    setRoute("/orders/:id");
    log("after the route");
    const line = (await exported()).find((r) => r.body === "after the route");
    expect(screenOf(line)).toMatchObject({
      "app.screen.name": "/orders/:id",
      "app.screen.route": "/orders/:id",
    });
  });

  it("names history navigations by the template the app's router shows", async () => {
    const router = {
      currentRoute: { value: { path: "/", matched: [{ path: "/" }] } },
      options: { history: { base: "" } },
    };
    trackRouter(router);
    start();
    router.currentRoute.value = { path: "/orders/42", matched: [{ path: "/orders/:id" }] };
    history.pushState({}, "", "/orders/42");
    router.currentRoute.value = { path: "/cart", matched: [{ path: "/cart" }] };
    history.pushState({}, "", "/cart");
    window.dispatchEvent(new PopStateEvent("popstate"));
    const soft = navigations(await exported()).filter(
      (r) => r.attributes["browser.navigation.same_document"] === true,
    );
    expect(soft.map((r) => [r.attributes["app.screen.name"], r.attributes["app.screen.route"]])).toEqual([
      ["/orders/:id", "/orders/:id"],
      ["/cart", "/cart"],
    ]);
  });

  it("names a history navigation by the route the app sets right after it, as React and SvelteKit routers do", async () => {
    start();
    history.pushState({}, "", "/orders/7");
    setRoute("/orders/:id");
    history.pushState({}, "", "/orders/7?tab=items");
    history.pushState({}, "", "/cart");
    // Names the arrival at /cart; the navigations to /orders/7 keep their route.
    setRoute("/late/:id");
    const soft = navigations(await exported()).filter(
      (r) => r.attributes["browser.navigation.same_document"] === true,
    );
    expect(soft.map((r) => [r.attributes["app.screen.name"], r.attributes["app.screen.route"]])).toEqual([
      ["/orders/:id", "/orders/:id"],
      ["/orders/:id", "/orders/:id"],
      ["/late/:id", "/late/:id"],
    ]);
  });

  it("does not read the app's router with detectRoutes: false", async () => {
    trackRouter({
      currentRoute: { value: { path: "/orders/42", matched: [{ path: "/orders/:id" }] } },
    });
    start({ detectRoutes: false });
    history.pushState({}, "", "/orders/42");
    captureMessage("m");
    const message = (await exported()).find((r) => r.eventName === "traceway.message");
    expect(message?.attributes["app.screen.name"]).toBe("/orders/42");
    expect(message?.attributes["app.screen.route"]).toBeUndefined();
  });
});

describe("recordNavigation (§14.4)", () => {
  it("records the mobile navigation record and names the screen until the address changes", async () => {
    start();
    recordNavigation("/orders/42", "push", "/orders", "orders/:id");
    recordNavigation("/orders/42/edit");
    captureException(new Error("while editing"));
    history.pushState({}, "", "/somewhere-else");
    captureException(new Error("after the address changed"));
    const records = await exported();
    const manual = navigations(records).filter((r) => r.attributes["navigation.to"] !== undefined);
    expect(manual.map((r) => r.attributes)).toEqual([
      expect.objectContaining({
        "url.full": "/orders/42",
        "navigation.action": "push",
        "browser.navigation.type": "push",
        "navigation.to": "/orders/42",
        "navigation.from": "/orders",
        "app.screen.name": "/orders/:id",
        "app.screen.route": "/orders/:id",
      }),
      expect.objectContaining({
        "url.full": "/orders/42/edit",
        "navigation.action": "push",
        "navigation.to": "/orders/42/edit",
        "app.screen.name": "/orders/42/edit",
      }),
    ]);
    expect(manual[1]!.attributes["navigation.from"]).toBeUndefined();
    expect(manual[1]!.attributes["app.screen.route"]).toBeUndefined();
    expect(manual[0]!.attributes["session.id"]).toBe(currentSessionId());
    const [editing, after] = records.filter((r) => r.eventName === "exception");
    expect(screenOf(editing)).toMatchObject({
      "app.screen.name": "/orders/42/edit",
      "app.screen.previous": "/orders/:id",
    });
    expect(screenOf(after)).toMatchObject({
      "app.screen.name": "/somewhere-else",
      "app.screen.previous": "/orders/42/edit",
    });
  });

  it("records a removal as the mobile SDKs do: no arrival, the screen stays (JS2-5)", async () => {
    start();
    recordNavigation("/orders/42", "push", "/orders", "/orders/:id");
    recordNavigation("/orders/42/sheet", "remove", "/orders/42/sheet");
    captureException(new Error("after the sheet closed"));
    const records = await exported();
    const removal = navigations(records).find((r) => r.attributes["navigation.action"] === "remove");
    expect(removal!.attributes).toMatchObject({
      "url.full": "",
      "browser.navigation.type": "remove",
      "navigation.from": "/orders/42/sheet",
      "app.screen.name": "/orders/:id",
    });
    expect(removal!.attributes["navigation.to"]).toBeUndefined();
    const error = records.find((r) => r.eventName === "exception");
    expect(screenOf(error)).toMatchObject({ "app.screen.name": "/orders/:id", "app.screen.route": "/orders/:id" });
    expect(screenOf(error)["app.screen.previous"]).not.toBe("/orders/:id");
  });

  it("does nothing before init() and after shutdown(), and ignores a path that is not a string", async () => {
    expect(() => recordNavigation("/x")).not.toThrow();
    start();
    expect(() => {
      recordNavigation(undefined as any);
      recordNavigation({} as any, 42 as any, null as any, {} as any);
      recordNavigation("/odd", 42 as any, 7 as any, {} as any);
    }).not.toThrow();
    const manual = navigations(await exported()).filter((r) => r.attributes["navigation.to"] !== undefined);
    expect(manual.map((r) => r.attributes)).toEqual([
      expect.objectContaining({
        "navigation.to": "/odd",
        "navigation.action": "42",
        "navigation.from": "7",
        "app.screen.name": "/odd",
      }),
    ]);
    await shutdown();
    expect(() => recordNavigation("/y")).not.toThrow();
  });
});

describe("tracer() (§14.7)", () => {
  it("is undefined before init() and after shutdown()", async () => {
    expect(tracer()).toBeUndefined();
    start();
    expect(tracer()).toBeDefined();
    await shutdown();
    expect(tracer()).toBeUndefined();
  });

  it("exports the app's spans with the session id, nested under the active interaction", async () => {
    start();
    const interaction = startInteraction("checkout");
    interaction.run(() =>
      tracer()!.startActiveSpan("load cart", (span) => {
        tracer()!.startSpan("read prices").end();
        span.end();
      }),
    );
    tracer()!.startSpan("outside").end();
    interaction.end();
    await flush();
    const byName = Object.fromEntries(spans.getFinishedSpans().map((s) => [s.name, s]));
    const checkout = byName.checkout!.spanContext();
    expect(byName["load cart"]!.parentSpanContext?.spanId).toBe(checkout.spanId);
    expect(byName["load cart"]!.spanContext().traceId).toBe(checkout.traceId);
    expect(byName["read prices"]!.parentSpanContext?.spanId).toBe(
      byName["load cart"]!.spanContext().spanId,
    );
    expect(byName.outside!.parentSpanContext).toBeUndefined();
    for (const name of ["load cart", "read prices", "outside"])
      expect(byName[name]!.attributes["session.id"]).toBe(currentSessionId());
  });

  it("is not registered as the global tracer provider: the app's own one still installs", async () => {
    start();
    const before = trace.getTracerProvider();
    tracer()!.startSpan("mine").end();
    expect(trace.getTracerProvider()).toBe(before);
    expect(trace.getTracer("app")).not.toBe(tracer());
    try {
      expect(trace.setGlobalTracerProvider(new TracerProvider())).toBe(true);
    } finally {
      trace.disable();
    }
  });
});
