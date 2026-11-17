import { supportsEntryType } from "./performance-instrumentation.js";

const SLOWEST_KEPT = 10;
/** The web vitals rule: one outlier is forgiven per 50 interactions. */
const INTERACTIONS_PER_OUTLIER = 50;
/** The lowest the browser accepts. Interactions faster than this are not reported, only counted. */
const EVENT_DURATION_THRESHOLD_MS = 16;
const SHIFT_GAP_MS = 1000;
const SHIFT_WINDOW_MS = 5000;
const MAX_TARGET_LENGTH = 100;

interface EventEntry extends PerformanceEntry {
  interactionId?: number;
  target?: unknown;
}

interface ShiftEntry extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
  sources?: Array<{ node?: unknown }>;
}

interface Interaction {
  id: number;
  duration: number;
  target?: string;
}

/** A short CSS selector of an element: enough to find it, bounded so it can be a dimension. */
export function selectorOf(node: unknown): string | undefined {
  let element = node as Element | null | undefined;
  if (!element || element.nodeType !== 1) return undefined;
  const parts: string[] = [];
  for (; element && parts.length < 3; element = element.parentElement) {
    let part = element.localName;
    if (element.id) {
      parts.unshift(`${part}#${element.id}`);
      break;
    }
    const classes =
      typeof element.className === "string"
        ? element.className.split(/\s+/).filter(Boolean).slice(0, 2)
        : [];
    if (classes.length) part += `.${classes.join(".")}`;
    parts.unshift(part);
  }
  return parts.join(">").slice(0, MAX_TARGET_LENGTH);
}

function interactionCount(): number {
  const count =
    typeof performance === "undefined"
      ? undefined
      : (performance as Performance & { interactionCount?: number })
          .interactionCount;
  return typeof count === "number" ? count : 0;
}

/** Interaction latency and layout shift of one view, the way INP and CLS are defined for a page. */
export class ViewVitals {
  private interactions = 0;
  private countAtStart = interactionCount();
  private slowest: Interaction[] = [];
  private windowValue = 0;
  private windowStart = 0;
  private windowEnd = 0;
  private largestShift = 0;
  private recorded = false;
  cls = 0;
  clsTarget: string | undefined;
  shifted = false;

  add(entry: PerformanceEntry): void {
    if (entry.entryType === "layout-shift") this.shift(entry as ShiftEntry);
    else this.interaction(entry as EventEntry);
  }

  private interaction(entry: EventEntry): void {
    const id = entry.interactionId;
    if (!id) return;
    const known = this.slowest.find((i) => i.id === id);
    if (known) {
      if (entry.duration > known.duration) known.duration = entry.duration;
    } else {
      this.interactions++;
      const last = this.slowest[this.slowest.length - 1];
      if (
        this.slowest.length >= SLOWEST_KEPT &&
        last!.duration >= entry.duration
      )
        return;
      this.slowest.push({
        id,
        duration: entry.duration,
        target: selectorOf(entry.target),
      });
    }
    this.slowest.sort((a, b) => b.duration - a.duration);
    this.slowest.length = Math.min(this.slowest.length, SLOWEST_KEPT);
  }

  private shift(entry: ShiftEntry): void {
    if (entry.hadRecentInput || !(entry.value > 0)) return;
    if (
      this.windowValue > 0 &&
      entry.startTime - this.windowEnd < SHIFT_GAP_MS &&
      entry.startTime - this.windowStart < SHIFT_WINDOW_MS
    ) {
      this.windowValue += entry.value;
    } else {
      this.windowValue = entry.value;
      this.windowStart = entry.startTime;
    }
    this.windowEnd = entry.startTime;
    this.shifted = true;
    if (this.windowValue > this.cls) this.cls = this.windowValue;
    if (entry.value > this.largestShift) {
      this.largestShift = entry.value;
      this.clsTarget = selectorOf(entry.sources?.[0]?.node) ?? this.clsTarget;
    }
  }

  inp(): { value: number; target?: string } | null {
    // The browser counts every interaction but reports only the slow ones. A view whose interactions were all
    // fast still has an INP; leaving it out would make the distribution look slower than it is.
    const total = Math.max(
      this.interactions,
      interactionCount() - this.countAtStart,
    );
    if (!total) return null;
    const chosen =
      this.slowest[
        Math.min(
          this.slowest.length - 1,
          Math.floor(total / INTERACTIONS_PER_OUTLIER),
        )
      ];
    if (!chosen) return { value: EVENT_DURATION_THRESHOLD_MS };
    return { value: chosen.duration, target: chosen.target };
  }

  /**
   * Starts the next visible stretch of the same view. Reports whether this was the first: a view with no shift at
   * all has a CLS of 0 once, not once per time the tab was hidden.
   */
  restart(): boolean {
    const first = !this.recorded;
    this.recorded = true;
    this.interactions = 0;
    this.countAtStart = interactionCount();
    this.slowest = [];
    this.windowValue = this.cls = this.largestShift = 0;
    this.clsTarget = undefined;
    this.shifted = false;
    return first;
  }
}

/** Feeds `event` and `layout-shift` entries to whoever tracks the current view. */
export class ViewVitalsObserver {
  private observers: PerformanceObserver[] = [];
  readonly interactions = supportsEntryType("event");
  readonly shifts = supportsEntryType("layout-shift");

  constructor(private readonly handle: (entry: PerformanceEntry) => void) {}

  start(): void {
    try {
      if (this.interactions)
        this.observe({
          type: "event",
          buffered: true,
          durationThreshold: EVENT_DURATION_THRESHOLD_MS,
        } as PerformanceObserverInit);
      if (this.shifts) this.observe({ type: "layout-shift", buffered: true });
    } catch {
      // A browser that rejects the options measures nothing.
    }
  }

  private observe(options: PerformanceObserverInit): void {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) this.handle(entry);
    });
    observer.observe(options);
    this.observers.push(observer);
  }

  /** Entries already measured but not yet delivered belong to the view that is ending. */
  drain(): void {
    for (const observer of this.observers) {
      for (const entry of observer.takeRecords?.() ?? []) this.handle(entry);
    }
  }

  stop(): void {
    for (const observer of this.observers) observer.disconnect();
    this.observers = [];
  }
}
