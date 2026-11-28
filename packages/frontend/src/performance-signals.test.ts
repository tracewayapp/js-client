import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadableLogRecord } from "@opentelemetry/sdk-logs";
import { InMemoryLogRecordExporter } from "@opentelemetry/sdk-logs";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace";

vi.mock("@rrweb/record", () => {
  const record = Object.assign(
    vi.fn(() => () => {}),
    { takeFullSnapshot: vi.fn() },
  );
  return { record };
});

import type { TracewayFrontendOptions } from "./client.js";
import { TracewayFrontendClient } from "./client.js";

let client: TracewayFrontendClient;
let logExporter: InMemoryLogRecordExporter;
let supported: string[];
const observers = new Map<string, (entries: object[]) => void>();

class FakePerformanceObserver {
  static get supportedEntryTypes(): string[] {
    return supported;
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
      ...options,
  });
  client.start();
  return client;
}

async function exported(name: string): Promise<ReadableLogRecord[]> {
  await client.flush();
  return logExporter
    .getFinishedLogRecords()
    .filter((record) => record.eventName === name);
}

function longFrame(duration: number): void {
  observers.get("long-animation-frame")!([
    {
      entryType: "long-animation-frame",
      startTime: performance.now(),
      duration,
      blockingDuration: duration - 50,
      scripts: [
        { duration: 10, sourceURL: "https://app.test/small.js" },
        {
          duration: duration - 20,
          sourceURL: "https://app.test/checkout.js",
          sourceFunctionName: "renderCart",
          invoker: "BUTTON#pay.onclick",
        },
      ],
    },
  ]);
}

beforeEach(() => {
  supported = ["long-animation-frame", "longtask"];
  observers.clear();
  vi.stubGlobal("PerformanceObserver", FakePerformanceObserver);
  history.replaceState(null, "", "/");
});

afterEach(async () => {
  await client?.shutdown();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
  localStorage.clear();
});

describe("long tasks", () => {
  it("collects nothing until remote config turns the signal on", async () => {
    start();
    longFrame(180);
    expect(await exported("browser.long_task")).toHaveLength(0);

    client.control.applyRemote({ signals: { longTasks: { mode: "stream" } } });
    longFrame(240);
    const records = await exported("browser.long_task");
    expect(records).toHaveLength(1);
    expect(records[0]!.attributes).toMatchObject({
      "browser.long_task.type": "long-animation-frame",
      "browser.long_task.duration": 240,
      "browser.long_task.blocking_duration": 190,
      "browser.long_task.script.url": "https://app.test/checkout.js",
      "browser.long_task.script.function": "renderCart",
      "browser.long_task.script.invoker": "BUTTON#pay.onclick",
    });
  });

  it("falls back to the long tasks API", async () => {
    supported = ["longtask"];
    start();
    client.control.applyRemote({ signals: { longTasks: { mode: "stream" } } });
    observers.get("longtask")!([
      {
        entryType: "longtask",
        startTime: performance.now(),
        duration: 90,
        attribution: [{ containerType: "iframe", containerSrc: "/ad.html" }],
      },
    ]);
    const records = await exported("browser.long_task");
    expect(records[0]!.attributes).toMatchObject({
      "browser.long_task.type": "longtask",
      "browser.long_task.duration": 90,
      "browser.long_task.container.type": "iframe",
      "browser.long_task.container.src": "/ad.html",
    });
  });

  it("reports a block once, also when the browser gives no frame entry for it", async () => {
    start();
    client.control.applyRemote({ signals: { longTasks: { mode: "stream" } } });
    const now = performance.now();
    const task = (startTime: number, duration: number) =>
      observers.get("longtask")!([
        { entryType: "longtask", startTime, duration },
      ]);
    task(now - 300, 200);
    observers.get("long-animation-frame")!([
      {
        entryType: "long-animation-frame",
        startTime: now - 300,
        duration: 210,
      },
    ]);
    task(now - 90, 80);

    await new Promise((resolve) => setTimeout(resolve, 1200));
    const reported = (await exported("browser.long_task")).map((record) => [
      record.attributes["browser.long_task.type"],
      record.attributes["browser.long_task.duration"],
    ]);
    expect(reported).toEqual([
      ["long-animation-frame", 210],
      ["longtask", 80],
    ]);
  });

  it("fires a trigger on a long block while the signal is off, and a trigger can stream it", async () => {
    start();
    client.control.applyRemote({
      triggers: [
        {
          id: "frozen-page",
          steps: [
            {
              match: {
                all: [
                  { key: "signal", op: "eq", value: "longTasks" },
                  {
                    key: "attributes.browser.long_task.duration",
                    op: "gte",
                    value: 500,
                  },
                ],
              },
            },
          ],
          actions: [
            { type: "stream", durationSeconds: 60, signals: ["longTasks"] },
          ],
        },
      ],
    });
    longFrame(120);
    expect(await exported("traceway.trigger.fired")).toHaveLength(0);

    longFrame(700);
    expect(await exported("traceway.trigger.fired")).toHaveLength(1);
    expect(client.control.modeFor("longTasks")).toBe("stream");
    longFrame(130);
    const durations = (await exported("browser.long_task")).map(
      (record) => record.attributes["browser.long_task.duration"],
    );
    // The block that fired the trigger is sent with what follows it.
    expect(durations).toEqual([700, 130]);
  });

  it("stays off when init() does not allow it", async () => {
    start({ captureLongTasks: false });
    client.control.applyRemote({ signals: { longTasks: { mode: "stream" } } });
    expect(client.control.modeFor("longTasks")).toBe("off");
    expect(observers.has("long-animation-frame")).toBe(false);
  });

  it("caps a page that never stops blocking", async () => {
    start();
    client.control.applyRemote({ signals: { longTasks: { mode: "stream" } } });
    for (let i = 0; i < 50; i++) longFrame(60);
    expect(await exported("browser.long_task")).toHaveLength(30);
  });
});

