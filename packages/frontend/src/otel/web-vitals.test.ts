import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SeverityNumber } from "@opentelemetry/api-logs";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import type {
  CLSMetricWithAttribution,
  INPMetricWithAttribution,
  LCPMetricWithAttribution,
  MetricWithAttribution,
} from "web-vitals/attribution";

const listeners = vi.hoisted(() => ({
  registered: [] as Array<{
    name: string;
    report: (metric: unknown) => void;
    options: { reportAllChanges?: boolean; generateTarget?: unknown };
  }>,
}));

vi.mock("web-vitals/attribution", () => {
  const on =
    (name: string) =>
    (report: (metric: unknown) => void, options: object) =>
      listeners.registered.push({ name, report, options });
  return {
    onCLS: on("CLS"),
    onINP: on("INP"),
    onLCP: on("LCP"),
    onFCP: on("FCP"),
    onTTFB: on("TTFB"),
  };
});

import { WebVitalsInstrumentation, webVitalRecord } from "./web-vitals.js";

function inp(
  attribution: Partial<INPMetricWithAttribution["attribution"]>,
): INPMetricWithAttribution {
  return {
    name: "INP",
    value: 26_400,
    rating: "poor",
    delta: 26_400,
    id: "v6-1",
    entries: [],
    navigationType: "navigate",
    navigationId: 1,
    attribution: {
      processedEventEntries: [],
      longAnimationFrameEntries: [],
      inputDelay: 0,
      processingDuration: 0,
      presentationDelay: 0,
      loadState: "complete",
      ...attribution,
    },
  };
}

describe("webVitalRecord", () => {
  it("names the slow phase and the longest script of an interaction", () => {
    const record = webVitalRecord(
      inp({
        interactionTarget: 'button[data-slot="button"]',
        interactionTime: 5120.5,
        interactionType: "pointer",
        inputDelay: 12,
        processingDuration: 26_300,
        presentationDelay: 88,
        longestScript: {
          entry: {
            sourceURL: "https://app.test/_app/immutable/chunks/table.3f2a.js?v=2#x",
            sourceFunctionName: "sortRows",
          } as PerformanceScriptTiming,
          subpart: "processing-duration",
          intersectingDuration: 26_000,
        },
      }),
    );
    expect(record).toEqual({
      eventName: "browser.web_vital",
      severityNumber: SeverityNumber.INFO,
      timestamp: 5120.5,
      attributes: {
        "browser.web_vital.name": "inp",
        "browser.web_vital.value": 26_400,
        "browser.web_vital.delta": 26_400,
        "browser.web_vital.rating": "poor",
        "browser.web_vital.id": "v6-1",
        "browser.web_vital.navigation_type": "navigate",
        "browser.web_vital.target": 'button[data-slot="button"]',
        "browser.web_vital.inp.input_delay": 12,
        "browser.web_vital.inp.processing_duration": 26_300,
        "browser.web_vital.inp.presentation_delay": 88,
        "browser.web_vital.inp.phase": "processing",
        "browser.web_vital.inp.interaction_type": "pointer",
        "browser.web_vital.inp.script": "table.3f2a.js#sortRows",
      },
    });
  });

  it("reports input delay and presentation as the phase they are", () => {
    const phase = (inputDelay: number, presentationDelay: number) =>
      webVitalRecord(
        inp({
          interactionTime: 10,
          inputDelay,
          processingDuration: 5,
          presentationDelay,
        }),
      ).attributes!["browser.web_vital.inp.phase"];
    expect(phase(400, 30)).toBe("input_delay");
    expect(phase(30, 400)).toBe("presentation");
  });

  it("leaves out a script web-vitals does not know and the placeholder phases of an INP without entries", () => {
    const withoutScript = webVitalRecord(
      inp({ interactionTime: 10, inputDelay: 300, interactionType: "keyboard" }),
    ).attributes!;
    expect(withoutScript["browser.web_vital.inp.script"]).toBeUndefined();
    expect(withoutScript["browser.web_vital.inp.interaction_type"]).toBe(
      "keyboard",
    );
    const placeholder = webVitalRecord(inp({ presentationDelay: 26_400 }));
    expect(placeholder.timestamp).toBeUndefined();
    expect(Object.keys(placeholder.attributes!)).toEqual([
      "browser.web_vital.name",
      "browser.web_vital.value",
      "browser.web_vital.delta",
      "browser.web_vital.rating",
      "browser.web_vital.id",
      "browser.web_vital.navigation_type",
    ]);
  });

  it("dates CLS by its largest shift and names the element that moved", () => {
    const cls: CLSMetricWithAttribution = {
      name: "CLS",
      value: 0.31,
      rating: "poor",
      delta: 0.31,
      id: "v6-2",
      entries: [],
      navigationType: "reload",
      navigationId: 1,
      attribution: {
        largestShiftTarget: "div.hero>img",
        largestShiftTime: 812,
      },
    };
    const record = webVitalRecord(cls);
    expect(record.timestamp).toBe(812);
    expect(record.attributes).toEqual({
      "browser.web_vital.name": "cls",
      "browser.web_vital.value": 0.31,
      "browser.web_vital.delta": 0.31,
      "browser.web_vital.rating": "poor",
      "browser.web_vital.id": "v6-2",
      "browser.web_vital.navigation_type": "reload",
      "browser.web_vital.target": "div.hero>img",
    });
    expect(
      webVitalRecord({ ...cls, attribution: {} }).timestamp,
    ).toBeUndefined();
  });

  it("dates LCP by its value, as the Browser SIG instrumentation does, and keeps only targets selectorOf wrote", () => {
    const lcp: LCPMetricWithAttribution = {
      name: "LCP",
      value: 2480,
      rating: "needs-improvement",
      delta: 2480,
      id: "v6-3",
      entries: [],
      navigationType: "navigate",
      navigationId: 1,
      attribution: {
        target: `img.${"x".repeat(120)}`,
        timeToFirstByte: 100,
        resourceLoadDelay: 0,
        resourceLoadDuration: 0,
        elementRenderDelay: 0,
      },
    };
    const record = webVitalRecord(lcp);
    expect(record.timestamp).toBe(2480);
    expect(record.attributes!["browser.web_vital.target"]).toBeUndefined();
    expect(record.attributes!["browser.web_vital.inp.phase"]).toBeUndefined();
    const target = (selector: string) =>
      webVitalRecord({ ...lcp, attribution: { ...lcp.attribution, target: selector } })
        .attributes!["browser.web_vital.target"];
    expect(target('main#shop>img[data-slot="hero"]')).toBe(
      'main#shop>img[data-slot="hero"]',
    );
    // web-vitals' own fallback for an LCP element that has left the page.
    expect(target("#radix-:r1:")).toBeUndefined();
  });

  it("drops the browser's selector of an interaction whose element has left the page", () => {
    const record = webVitalRecord(
      inp({
        interactionTarget: "BODY > DIV:nth-child(2) > BUTTON#bits-c10",
        interactionTime: 10,
        processingDuration: 300,
      }),
    );
    expect(record.attributes!["browser.web_vital.target"]).toBeUndefined();
    expect(record.attributes!["browser.web_vital.inp.phase"]).toBe("processing");
  });
});

