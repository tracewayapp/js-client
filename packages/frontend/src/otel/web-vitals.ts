import type { AnyValueMap, LogRecord } from "@opentelemetry/api-logs";
import { SeverityNumber } from "@opentelemetry/api-logs";
import { guarded } from "../guarded.js";
import type {
  INPMetricWithAttribution,
  MetricWithAttribution,
} from "web-vitals/attribution";
import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals/attribution";
import { EVENT_WEB_VITAL } from "./events.js";
import { interactionTargets } from "./interaction-targets.js";
import { ATTR_INP_PHASE, ATTR_WEB_VITAL_TARGET } from "./metrics-recorder.js";
import {
  LogInstrumentation,
  supportsEntryType,
} from "./performance-instrumentation.js";
import { isStableSelector, selectorOf } from "./selector.js";
import { ViewVitals } from "./view-vitals.js";

const ATTR_INP_INPUT_DELAY = "browser.web_vital.inp.input_delay";
const ATTR_INP_PROCESSING_DURATION = "browser.web_vital.inp.processing_duration";
const ATTR_INP_PRESENTATION_DELAY = "browser.web_vital.inp.presentation_delay";
const ATTR_INP_INTERACTION_TYPE = "browser.web_vital.inp.interaction_type";
const ATTR_INP_SCRIPT = "browser.web_vital.inp.script";

const MAX_SCRIPT_LENGTH = 100;
/** web-vitals' default: a shorter interaction is not a candidate for INP. */
const INP_DURATION_THRESHOLD_MS = 40;

/**
 * The elements of the slowest interactions, as named when their events were dispatched. web-vitals names the
 * element of an interaction only once it has the entries, after the next paint, and a handler that removed the
 * element leaves it nothing to name. INP is reported when the page is hidden and is one of the ten slowest, which
 * `ViewVitals` keeps with their elements, the same way for a view.
 */
class SlowestInteractions {
  private readonly slowest = new ViewVitals();
  private observer: PerformanceObserver | null = null;
  // web-vitals measures a page restored from the back/forward cache from scratch.
  private readonly onPageShow = (event: Event): void => {
    if ((event as PageTransitionEvent).persisted) this.slowest.restart();
  };

  start(): void {
    if (this.observer || !supportsEntryType("event")) return;
    interactionTargets.retain();
    this.observer = new PerformanceObserver((list) =>
      guarded("web vitals", () => this.add(list.getEntries())),
    );
    this.observer.observe({
      type: "event",
      buffered: true,
      durationThreshold: INP_DURATION_THRESHOLD_MS,
    } as PerformanceObserverInit);
    addEventListener("pageshow", this.onPageShow);
  }

  stop(): void {
    const observer = this.observer;
    if (!observer) return;
    this.observer = null;
    removeEventListener("pageshow", this.onPageShow);
    interactionTargets.release();
    observer.disconnect();
  }

  private add(entries: PerformanceEntryList): void {
    for (const entry of entries) this.slowest.add(entry);
  }

  /** The element named for the interaction of an INP, counting entries measured but not yet delivered. */
  targetOf(metric: INPMetricWithAttribution): string | undefined {
    if (this.observer) this.add(this.observer.takeRecords());
    return this.slowest.targetOf(
      (metric.entries[0] as { interactionId?: number } | undefined)
        ?.interactionId,
    );
  }
}

/**
 * Without a selector of ours, web-vitals would fall back to its own, which keeps generated ids and classes. It is
 * not asked about an element that has already left the page: see `isStableSelector`.
 */
function generateTarget(node: Node | null): string {
  return selectorOf(node) ?? "";
}

