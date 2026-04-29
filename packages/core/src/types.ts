export interface ExceptionStackTrace {
  traceId: string | null;
  isTask?: boolean;
  stackTrace: string;
  recordedAt: string;
  attributes?: Record<string, string>;
  isMessage: boolean;
  sessionRecordingId?: string | null;
  distributedTraceId?: string | null;
}

export interface MetricRecord {
  name: string;
  value: number;
  recordedAt: string;
  tags?: Record<string, string>;
}

export interface Span {
  id: string;
  name: string;
  startTime: string;
  duration: number;
}

export interface Trace {
  id: string;
  endpoint: string;
  duration: number;
  recordedAt: string;
  statusCode: number;
  bodySize: number;
  clientIP: string;
  attributes?: Record<string, string>;
  spans?: Span[];
  isTask?: boolean;
  distributedTraceId?: string;
}

export interface CollectionFrame {
  stackTraces: ExceptionStackTrace[];
  metrics: MetricRecord[];
  traces: Trace[];
  sessionRecordings?: SessionRecordingPayload[];
}

export interface SessionRecordingPayload {
  exceptionId: string;
  /** Replay frames (rrweb events on the web, MP4 chunks on native). */
  events: unknown[];
  /**
   * ISO 8601 timestamp of the first frame / first event in this recording.
   * Combined with [endedAt] this lets the backend align logs and actions
   * (which carry their own absolute timestamps) onto the video timeline:
   * `offsetIntoVideoMs = event.timestamp - recording.startedAt`.
   */
  startedAt?: string;
  /** ISO 8601 timestamp of the last frame / last event in this recording. */
  endedAt?: string;
  /** Last ~10s of console output. Capped at 200 entries by the SDK. */
  logs?: LogEvent[];
  /** Last ~10s of network/navigation/custom actions. Capped at 200 entries by the SDK. */
  actions?: TracewayEvent[];
}

export interface ReportRequest {
  collectionFrames: CollectionFrame[];
  appVersion: string;
  serverName: string;
}

export interface TracewayOptions {
  debug?: boolean;
  maxCollectionFrames?: number;
  collectionInterval?: number;
  uploadThrottle?: number;
  metricsInterval?: number;
  version?: string;
  serverName?: string;
  sampleRate?: number;
  errorSampleRate?: number;
}

// ── Timeline events ─────────────────────────────────────────────────────────
//
// These mirror the Flutter SDK's wire format. Each event has a `type`
// discriminator and a `timestamp`; subtypes add their own fields.

export interface TracewayEventBase {
  type: "log" | "network" | "navigation" | "custom";
  timestamp: string;
}

export interface LogEvent extends TracewayEventBase {
  type: "log";
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

export interface NetworkEvent extends TracewayEventBase {
  type: "network";
  method: string;
  url: string;
  durationMs: number;
  statusCode?: number;
  requestBytes?: number;
  responseBytes?: number;
  error?: string;
}

export interface NavigationEvent extends TracewayEventBase {
  type: "navigation";
  /** "push" | "replace" | "pop" — pop covers back/forward. */
  action: string;
  from?: string;
  to?: string;
}

export interface CustomEvent extends TracewayEventBase {
  type: "custom";
  category: string;
  name: string;
  data?: Record<string, unknown>;
}

export type TracewayEvent =
  | LogEvent
  | NetworkEvent
  | NavigationEvent
  | CustomEvent;