describe("WebVitalsInstrumentation", () => {
  let exporter: InMemoryLogRecordExporter;
  let instrumentation: WebVitalsInstrumentation;

  beforeEach(() => {
    listeners.registered = [];
    vi.stubGlobal("PerformanceObserver", class {});
    exporter = new InMemoryLogRecordExporter();
    instrumentation = new WebVitalsInstrumentation();
    instrumentation.setLoggerProvider(
      new LoggerProvider({
        processors: [new SimpleLogRecordProcessor({ exporter })],
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const report = (metric: MetricWithAttribution) => {
    for (const listener of listeners.registered)
      if (listener.name === metric.name) listener.report(metric);
  };

  it("registers the library's listeners once, with its own selector, and pauses while disabled", () => {
    instrumentation.enable();
    expect(listeners.registered.map((l) => l.name)).toEqual([
      "CLS",
      "INP",
      "LCP",
      "FCP",
      "TTFB",
    ]);
    const { options } = listeners.registered[0]!;
    expect(options.reportAllChanges).toBe(false);
    const generateTarget = options.generateTarget as (node: Node) => string;
    const button = document.createElement("button");
    button.id = "bits-c126";
    button.setAttribute("data-slot", "button");
    document.body.appendChild(button);
    expect(generateTarget(button)).toBe('button[data-slot="button"]');
    expect(generateTarget(document)).toBe("");

    report(inp({ interactionTime: 1 }));
    expect(exporter.getFinishedLogRecords()).toHaveLength(1);
    instrumentation.disable();
    report(inp({ interactionTime: 2 }));
    expect(exporter.getFinishedLogRecords()).toHaveLength(1);
    instrumentation.enable();
    expect(listeners.registered).toHaveLength(5);
    report(inp({ interactionTime: 3 }));
    expect(exporter.getFinishedLogRecords()).toHaveLength(2);
    button.remove();
  });

  it("names the element of a slow interaction whose handler removed it, while it is one of the ten slowest", () => {
    const observer = {
      deliver: (_entries: object[]) => {},
      pending: [] as object[],
    };
    vi.stubGlobal(
      "PerformanceObserver",
      class {
        static supportedEntryTypes = ["event"];
        constructor(callback: (list: { getEntries(): object[] }) => void) {
          observer.deliver = (entries) => callback({ getEntries: () => entries });
        }
        observe(): void {}
        takeRecords(): object[] {
          const records = observer.pending;
          observer.pending = [];
          return records;
        }
      },
    );
    instrumentation.enable();
    document.body.innerHTML = `<ul class="menu"><li><button data-slot="menu-item">Archive</button></li></ul>`;
    const button = document.querySelector("button")!;
    button.addEventListener("click", () => button.closest("ul")!.remove());
    const click = new Event("click", { bubbles: true });
    button.dispatchEvent(click);
    // The browser's entries for an element that has left the page have no target.
    const entry = (interactionId: number, duration: number, startTime: number) => ({
      entryType: "event",
      name: "click",
      interactionId,
      duration,
      startTime,
      target: null,
    });
    const slow = entry(7, 600, click.timeStamp);
    observer.deliver([entry(3, 48, click.timeStamp - 5)]);
    // Measured but not yet delivered when the page is hidden.
    observer.pending = [slow];
    const reportInp = () => {
      report({
        ...inp({ interactionTime: click.timeStamp, processingDuration: 600 }),
        entries: [slow] as unknown as PerformanceEventTiming[],
      });
      return exporter.getFinishedLogRecords().at(-1)!.attributes[
        "browser.web_vital.target"
      ];
    };
    expect(reportInp()).toBe('ul.menu>li>button[data-slot="menu-item"]');
    observer.deliver(
      Array.from({ length: 10 }, (_, i) => entry(20 + i, 700 + i, i)),
    );
    expect(reportInp()).toBeUndefined();
  });

  it("collects nothing without PerformanceObserver", () => {
    vi.stubGlobal("PerformanceObserver", undefined);
    instrumentation.enable();
    expect(listeners.registered).toHaveLength(0);
  });
});
