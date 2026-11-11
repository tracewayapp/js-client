/**
 * The collection settings document. The server sends a partial overlay of it
 * over OpAMP (`config_map["traceway"]`); the SDK merges that onto its
 * built-in defaults and clamps the result to the ceilings set in `init()`.
 */

/** `off` drops a signal, `buffer` keeps it on the device until a trigger or capture flushes it, `stream` sends it. */
export type Mode = "off" | "buffer" | "stream";

export const MODES: readonly Mode[] = ["off", "buffer", "stream"];

export const SIGNALS = [
  "errors",
  "messages",
  "network",
  "console",
  "navigation",
  "userActions",
  "webVitals",
  "resourceTiming",
  "custom",
] as const;

export type SignalName = (typeof SIGNALS)[number];

export type Severity = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export const SEVERITIES: readonly Severity[] = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
];

export interface SignalSettings {
  mode: Mode;
  sampleRate: number;
  /** Console only: records below it are dropped. */
  minSeverity?: Severity;
}

export interface ReplaySettings {
  mode: Mode;
  /** Share of sessions whose replay may stream; the rest keep replay buffered. Decided per session id. */
  sessionSampleRate: number;
  maskAllInputs: boolean;
}

export interface BufferSettings {
  maxBytes: number;
  maxAgeSeconds: number;
  replayMaxBytes: number;
  /** Keep the buffer in IndexedDB so it survives reloads and crashes. */
  persist: boolean;
}

export type ConditionOp =
  | "eq"
  | "neq"
  | "in"
  | "not_in"
  | "contains"
  | "icontains"
  | "starts_with"
  | "glob"
  | "exists"
  | "not_exists"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "version";

export interface Condition {
  key: string;
  op: ConditionOp;
  value?: string | number | boolean;
  values?: Array<string | number | boolean>;
}

export type Matcher =
  | Condition
  | { all: Matcher[] }
  | { any: Matcher[] }
  | { not: Matcher };

export type SignalSelector = Array<SignalName | "*">;

export type TriggerAction =
  /** Upload what the buffer holds from the last `lookbackSeconds`. */
  | {
      type: "flush";
      lookbackSeconds: number;
      signals?: SignalSelector;
      replay?: boolean;
    }
  /** Send the selected signals straight away for `durationSeconds` instead of buffering them. */
  | {
      type: "stream";
      durationSeconds: number;
      signals?: SignalSelector;
      replay?: boolean;
    }
  /** Record and stream session replay for `durationSeconds`. */
  | { type: "startReplay"; durationSeconds: number }
  /** Emit a marker event, so the dashboard can count how often this happens. */
  | { type: "emit"; eventName: string; attributes?: Record<string, string> }
  /**
   * A capture started on the device: upload the last `lookbackSeconds`, then stream the selected signals (and
   * replay) for `durationSeconds`. Unlike `stream` it survives page loads and is reported as a capture.
   */
  | {
      type: "capture";
      durationSeconds: number;
      lookbackSeconds?: number;
      signals?: SignalSelector;
      replay?: boolean;
    };

export interface TriggerStep {
  match: Matcher;
  /** Longest gap allowed since the previous step; null or absent means no limit. */
  withinSeconds?: number | null;
  /** Matching records needed before the step completes, e.g. 5 error lines. Default 1. */
  count?: number;
  /** With `count`: all of them within this many seconds of each other (a sliding window). */
  periodSeconds?: number | null;
}

export interface Trigger {
  id: string;
  name?: string;
  enabled?: boolean;
  sampleRate?: number;
  cooldownSeconds?: number;
  maxPerSession?: number;
  steps: TriggerStep[];
  actions: TriggerAction[];
}

/** An on-demand capture requested from the dashboard; only the server creates these. */
export interface Capture {
  id: string;
  until: string;
  lookbackSeconds?: number;
  signals?: SignalSelector;
  replay?: boolean;
}

export interface Settings {
  schemaVersion: 1;
  /** Kill switch: when false nothing but the OpAMP poll leaves the device. */
  enabled: boolean;
  signals: Record<SignalName, SignalSettings>;
  sessions: { enabled: boolean; baselineSampleRate: number };
  replay: ReplaySettings;
  buffer: BufferSettings;
  triggers: Trigger[];
  captures: Capture[];
}

/** The most a signal may do on this page, set from the `init()` options. Remote settings can only go lower. */
export interface Ceilings {
  enabled: boolean;
  signals: Record<SignalName, Mode>;
  replay: Mode;
  sessions: boolean;
}