/** File name of a script and the function that ran: the path, query and hash would only add builds and users. */
function scriptOf(entry: {
  sourceURL?: string;
  sourceFunctionName?: string;
}): string | undefined {
  const path = (entry.sourceURL ?? "").split(/[?#]/)[0]!;
  const file = path.split("/").filter(Boolean).pop() ?? "";
  const fn = entry.sourceFunctionName;
  const script = fn ? `${file}#${fn}` : file;
  return script ? script.slice(0, MAX_SCRIPT_LENGTH) : undefined;
}

/** The same timestamp rule as the Browser SIG instrumentation, so records keep their place in time. */
function timestampOf(metric: MetricWithAttribution): number | undefined {
  if (metric.name === "CLS") return metric.attribution.largestShiftTime;
  if (metric.name === "INP") return metric.attribution.interactionTime;
  return metric.value;
}

function targetOf(metric: MetricWithAttribution): string | undefined {
  const attribution = metric.attribution as {
    target?: string;
    interactionTarget?: string;
    largestShiftTarget?: string;
  };
  return (
    attribution.target ??
    attribution.interactionTarget ??
    attribution.largestShiftTarget
  );
}

function addInpAttribution(
  attributes: AnyValueMap,
  metric: INPMetricWithAttribution,
): void {
  const a = metric.attribution;
  // Without an event entry web-vitals reports placeholder phases (all of the value as presentation).
  if (a.interactionTime === undefined) return;
  attributes[ATTR_INP_INPUT_DELAY] = a.inputDelay;
  attributes[ATTR_INP_PROCESSING_DURATION] = a.processingDuration;
  attributes[ATTR_INP_PRESENTATION_DELAY] = a.presentationDelay;
  const phases: Array<[string, number]> = [
    ["input_delay", a.inputDelay],
    ["processing", a.processingDuration],
    ["presentation", a.presentationDelay],
  ];
  let longest: [string, number] = ["", 0];
  for (const phase of phases) if (phase[1] > longest[1]) longest = phase;
  if (longest[0]) attributes[ATTR_INP_PHASE] = longest[0];
  if (a.interactionType)
    attributes[ATTR_INP_INTERACTION_TYPE] = a.interactionType;
  const script = a.longestScript && scriptOf(a.longestScript.entry);
  if (script) attributes[ATTR_INP_SCRIPT] = script;
}

/**
 * The `browser.web_vital` record of the Browser SIG's web vitals instrumentation, plus the element behind the value
 * and, for INP, which part of the interaction was slow. A very long INP is kept as it is: a paused debugger and a
 * frozen main thread cannot be told apart, so the phases say where the time went instead. `namedTarget` is the
 * element named when the interaction's event was dispatched, for an INP whose element has since left the page.
 */
export function webVitalRecord(
  metric: MetricWithAttribution,
  namedTarget?: string,
): LogRecord {
  const attributes: AnyValueMap = {
    "browser.web_vital.name": metric.name.toLowerCase(),
    "browser.web_vital.value": metric.value,
    "browser.web_vital.delta": metric.delta,
    "browser.web_vital.rating": metric.rating,
    "browser.web_vital.id": metric.id,
    "browser.web_vital.navigation_type": metric.navigationType,
  };
  // A value is still a measurement without its element.
  const target = [targetOf(metric), namedTarget].find(
    (candidate) =>
      typeof candidate === "string" && candidate && isStableSelector(candidate),
  );
  if (target) attributes[ATTR_WEB_VITAL_TARGET] = target;
  if (metric.name === "INP") addInpAttribution(attributes, metric);
  const timestamp = timestampOf(metric);
  return {
    eventName: EVENT_WEB_VITAL,
    severityNumber: SeverityNumber.INFO,
    attributes,
    ...(timestamp !== undefined ? { timestamp } : {}),
  };
}

/**
 * LCP, INP, CLS, FCP and TTFB from the web-vitals library as `browser.web_vital` events. The Browser SIG's
 * instrumentation cannot pass `generateTarget` to the library, so it is replaced by this one. The library cannot
 * remove its listeners: they are registered once, and disabling stops their records. The SDK's own observer and
 * listeners are removed when it is disabled.
 */
export class WebVitalsInstrumentation extends LogInstrumentation {
  private registered = false;
  private readonly interactions = new SlowestInteractions();

  constructor() {
    super("@tracewayapp/frontend/web-vitals");
  }

  protected attach(): void {
    if (typeof PerformanceObserver === "undefined") return;
    if (!this.registered) {
      this.registered = true;
      const options = { reportAllChanges: false, generateTarget };
      const report = (metric: MetricWithAttribution) => this.report(metric);
      onCLS(report, options);
      onINP(report, options);
      onLCP(report, options);
      onFCP(report, options);
      onTTFB(report, options);
    }
    this.interactions.start();
  }

  protected detach(): void {
    this.interactions.stop();
  }

  private report(metric: MetricWithAttribution): void {
    if (!this.enabled || !this.logger) return;
    // It runs in the library's own listeners: a throw would reach the page as an uncaught error.
    guarded("web vitals", () =>
      this.logger!.emit(
        webVitalRecord(
          metric,
          metric.name === "INP" ? this.interactions.targetOf(metric) : undefined,
        ),
      ),
    );
  }
}
