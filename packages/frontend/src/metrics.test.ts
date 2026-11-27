import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";
import { SeverityNumber } from "@opentelemetry/api-logs";

vi.mock("@rrweb/record", () => {
  const record = Object.assign(
    vi.fn(() => () => {}),
    { takeFullSnapshot: vi.fn() },
  );
  return { record };
});

import { createBrowserRouter } from "react-router";
import type { TracewayFrontendOptions } from "./client.js";
import { TracewayFrontendClient } from "./client.js";
import { forgetRouters, trackRouter } from "./otel/route-detect.js";

const METRICS_URL = "https://traceway.test/api/otel/v1/metrics";

let client: TracewayFrontendClient;
let logExporter: InMemoryLogRecordExporter;
let fetchMock: ReturnType<typeof vi.fn>;
let status = 200;
const observers = new Map<string, (entries: object[]) => void>();

class FakePerformanceObserver {
  static get supportedEntryTypes(): string[] {
    return ["long-animation-frame", "longtask", "event", "layout-shift"];
  }
  private type = "";
  constructor(
    private readonly callback: (list: { getEntries(): object[] }) => void,
  ) {}
  observe(options: { type: string }): void {
    this.type = options.type;
    observers.set(options.type, (entries) =>
      this.callback({ getEntries: () => entries }),
    );
  }
  takeRecords(): object[] {
    return [];
  }
  disconnect(): void {
    observers.delete(this.type);
  }
}

function start(options: TracewayFrontendOptions = {}): TracewayFrontendClient {
  logExporter = new InMemoryLogRecordExporter();
  client = new TracewayFrontendClient({
      token: "tok_123",
      baseUrl: "https://traceway.test",
      logExporter,
      spanExporter: new InMemorySpanExporter(),
      captureWebVitals: false,
      captureResourceTiming: false,
      captureLogs: false,
      captureNavigation: false,
      captureUserActions: false,
      captureNetwork: false,
      sessionRecording: false,
      remoteConfig: false,
      version: "4.2.0",
      ...options,
  });
  client.start();
  return client;
}

function longFrame(duration: number, scripts?: object[]): void {
  observers.get("long-animation-frame")!([
    {
      entryType: "long-animation-frame",
      startTime: performance.now(),
      duration,
      blockingDuration: duration - 50,
      scripts,
    },
  ]);
}

function interaction(id: number, duration: number, target?: Element): void {
  observers.get("event")!([
    {
      entryType: "event",
      startTime: performance.now(),
      duration,
      interactionId: id,
      target,
    },
  ]);
}

function layoutShift(value: number, startTime: number, node?: Element): void {
  observers.get("layout-shift")!([
    {
      entryType: "layout-shift",
      startTime,
      value,
      hadRecentInput: false,
      sources: node ? [{ node }] : [],
    },
  ]);
}

function hide(): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "hidden",
  });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

function pendingStored(): any[] {
  return JSON.parse(
    localStorage.getItem("traceway:metrics:pending:tok_123") ?? "[]",
  );
}

function emit(eventName: string, attributes: Record<string, string | number>) {
  (client as any).loggerProvider
    .getLogger("test")
    .emit({ eventName, severityNumber: SeverityNumber.INFO, attributes });
}

interface Payload {
  resource: Record<string, unknown>;
  metrics: Record<string, any>;
}

function payloads(): Payload[] {
  return fetchMock.mock.calls
    .filter(([url]) => url === METRICS_URL)
    .map(([, init]) => {
      const body = JSON.parse(init.body);
      const rm = body.resourceMetrics[0];
      const resource: Record<string, unknown> = {};
      for (const { key, value } of rm.resource.attributes)
        resource[key] = Object.values(value)[0];
      const metrics: Record<string, any> = {};
      for (const metric of rm.scopeMetrics[0].metrics)
        metrics[metric.name] = metric;
      return { resource, metrics };
    });
}

function dims(dataPoint: any): Record<string, string> {
  return Object.fromEntries(
    dataPoint.attributes.map((a: any) => [a.key, a.value.stringValue]),
  );
}

beforeEach(() => {
  status = 200;
  observers.clear();
  vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
  fetchMock = vi.fn(async () => new Response("{}", { status }));
  vi.stubGlobal("fetch", fetchMock);
  history.replaceState(null, "", "/");
});