describe("route timing", () => {
  it("measures a route change up to the last DOM change", async () => {
    start();
    client.control.applyRemote({
      signals: { routeTiming: { mode: "stream" } },
    });
    history.pushState(null, "", "/orders");
    await new Promise((resolve) => setTimeout(resolve, 120));
    document.body.appendChild(document.createElement("section"));

    await vi.waitFor(
      async () =>
        expect(await exported("browser.route_timing")).toHaveLength(1),
      { timeout: 3000 },
    );
    const attributes = (await exported("browser.route_timing"))[0]!.attributes;
    expect(attributes).toMatchObject({
      "url.full": "http://localhost:3000/orders",
      "browser.route_timing.from": "http://localhost:3000/",
      "browser.route_timing.type": "push",
      "browser.route_timing.outcome": "settled",
    });
    const duration = attributes["browser.route_timing.duration"] as number;
    expect(duration).toBeGreaterThanOrEqual(100);
    expect(duration).toBeLessThan(500);
  });

  it("waits for requests that started during the route change", async () => {
    start();
    client.control.applyRemote({
      signals: { routeTiming: { mode: "stream" } },
    });
    const routeTiming = client["routeTiming"]!;
    const stale = {};
    routeTiming.requestStarted(stale);
    history.pushState(null, "", "/slow");
    const request = {};
    routeTiming.requestStarted(request);
    await new Promise((resolve) => setTimeout(resolve, 800));
    expect(await exported("browser.route_timing")).toHaveLength(0);
    routeTiming.requestEnded(request);

    await vi.waitFor(
      async () =>
        expect(await exported("browser.route_timing")).toHaveLength(1),
      { timeout: 3000 },
    );
    const attributes = (await exported("browser.route_timing"))[0]!.attributes;
    expect(attributes["browser.route_timing.duration"]).toBeGreaterThanOrEqual(
      790,
    );
    expect(attributes["browser.route_timing.requests"]).toBe(1);
  });

  it("reports an abandoned route change and ignores hash changes", async () => {
    start();
    client.control.applyRemote({
      signals: { routeTiming: { mode: "stream" } },
    });
    history.pushState(null, "", "/a");
    history.pushState(null, "", "/a#details");
    history.replaceState(null, "", "/b");

    await vi.waitFor(
      async () =>
        expect(await exported("browser.route_timing")).toHaveLength(2),
      { timeout: 3000 },
    );
    const outcomes = (await exported("browser.route_timing")).map((record) => [
      record.attributes["url.full"],
      record.attributes["browser.route_timing.type"],
      record.attributes["browser.route_timing.outcome"],
    ]);
    expect(outcomes).toEqual([
      ["http://localhost:3000/a", "push", "interrupted"],
      ["http://localhost:3000/b", "replace", "settled"],
    ]);
  });

  it("is off by default and restores history on shutdown", async () => {
    const pushState = history.pushState;
    start();
    expect(history.pushState).not.toBe(pushState);
    history.pushState(null, "", "/quiet");
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(await exported("browser.route_timing")).toHaveLength(0);
    await client.shutdown();
    expect(history.pushState).toBe(pushState);
  });
});
