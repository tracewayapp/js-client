import { SeverityNumber } from "@opentelemetry/api-logs";
import { EVENT_ROUTE_TIMING } from "./events.js";
import {
  LogInstrumentation,
  epochMs,
  supportsEntryType,
} from "./performance-instrumentation.js";

/** The page counts as rendered once nothing has happened for this long and no request is in flight. */
const QUIET_MS = 500;
const MAX_MS = 30_000;

type RouteChangeType = "push" | "replace" | "traverse";
type HistoryMethod = "pushState" | "replaceState";

interface Measurement {
  from: string;
  to: string;
  type: RouteChangeType;
  startMs: number;
  lastActivityMs: number;
  requests: number;
  open: Set<unknown>;
}

function withoutHash(url: string): string {
  const index = url.indexOf("#");
  return index < 0 ? url : url.slice(0, index);
}

/**
 * How long a single-page-app route change takes, as `browser.route_timing` events: from the history change until
 * the page goes quiet, meaning no DOM mutation, finished resource or request in flight for half a second. The
 * duration ends at the last of those, not at the end of the quiet period.
 *
 * It cannot see a load that is still running and has produced nothing yet (a lazy chunk, an image), so a route
 * whose only work is one such load longer than the quiet period is reported short.
 */
export class RouteTimingInstrumentation extends LogInstrumentation {
  private lastUrl = "";
  private current: Measurement | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private mutations: MutationObserver | null = null;
  private resources: PerformanceObserver | null = null;
  private originals: Partial<Record<HistoryMethod, History[HistoryMethod]>> =
    {};
  private wrappers: Partial<Record<HistoryMethod, History[HistoryMethod]>> = {};
  private readonly onPopState = () => this.routeChanged("traverse");
  private readonly onVisibility = () => {
    // Timers and rendering are throttled in a hidden tab, so the measurement would be of the throttling.
    if (document.visibilityState === "hidden") this.discard();
  };

  constructor() {
    super("@tracewayapp/frontend/route-timing");
  }

  /** The SDK reports the requests it traces, so a route waiting only for a response is not taken for rendered. */
  requestStarted(request: unknown): void {
    if (!this.current) return;
    this.current.open.add(request);
    this.current.requests++;
  }

  requestEnded(request: unknown): void {
    if (this.current?.open.delete(request)) this.touch();
  }

  protected attach(): void {
    if (typeof history === "undefined" || typeof location === "undefined")
      return;
    this.lastUrl = withoutHash(location.href);
    for (const method of ["pushState", "replaceState"] as const) {
      const original = history[method];
      const instrumentation = this;
      const wrapper = function (
        this: History,
        ...args: Parameters<History[HistoryMethod]>
      ) {
        const result = original.apply(this, args);
        try {
          instrumentation.routeChanged(
            method === "pushState" ? "push" : "replace",
          );
        } catch {
          // Measuring must never break navigation.
        }
        return result;
      };
      this.originals[method] = original;
      this.wrappers[method] = wrapper;
      history[method] = wrapper;
    }
    window.addEventListener("popstate", this.onPopState);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  protected detach(): void {
    this.discard();
    for (const method of ["pushState", "replaceState"] as const) {
      // Something that wrapped history after us still calls our wrapper; it stays, inert.
      if (history[method] === this.wrappers[method] && this.originals[method])
        history[method] = this.originals[method]!;
    }
    this.originals = {};
    this.wrappers = {};
    window.removeEventListener("popstate", this.onPopState);
    document.removeEventListener("visibilitychange", this.onVisibility);
  }

  private routeChanged(type: RouteChangeType): void {
    if (!this.enabled) return;
    const to = withoutHash(location.href);
    if (to === this.lastUrl) return;
    const from = this.lastUrl;
    this.lastUrl = to;
    if (this.current) this.finish("interrupted");
    if (document.visibilityState === "hidden") return;

    const now = performance.now();
    this.current = {
      from,
      to,
      type,
      startMs: now,
      lastActivityMs: now,
      requests: 0,
      open: new Set(),
    };
    if (typeof MutationObserver !== "undefined") {
      this.mutations = new MutationObserver(() => this.touch());
      this.mutations.observe(document, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    }
    if (supportsEntryType("resource")) {
      this.resources = new PerformanceObserver((list) => {
        const current = this.current;
        if (!current) return;
        for (const entry of list.getEntries()) {
          const end = entry.startTime + entry.duration;
          if (end > current.startMs) this.touch(end);
        }
      });
      this.resources.observe({ type: "resource" });
    }
    this.schedule(QUIET_MS);
  }

  private touch(at = performance.now()): void {
    if (this.current && at > this.current.lastActivityMs)
      this.current.lastActivityMs = at;
  }

  private schedule(delayMs: number): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.check(), delayMs);
  }

  private check(): void {
    this.timer = null;
    const current = this.current;
    if (!current) return;
    // Observer callbacks are delivered asynchronously; take what is already queued before deciding.
    if (this.mutations?.takeRecords().length) this.touch();
    const now = performance.now();
    if (now - current.startMs >= MAX_MS) return this.finish("timeout");
    const quietFor = now - current.lastActivityMs;
    if (current.open.size === 0 && quietFor >= QUIET_MS)
      return this.finish("settled");
    this.schedule(
      current.open.size > 0 ? 100 : Math.max(QUIET_MS - quietFor, 10),
    );
  }

  private finish(outcome: "settled" | "timeout" | "interrupted"): void {
    const current = this.current;
    if (!current) return;
    this.discard();
    const endMs =
      outcome === "settled" ? current.lastActivityMs : performance.now();
    this.logger?.emit({
      eventName: EVENT_ROUTE_TIMING,
      severityNumber: SeverityNumber.INFO,
      timestamp: epochMs(endMs),
      attributes: {
        "url.full": current.to,
        "browser.route_timing.from": current.from,
        "browser.route_timing.type": current.type,
        "browser.route_timing.duration": Math.round(endMs - current.startMs),
        "browser.route_timing.outcome": outcome,
        "browser.route_timing.requests": current.requests,
      },
    });
  }

  private discard(): void {
    this.current = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.mutations?.disconnect();
    this.mutations = null;
    this.resources?.disconnect();
    this.resources = null;
  }
}