afterEach(async () => {
  await client?.shutdown();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

describe("device metrics", () => {
  it("aggregates long tasks while their event signal is off", async () => {
    start();
    for (let i = 0; i < 40; i++) longFrame(200);
    await client.flush();

    expect(
      logExporter
        .getFinishedLogRecords()
        .filter((r) => r.eventName === "browser.long_task"),
    ).toHaveLength(0);
    const [payload] = payloads();
    expect(payload!.resource).toMatchObject({
      "traceway.metrics": "aggregated",
      "traceway.sample_rate": 1,
      "service.version": "4.2.0",
    });
    expect(payload!.resource["session.id"]).toBeUndefined();
    expect(payload!.resource["service.instance.id"]).toBeUndefined();
    const hist = payload!.metrics["browser.long_task.duration"];
    const point = hist.exponentialHistogram.dataPoints[0];
    // All 40, although the event path stops at 30 a minute.
    expect(point.count).toBe(40);
    expect(dims(point)).toMatchObject({
      "url.path": "/",
      type: "long-animation-frame",
    });
  });

  it("counts a page view under its route template and reports its blocking time when it ends", async () => {
    start();
    client.setRoute("/orders/:id");
    longFrame(250);
    longFrame(150);
    history.pushState(null, "", "/products/blue-shoes");
    await client.flush();

    const { metrics } = payloads()[0]!;
    const view = metrics["browser.page_view"].sum.dataPoints[0];
    expect(view.asDouble).toBe(1);
    expect(dims(view)["url.path"]).toBe("/orders/:id");
    const blocking =
      metrics["browser.long_task.blocking_time"].exponentialHistogram
        .dataPoints[0];
    expect(blocking.count).toBe(1);
    expect(blocking.sum).toBe(300);
  });

  it("normalizes the path when the app names no route", async () => {
    history.replaceState(null, "", "/orders/8841");
    start();
    longFrame(100);
    await client.flush();
    const point =
      payloads()[0]!.metrics["browser.long_task.duration"].exponentialHistogram
        .dataPoints[0];
    expect(dims(point)["url.path"]).toBe("/orders/:id");
  });

  it("counts a web vital once, with its latest value, and keeps a session for a poor one", async () => {
    start();
    const vital = (value: number, rating: string) =>
      emit("browser.web_vital", {
        "browser.web_vital.name": "CLS",
        "browser.web_vital.id": "v1-1",
        "browser.web_vital.value": value,
        "browser.web_vital.rating": rating,
        "browser.web_vital.navigation_type": "navigate",
      });
    vital(0.05, "good");
    vital(0.4, "poor");
    await client.flush();
    vital(0.5, "poor");
    await client.flush();

    const all = payloads();
    const points =
      all[0]!.metrics["browser.web_vital.cls"].exponentialHistogram.dataPoints;
    expect(points).toHaveLength(1);
    expect(points[0].count).toBe(1);
    expect(points[0].sum).toBe(0.4);
    expect(dims(points[0])).toMatchObject({
      rating: "poor",
      navigation_type: "navigate",
    });
    expect(points[0].exemplars[0].filteredAttributes[0].key).toBe("session.id");
    expect(all[1]?.metrics["browser.web_vital.cls"]).toBeUndefined();
  });

  it("records custom metrics and refuses reserved or malformed names", async () => {
    start();
    client.metric("checkout.duration", 840, { plan: "pro", a: 1, z: 2 });
    client.count("cart.item_added", 3);
    client.metric("browser.web_vital.lcp", 1);
    client.count("Not A Name");
    await client.flush();

    const { metrics } = payloads()[0]!;
    const point =
      metrics["checkout.duration"].exponentialHistogram.dataPoints[0];
    expect(dims(point)).toEqual({ a: "1", plan: "pro" });
    expect(metrics["cart.item_added"].sum.dataPoints[0].asDouble).toBe(3);
    expect(metrics["browser.web_vital.lcp"]).toBeUndefined();
    expect(metrics["Not A Name"]).toBeUndefined();
  });

  it("sends nothing when the page, a rule or the plan turns metrics off", async () => {
    start({ captureMetrics: false });
    longFrame(100);
    await client.flush();
    expect(payloads()).toHaveLength(0);
    await client.shutdown();

    start();
    client.control.applyRemote({ metrics: { enabled: false } });
    longFrame(100);
    await client.flush();
    expect(payloads()).toHaveLength(0);

    client.control.applyRemote({ limits: { metrics: "off" } });
    longFrame(100);
    await client.flush();
    expect(payloads()).toHaveLength(0);
  });

  it("carries the sample rate and records nothing for a session outside the sample", async () => {
    start();
    client.control.applyRemote({ metrics: { sampleRate: 0 } });
    longFrame(100);
    await client.flush();
    expect(payloads()).toHaveLength(0);

    client.control.applyRemote({ metrics: { sampleRate: 1 } });
    longFrame(100);
    await client.flush();
    expect(payloads()[0]!.resource["traceway.sample_rate"]).toBe(1);
  });

  it("uploads what was counted before a lower sample rate arrived at the rate it was counted under", async () => {
    start();
    client.control.applyRemote({ metrics: { sampleRate: 0.5 } });
    await settle();
    const first = payloads();
    expect(first).toHaveLength(1);
    expect(first[0]!.resource["traceway.sample_rate"]).toBe(1);
    expect(first[0]!.metrics["browser.session"]).toBeDefined();
  });

  it("counts a session once, not once per page of it", async () => {
    start();
    await client.flush();
    expect(payloads()[0]!.metrics["browser.session"]).toBeDefined();
    await client.shutdown();
    fetchMock.mockClear();

    start();
    longFrame(100);
    await client.flush();
    const [next] = payloads();
    expect(next!.metrics["browser.long_task.duration"]).toBeDefined();
    expect(next!.metrics["browser.session"]).toBeUndefined();
  });

  it("splits a payload that is over the body limit instead of dropping it", async () => {
    start();
    const recorder = (client as any).metrics;
    for (let i = 0; i < 240; i++)
      recorder.aggregator.count(`cells.n${i}`, 1, {
        "url.path": `/${"x".repeat(200)}/${i}`,
        extra: "y".repeat(200),
      });
    await client.flush();
    const sent = payloads();
    expect(sent.length).toBeGreaterThan(1);
    const names = new Set(sent.flatMap((p) => Object.keys(p.metrics)));
    for (let i = 0; i < 240; i += 37) expect(names.has(`cells.n${i}`)).toBe(true);
    for (const [, init] of fetchMock.mock.calls.filter(
      ([url]) => url === METRICS_URL,
    ))
      expect(new TextEncoder().encode(init.body).byteLength).toBeLessThanOrEqual(
        60 * 1024,
      );
  });

  it("keeps one view while the query string is rewritten in place", async () => {
    start();
    history.replaceState(null, "", "/search?q=a");
    history.replaceState(null, "", "/search?q=ab");
    history.replaceState(null, "", "/search?q=abc");
    // The view that is open now is counted when it ends.
    history.pushState(null, "", "/results");
    await client.flush();
    const views = payloads()[0]!.metrics["browser.page_view"].sum.dataPoints;
    expect(
      views.map((p: any) => [dims(p)["url.path"], Number(p.asDouble ?? p.asInt)]),
    ).toEqual([
      ["/", 1],
      ["/search", 1],
    ]);
  });

  it("counts replacements between paths that normalize to the same route", async () => {
    history.replaceState(null, "", "/orders/1");
    start();
    history.replaceState(null, "", "/orders/2");
    history.pushState(null, "", "/cart");
    await client.flush();
    const views = payloads()[0]!.metrics["browser.page_view"].sum.dataPoints;
    expect(
      views.map((p: any) => [dims(p)["url.path"], Number(p.asDouble ?? p.asInt)]),
    ).toEqual([["/orders/:id", 2]]);
  });

  // JS2-5: a memory router, a modal or a wizard step reported with recordNavigation is a view, as on Android.
  function pageViews(): Array<[string, number]> {
    return payloads()[0]!
      .metrics["browser.page_view"].sum.dataPoints.map((p: any): [string, number] => [
        dims(p)["url.path"]!,
        Number(p.asDouble ?? p.asInt),
      ])
      .sort();
  }

  it("counts a view for every screen recordNavigation reports, named by its route (JS2-5)", async () => {
    start();
    // A different reported screen closes the landing view.
    client.recordNavigation("/orders/42", "push", undefined, "/orders/:id");
    client.recordNavigation("/orders/42", "replace");
    client.recordNavigation("/cart", "push", "/orders/42", "/cart");
    // A removal is not an arrival.
    client.recordNavigation("/cart", "remove");
    client.recordNavigation("/checkout/1", "push", "/cart");
    await client.flush();
    expect(pageViews()).toEqual([
      ["/", 1],
      ["/cart", 1],
      ["/orders/:id", 1],
    ]);
  });

  it("counts a route change the SDK follows and the app also reports once: one view, not two", async () => {
    start();
    history.pushState(null, "", "/orders/42");
    client.recordNavigation("/orders/42", "push", undefined, "/orders/:id");
    history.pushState(null, "", "/cart");
    client.recordNavigation("/cart", "push", "/orders/42", "/cart");
    history.pushState(null, "", "/done");
    await client.flush();
    expect(pageViews()).toEqual([
      ["/", 1],
      ["/cart", 1],
      ["/orders/:id", 1],
    ]);
  });

  it("closes an immediately replaced view and keeps its route template on that view", async () => {
    start();
    history.pushState(null, "", "/orders/41");
    client.setRoute("/first-order");
    client.recordNavigation("/orders/42", "push");
    client.recordNavigation("/done", "push");
    await client.flush();
    expect(pageViews()).toEqual([["/", 1], ["/first-order", 1], ["/orders/:id", 1]]);
  });

  it("starts a new view for a screen reported a while after the address changed, e.g. a modal", async () => {
    start();
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 5_000);
    client.recordNavigation("/orders/modal", "push");
    client.recordNavigation("/", "pop");
    await client.flush();
    expect(pageViews()).toEqual([
      ["/", 1],
      ["/orders/modal", 1],
    ]);
  });

  it("retries a failed upload once, on the next page load, as the same batch", async () => {
    status = 503;
    start();
    longFrame(100);
    await client.flush();
    await client.flush();
    await settle();
    expect(payloads()).toHaveLength(1);
    expect(pendingStored()).toHaveLength(1);
    const first = payloads()[0]!;
    expect(first.resource["traceway.batch_id"]).toMatch(/^[0-9a-f]{32}$/);
    expect(first.resource["traceway.retry"]).toBeUndefined();
    status = 200;
    await client.shutdown();

    start();
    await settle();
    const resent = payloads().find((p) => p.resource["traceway.retry"])!;
    expect(resent.resource["traceway.retry"]).toBe(true);
    expect(resent.resource["traceway.batch_id"]).toBe(
      first.resource["traceway.batch_id"],
    );
    expect(resent.resource["traceway.sent_at"]).toBeGreaterThanOrEqual(
      first.resource["traceway.sent_at"] as number,
    );
    expect(
      resent.metrics["browser.long_task.duration"].exponentialHistogram
        .dataPoints[0].timeUnixNano,
    ).toBe(
      first.metrics["browser.long_task.duration"].exponentialHistogram
        .dataPoints[0].timeUnixNano,
    );
    // The resend failed too: it is not kept for a third attempt.
    expect(pendingStored()).toHaveLength(0);
    await client.shutdown();
    start();
    await settle();
    expect(payloads().filter((p) => p.resource["traceway.retry"])).toHaveLength(
      1,
    );
  });

  it("does not retry an upload the server refused for good", async () => {
    status = 413;
    start();
    longFrame(100);
    await client.flush();
    await settle();
    expect(pendingStored()).toHaveLength(0);
  });

  it("keeps the payload of a page that goes away until its upload is answered", async () => {
    let answer: (response: Response) => void = () => {};
    fetchMock.mockImplementation(
      () => new Promise<Response>((resolve) => (answer = resolve)),
    );
    start();
    longFrame(100);
    hide();
    expect(pendingStored()).toHaveLength(1);
    answer(new Response("{}", { status: 200 }));
    await settle();
    expect(pendingStored()).toHaveLength(0);

    longFrame(100);
    hide();
    const [waiting] = pendingStored();
    // The page died before the answer: the next load sends it again.
    fetchMock.mockImplementation(
      async () => new Response("{}", { status: 200 }),
    );
    await client.shutdown();
    start();
    await settle();
    const resent = payloads().filter((p) => p.resource["traceway.retry"]);
    expect(resent).toHaveLength(1);
    expect(resent[0]!.resource["traceway.batch_id"]).toBe(waiting.id);
  });

  it("counts a browser profile once a day, and once per kind of trouble", async () => {
    start();
    emit("exception", { "exception.message": "boom" });
    emit("exception", { "exception.message": "boom again" });
    await client.flush();
    const sums = (name: string) =>
      payloads().flatMap((p) => p.metrics[name]?.sum.dataPoints ?? []);
    expect(sums("browser.user")).toHaveLength(1);
    expect(sums("browser.user")[0].asDouble).toBe(1);
    expect(sums("browser.user")[0].attributes).toEqual([]);
    expect(sums("browser.user.affected").map(dims)).toEqual([
      { issue: "js_error" },
    ]);
    expect(sums("browser.js_error")[0].asDouble).toBe(2);
    await client.shutdown();

    start();
    emit("exception", { "exception.message": "second page" });
    emit("browser.web_vital", {
      "browser.web_vital.name": "inp",
      "browser.web_vital.id": "v1-2",
      "browser.web_vital.value": 900,
      "browser.web_vital.rating": "poor",
    });
    await client.flush();
    expect(sums("browser.user")).toHaveLength(1);
    expect(sums("browser.user.affected").map(dims)).toEqual([
      { issue: "js_error" },
      { issue: "poor_inp" },
    ]);
  });

  it("does not count users when the device has no storage", async () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    start();
    longFrame(100);
    await client.flush();
    expect(payloads()[0]!.metrics["browser.user"]).toBeUndefined();
  });

  it("puts the app's own dimensions on the resource, two at most", async () => {
    start({
      metricDimensions: {
        plan: "pro",
        "Not-A-Key": "x",
        tier: "gold",
        third: "z",
      },
    });
    client.setMetricDimension("tier", null);
    client.setMetricDimension("region", "eu");
    client.setMetricDimension("fourth", "no");
    longFrame(100);
    await client.flush();
    const { resource } = payloads()[0]!;
    expect(resource["custom.plan"]).toBe("pro");
    expect(resource["custom.region"]).toBe("eu");
    expect(
      Object.keys(resource).filter((k) => k.startsWith("custom.")),
    ).toHaveLength(2);
  });

  it("measures INP and CLS per view, soft navigations included", async () => {
    start();
    client.setRoute("/orders/:id");
    const button = document.createElement("button");
    button.id = "pay";
    document.body.appendChild(button);
    interaction(1, 80);
    interaction(2, 640, button);
    interaction(2, 600);
    layoutShift(0.05, 1000);
    layoutShift(0.04, 1500);
    layoutShift(0.02, 9000);
    history.pushState(null, "", "/cart");
    interaction(3, 120);
    hide();
    await settle();

    const all = payloads();
    const points = (name: string) =>
      all.flatMap(
        (p) => p.metrics[name]?.exponentialHistogram.dataPoints ?? [],
      );
    const inp = points("browser.view.inp");
    expect(inp.map(dims)).toEqual([
      expect.objectContaining({
        "url.path": "/orders/:id",
        rating: "poor",
        view_type: "load",
      }),
      expect.objectContaining({
        "url.path": "/cart",
        rating: "good",
        view_type: "soft",
      }),
    ]);
    expect(inp[0].sum).toBe(640);
    expect(inp[0].exemplars[0].filteredAttributes[1]).toEqual({
      key: "traceway.target",
      value: { stringValue: "button#pay" },
    });
    const cls = points("browser.view.cls");
    expect(cls).toHaveLength(2);
    expect(cls[0].sum).toBeCloseTo(0.09);
    expect(dims(cls[0])).toMatchObject({ rating: "good", view_type: "load" });
    expect(cls[1].sum).toBe(0);
    expect(dims(cls[1])).toMatchObject({
      "url.path": "/cart",
      view_type: "soft",
    });

    // The same view shown again: only what happened since is measured, and a still page adds no second zero.
    hide();
    await settle();
    expect(
      payloads().flatMap(
        (p) =>
          p.metrics["browser.view.cls"]?.exponentialHistogram.dataPoints ?? [],
      ),
    ).toHaveLength(2);
  });

  it("names the element of a slow interaction whose handler removed it", async () => {
    start();
    document.body.innerHTML = `<table><tr class="row"><td><button data-slot="delete">Delete</button></td></tr></table>`;
    const button = document.querySelector("button")!;
    button.addEventListener("click", () => button.closest("tr")!.remove());
    const click = new Event("click", { bubbles: true });
    button.dispatchEvent(click);
    // The entry arrives after the next paint, when its target has left the page.
    observers.get("event")!([
      {
        entryType: "event",
        startTime: click.timeStamp,
        duration: 640,
        interactionId: 9,
        target: null,
      },
    ]);
    hide();
    await settle();
    const [inp] = payloads().flatMap(
      (p) => p.metrics["browser.view.inp"]?.exponentialHistogram.dataPoints ?? [],
    );
    expect(inp.exemplars[0].filteredAttributes[1]).toEqual({
      key: "traceway.target",
      value: { stringValue: 'tr.row>td>button[data-slot="delete"]' },
    });
    document.body.innerHTML = "";
  });

  it("names the element behind a slow vital, as a counter and on the exemplar", async () => {
    start();
    emit("browser.web_vital", {
      "browser.web_vital.name": "lcp",
      "browser.web_vital.id": "v1-9",
      "browser.web_vital.value": 5200,
      "browser.web_vital.rating": "poor",
      "browser.web_vital.target": "#hero>img",
    });
    emit("browser.web_vital", {
      "browser.web_vital.name": "ttfb",
      "browser.web_vital.id": "v1-10",
      "browser.web_vital.value": 5200,
      "browser.web_vital.rating": "poor",
      "browser.web_vital.target": "#ignored",
    });
    await client.flush();
    const { metrics } = payloads()[0]!;
    const counted = metrics["browser.web_vital.attribution"].sum.dataPoints;
    expect(counted).toHaveLength(1);
    expect(dims(counted[0])).toMatchObject({
      vital: "lcp",
      rating: "poor",
      target: "#hero>img",
      "url.path": "/",
    });
    const lcp =
      metrics["browser.web_vital.lcp"].exponentialHistogram.dataPoints[0];
    expect(lcp.exemplars[0].filteredAttributes[1].value.stringValue).toBe(
      "#hero>img",
    );
  });

  it("counts which phase made an interaction slow", async () => {
    start();
    const vital = (
      name: string,
      id: string,
      target: string,
      phase: string,
    ) =>
      emit("browser.web_vital", {
        "browser.web_vital.name": name,
        "browser.web_vital.id": id,
        "browser.web_vital.value": name === "cls" ? 0.4 : 26_400,
        "browser.web_vital.rating": "poor",
        "browser.web_vital.target": target,
        "browser.web_vital.inp.phase": phase,
      });
    vital("inp", "v1-20", 'button[data-slot="button"]', "processing");
    vital("inp", "v1-21", "a.nav", "paused");
    vital("cls", "v1-22", "div.hero", "presentation");
    const ancestors = 'section[data-slot="table-container"]>div.rows';
    vital("inp", "v1-23", `${ancestors}>tr[data-slot="table-row"]`, "");
    await client.flush();
    const counted = payloads()[0]!.metrics[
      "browser.web_vital.attribution"
    ].sum.dataPoints.map(dims);
    expect(counted).toEqual([
      expect.objectContaining({
        vital: "inp",
        target: 'button[data-slot="button"]',
        phase: "processing",
      }),
      expect.not.objectContaining({ phase: expect.anything() }),
      expect.not.objectContaining({ phase: expect.anything() }),
      expect.not.objectContaining({ phase: expect.anything() }),
    ]);
    expect(counted.map((d: Record<string, string>) => d.target)).toEqual([
      'button[data-slot="button"]',
      "a.nav",
      "div.hero",
      'div.rows>tr[data-slot="table-row"]',
    ]);
  });

  it("attributes long frame time to the scripts that ran", async () => {
    start();
    longFrame(300, [
      { sourceURL: "https://cdn.test/app.js?v=3#x", duration: 120 },
      { sourceURL: "https://cdn.test/app.js?v=4", duration: 80 },
      { sourceURL: "", duration: 50 },
    ]);
    await client.flush();
    const points =
      payloads()[0]!.metrics["browser.long_task.script_time"]
        .exponentialHistogram.dataPoints;
    expect(points).toHaveLength(1);
    expect(points[0].sum).toBe(200);
    expect(dims(points[0])).toEqual({ script: "https://cdn.test/app.js" });
  });

  it("uploads with keepalive when the page is hidden", async () => {
    start();
    longFrame(100);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    const call = fetchMock.mock.calls.find(([url]) => url === METRICS_URL)!;
    expect(call[1].keepalive).toBe(true);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });
});

