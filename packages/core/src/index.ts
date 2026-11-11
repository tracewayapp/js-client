export type {
  ExceptionStackTrace,
  MetricRecord,
  Span,
  Trace,
  CollectionFrame,
  SessionPayload,
  SessionRecordingPayload,
  ReportRequest,
  TracewayOptions,
  TracewayEvent,
  TracewayEventBase,
  LogEvent,
  NetworkEvent,
  NavigationEvent,
  CustomEvent,
} from "./types.js";

export {
  generateUUID,
  parseConnectionString,
  nowISO,
  msToNanoseconds,
} from "./utils.js";
export type { ParsedConnectionString } from "./utils.js";

export {
  METRIC_MEM_USED,
  METRIC_MEM_TOTAL,
  METRIC_CPU_USED_PCNT,
} from "./constants.js";

export { EventBuffer } from "./event-buffer.js";
export type { EventBufferOptions } from "./event-buffer.js";

// ── v2: OpenTelemetry SDK control plane ─────────────────────────────────────
// The 1.x wire types above stay exported for the React Native SDK, which
// still speaks the native /api/report protocol.

export { resolveEndpoints } from "./connection.js";
export type { TracewayEndpoints } from "./connection.js";
export { uuidv7, unitHash, bytesToUuid, uuidToBytes } from "./ids.js";

export type {
  Mode,
  SignalName,
  Severity,
  SignalSettings,
  ReplaySettings,
  BufferSettings,
  Condition,
  ConditionOp,
  Matcher,
  SignalSelector,
  TriggerAction,
  TriggerStep,
  Trigger,
  Capture,
  Settings,
  Ceilings,
} from "./settings/types.js";
export { MODES, SIGNALS, SEVERITIES } from "./settings/types.js";
export {
  defaultSettings,
  defaultExceptionTrigger,
  ceilingsFrom,
  DEFAULT_EXCEPTION_TRIGGER_ID,
} from "./settings/defaults.js";
export type { DefaultSettingsOptions, CeilingOptions } from "./settings/defaults.js";
export {
  SettingsError,
  parseSettingsDocument,
  parseMatcher,
  applyOverlay,
  applyLimits,
  clampToCeilings,
  lowerMode,
  modeRank,
} from "./settings/merge.js";

export { ControlState } from "./control/control-state.js";
export type { StreamOverride } from "./control/control-state.js";
export { matches, satisfiesVersion, compareVersions } from "./triggers/matcher.js";
export type { FieldLookup } from "./triggers/matcher.js";
export { TriggerEngine } from "./triggers/engine.js";
export type { ObservedEvent, FiredTrigger } from "./triggers/engine.js";
export { RingBuffer } from "./buffer/ring-buffer.js";
export type { BufferEntry, RingBufferOptions } from "./buffer/ring-buffer.js";
