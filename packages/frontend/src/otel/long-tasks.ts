import { SeverityNumber } from "@opentelemetry/api-logs";
import { guarded } from "../guarded.js";
import { EVENT_LONG_TASK } from "./events.js";
import {
  LogInstrumentation,
  epochMs,
  supportsEntryType,
} from "./performance-instrumentation.js";

const LONG_ANIMATION_FRAME = "long-animation-frame";
const LONG_TASK = "longtask";
/** A page that never stops blocking would otherwise fill the buffer with nothing else. */
const MAX_PER_MINUTE = 30;
/** How long a long task waits for the frame entry that would describe it better. */
const FRAME_WAIT_MS = 1000;

interface FrameScript {
  duration: number;
  invoker?: string;
  sourceURL?: string;
  sourceFunctionName?: string;
}

interface LongEntry extends PerformanceEntry {
  blockingDuration?: number;
  scripts?: FrameScript[];
  attribution?: Array<{ containerType?: string; containerSrc?: string }>;
}

/**
 * Main-thread blocks of 50 ms or more, as `browser.long_task` events, one per block.
 *
 * Long animation frames name the script that blocked, so they are preferred. Chromium drops a frame's entry when
 * a history change runs in the same task, which is every route change that renders synchronously, so long tasks
 * are observed too: one that no frame entry covers within a second is reported on its own.
 */
export class LongTaskInstrumentation extends LogInstrumentation {
  private observers: PerformanceObserver[] = [];
  private recent: number[] = [];
  private unmatched: LongEntry[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    super("@tracewayapp/frontend/long-tasks");
  }

  protected attach(): void {
    const frames = supportsEntryType(LONG_ANIMATION_FRAME);
    if (frames)
      this.observe(LONG_ANIMATION_FRAME, (frame) => {
        const end = frame.startTime + frame.duration;
        this.unmatched = this.unmatched.filter(
          (task) =>
            task.startTime + task.duration <= frame.startTime ||
            task.startTime >= end,
        );
        this.report(frame);
      });
    if (supportsEntryType(LONG_TASK))
      this.observe(LONG_TASK, (task) => {
        if (!frames) return this.report(task);
        this.unmatched.push(task);
        this.timer ??= setTimeout(
          () => guarded("long tasks", () => this.reportUnmatched()),
          FRAME_WAIT_MS,
        );
      });
  }

  protected detach(): void {
    for (const observer of this.observers) observer.disconnect();
    this.observers = [];
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.unmatched = [];
  }

  private observe(type: string, handle: (entry: LongEntry) => void): void {
    const observer = new PerformanceObserver((list) =>
      guarded("long tasks", () => {
        for (const entry of list.getEntries()) handle(entry as LongEntry);
      }),
    );
    observer.observe({ type, buffered: true });
    this.observers.push(observer);
  }

  private reportUnmatched(): void {
    this.timer = null;
    const due = performance.now() - FRAME_WAIT_MS;
    const waiting: LongEntry[] = [];
    for (const task of this.unmatched) {
      if (task.startTime + task.duration <= due) this.report(task);
      else waiting.push(task);
    }
    this.unmatched = waiting;
    if (waiting.length)
      this.timer = setTimeout(
        () => guarded("long tasks", () => this.reportUnmatched()),
        FRAME_WAIT_MS,
      );
  }

  private report(entry: LongEntry): void {
    if (!this.enabled) return;
    // Before the cap below, which protects the event buffer: the aggregate counts every block.
    this.sink?.longTask(
      entry.duration,
      typeof entry.blockingDuration === "number"
        ? entry.blockingDuration
        : undefined,
      entry.entryType,
      entry.scripts,
    );
    const now = Date.now();
    this.recent = this.recent.filter((time) => time > now - 60_000);
    if (this.recent.length >= MAX_PER_MINUTE) return;
    this.recent.push(now);

    const attributes: Record<string, string | number> = {
      "browser.long_task.type": entry.entryType,
      "browser.long_task.duration": Math.round(entry.duration),
    };
    if (typeof location !== "undefined") attributes["url.full"] = location.href;
    if (typeof entry.blockingDuration === "number")
      attributes["browser.long_task.blocking_duration"] = Math.round(
        entry.blockingDuration,
      );
    const script = (entry.scripts ?? []).reduce<FrameScript | undefined>(
      (longest, candidate) =>
        !longest || candidate.duration > longest.duration ? candidate : longest,
      undefined,
    );
    if (script) {
      attributes["browser.long_task.script.duration"] = Math.round(
        script.duration,
      );
      if (script.sourceURL)
        attributes["browser.long_task.script.url"] = script.sourceURL;
      if (script.sourceFunctionName)
        attributes["browser.long_task.script.function"] =
          script.sourceFunctionName;
      if (script.invoker)
        attributes["browser.long_task.script.invoker"] = script.invoker;
    }
    const container = entry.attribution?.[0];
    if (container?.containerType)
      attributes["browser.long_task.container.type"] = container.containerType;
    if (container?.containerSrc)
      attributes["browser.long_task.container.src"] = container.containerSrc;

    this.logger?.emit({
      eventName: EVENT_LONG_TASK,
      severityNumber: SeverityNumber.INFO,
      timestamp: epochMs(entry.startTime),
      attributes,
    });
  }
}