describe("route names read from the app's router", () => {
  const shop = () =>
    createBrowserRouter([
      { path: "/", element: null },
      { path: "/products/:slug", element: null },
      { path: "/cart", element: null },
    ]);

  const paths = (metric: any) =>
    (metric.sum ?? metric.exponentialHistogram).dataPoints.map(
      (point: any) => dims(point)["url.path"],
    );

  afterEach(() => forgetRouters());

  it("names every view by its route template without a setRoute call", async () => {
    history.replaceState(null, "", "/products/blue-shoes");
    const router = shop();
    trackRouter(router);
    start();
    longFrame(100);
    await router.navigate("/products/red-boots");
    longFrame(100);
    await router.navigate("/cart");
    await client.flush();

    const { metrics } = payloads()[0]!;
    // Two views of one route are one series, which the normalized paths would not be.
    const views = metrics["browser.page_view"].sum.dataPoints;
    expect(views).toHaveLength(1);
    expect(dims(views[0])["url.path"]).toBe("/products/:slug");
    expect(views[0].asDouble).toBe(2);
    expect(paths(metrics["browser.long_task.duration"])).toEqual([
      "/products/:slug",
    ]);
  });

  it("files the page load under a route the router names only later", async () => {
    history.replaceState(null, "", "/products/blue-shoes");
    start();
    // TTFB, the session and the load timing arrive before the app has created its router.
    emit("browser.web_vital", {
      "browser.web_vital.name": "TTFB",
      "browser.web_vital.id": "v1-ttfb",
      "browser.web_vital.value": 120,
      "browser.web_vital.rating": "good",
    });
    emit("browser.navigation_timing", {
      "browser.navigation_timing.load_event_end": 900,
    });
    trackRouter(shop());
    await client.flush();

    const { metrics } = payloads()[0]!;
    for (const name of [
      "browser.web_vital.ttfb",
      "browser.page_load.duration",
      "browser.session",
    ])
      expect([name, paths(metrics[name])]).toEqual([name, ["/products/:slug"]]);
  });

  it("asks the router again when it was not ready at the history change", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      history.replaceState(null, "", "/");
      start();
      // The address changes first and the router commits later, as the Next.js Pages Router does.
      history.pushState(null, "", "/products/blue-shoes");
      longFrame(100);
      const late = {
        pathname: "/products/[slug]",
        asPath: "/products/blue-shoes",
      };
      trackRouter(late);
      vi.advanceTimersByTime(600);
      // The router moves on before the view is closed: the name was taken while it still showed this view.
      late.pathname = "/cart";
      late.asPath = "/cart";
      history.pushState(null, "", "/cart");
    } finally {
      vi.useRealTimers();
    }
    await client.flush();

    const views = payloads()[0]!.metrics["browser.page_view"].sum.dataPoints;
    expect(views.map((p: any) => dims(p)["url.path"]).sort()).toEqual([
      "/",
      "/products/[slug]",
    ]);
  });

  it("does not count a view under the route of the page before when the router is slow", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      history.replaceState(null, "", "/settings");
      const slow = { pathname: "/settings", asPath: "/settings" };
      trackRouter(slow);
      start();
      // The address moves when the navigation starts and the router when its loader is done, as TanStack Router
      // does, and the old path is the end of the new one.
      history.pushState(null, "", "/acme/settings");
      vi.advanceTimersByTime(150);
      slow.pathname = "/[team]/settings";
      slow.asPath = "/acme/settings";
      history.pushState(null, "", "/cart");
    } finally {
      vi.useRealTimers();
    }
    await client.flush();

    const views = payloads()[0]!.metrics["browser.page_view"].sum.dataPoints;
    expect(views.map((p: any) => dims(p)["url.path"]).sort()).toEqual([
      "/[team]/settings",
      "/settings",
    ]);
  });

  it("lets setRoute win and detectRoutes switch it off", async () => {
    history.replaceState(null, "", "/products/blue-shoes");
    trackRouter(shop());
    start();
    client.setRoute("/shop/item");
    longFrame(100);
    await client.flush();
    expect(
      paths(payloads()[0]!.metrics["browser.long_task.duration"]),
    ).toEqual(["/shop/item"]);

    await client.shutdown();
    fetchMock.mockClear();
    start({ detectRoutes: false });
    longFrame(100);
    await client.flush();
    expect(
      paths(payloads()[0]!.metrics["browser.long_task.duration"]),
    ).toEqual(["/products/blue-shoes"]);
  });
});
