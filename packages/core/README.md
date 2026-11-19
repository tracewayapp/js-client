<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/core"><img src="https://img.shields.io/npm/v/@tracewayapp/core.svg" alt="npm"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway JS Core

Shared types and utilities of the Traceway browser and React Native SDKs, plus the platform-independent parts of the 2.x browser SDK: collection settings, triggers, the telemetry buffer and metric aggregation. Zero runtime dependencies, framework-agnostic, safe to import anywhere — browser, Node, React Native, Hermes, Cloudflare Workers.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

> **You probably don't need to install this directly.** It's a transitive dependency of `@tracewayapp/frontend`, `@tracewayapp/react-native`, and the framework wrappers. Install one of those instead. Reach for `@tracewayapp/core` directly only if you're building your own SDK or rendering Traceway's wire types in a dashboard.

## Features

- Type definitions for Traceway's native `/api/report` wire format — exceptions, metrics, traces, spans, sessions, session recordings. The React Native SDK sends it, and the 2.x browser SDK uses it only when it falls back to a server from before OTLP
- Discriminated union for the timeline event types (logs, network, navigation, custom breadcrumbs)
- A bounded rolling `EventBuffer<T>` keyed by time window + max size, used by the React Native SDK to keep the last ~10 seconds of activity
- Connection-string parser, endpoint resolver, UUID v4 and v7 generators, ISO-8601 timestamp helper
- Constants for built-in metric names (`mem.used`, `cpu.used_pcnt`, etc.)
- The 2.x control plane of the browser SDK: the collection settings document and its defaults, overlay and ceilings; the on-device trigger engine and matcher; a byte- and age-bounded `RingBuffer`; exponential histograms and a metric aggregator with an OTLP/HTTP JSON encoder
- Pure ESM + CJS dual output, full TypeScript declarations

## Installation

```bash
npm install @tracewayapp/core
```

## Quick Start

```ts
import {
  parseConnectionString,
  resolveEndpoints,
  nowISO,
  EventBuffer,
  type LogEvent,
} from "@tracewayapp/core";

const { token, apiUrl } = parseConnectionString(
  "your-token@https://traceway.example.com/api/report",
);

// Every endpoint the 2.x browser SDK talks to, with or without the trailing /api/report:
const endpoints = resolveEndpoints(apiUrl);
// endpoints.logs === "https://traceway.example.com/api/otel/v1/logs"

// Rolling buffer that drops entries older than 10s OR beyond 200 entries:
const logs = new EventBuffer<LogEvent>({ windowMs: 10_000, maxSize: 200 });
logs.add({
  type: "log",
  timestamp: nowISO(),
  level: "info",
  message: "user reached checkout",
});

const recent: LogEvent[] = logs.snapshot();
```

The 2.x collection settings start from built-in defaults, take a partial overlay, and are held below the ceilings `init()` set:

```ts
import {
  defaultSettings,
  parseSettingsDocument,
  applyOverlay,
  ceilingsFrom,
  clampToCeilings,
} from "@tracewayapp/core";

const overlay = parseSettingsDocument(
  JSON.stringify({ signals: { console: { mode: "stream", minSeverity: "warn" } } }),
);
const settings = clampToCeilings(
  applyOverlay(defaultSettings(), overlay),
  ceilingsFrom({ captureNetwork: false }),
);
// settings.signals.console.mode === "stream"; settings.signals.network.mode === "off"
```

## Wire Types

These types describe the native `/api/report` protocol. The 2.x browser SDK exports OTLP instead and builds these frames only for its legacy fallback.

### Reporting

| Type | Description |
|------|-------------|
| `ExceptionStackTrace` | Single exception/message record |
| `MetricRecord` | Metric data point (`name`, `value`, `recordedAt`, optional `tags`) |
| `Span` | Sub-operation span within a trace |
| `Trace` | Endpoint or task trace |
| `CollectionFrame` | Batch of stack traces, metrics, traces, session recordings, and sessions |
| `SessionPayload` | Session start or end: `id`, `startedAt`, optional `endedAt` and `attributes` |
| `ReportRequest` | Top-level request payload sent to `/api/report` |
| `TracewayOptions` | Options type of the deprecated `@tracewayapp/backend` SDK |

### Timeline (logs, actions, recordings)

The React Native SDK ships a rolling timeline of logs and action breadcrumbs alongside each captured exception, and so does the 2.x browser SDK when it reports to an older server. (Otherwise the browser SDK sends breadcrumbs as OpenTelemetry log records and spans.) The wire types are defined here so dashboards and custom SDKs can share them.

| Type | Description |
|------|-------------|
| `TracewayEventBase` | Discriminator (`type`) + `timestamp` shared by all timeline events |
| `LogEvent` | Console log: `level` (`debug` / `info` / `warn` / `error`) + `message` |
| `NetworkEvent` | `fetch` / `XHR` request: `method`, `url`, `durationMs`, optional `statusCode`, byte counts, `error` |
| `NavigationEvent` | History API or manual navigation transition: `action` (`push` / `replace` / `pop`), `from`, `to` |
| `CustomEvent` | User-defined breadcrumb from `recordAction(category, name, data?)` |
| `TracewayEvent` | Discriminated union of the four event types above |
| `SessionRecordingPayload` | Replay frames + buffered `logs` + `actions` + `startedAt` / `endedAt` anchors, attached to an exception via `exceptionId` |

## Utilities

| Function | Description |
|----------|-------------|
| `parseConnectionString(str)` | Split `{token}@{apiUrl}` into `{ token, apiUrl }` (`ParsedConnectionString`); throws on malformed input |
| `resolveEndpoints(apiUrl)` | Derive the server base and the OTLP logs, traces and metrics, OpAMP and recordings URLs (`TracewayEndpoints`); accepts the bare server URL and the 1.x form ending in `/api/report` |
| `generateUUID()` | Generate a UUID v4 string |
| `uuidv7()` | Generate a UUID v7 string, used for the browser SDK's instance id |
| `uuidToBytes(uuid)` / `bytesToUuid(bytes)` | Convert between a UUID string and its 16 bytes |
| `unitHash(value)` | Stable hash of a string in `[0, 1)`, for sampling decisions by id |
| `nowISO()` | Current time as ISO 8601 string |
| `msToNanoseconds(ms)` | Convert milliseconds to nanoseconds (integer) |
| `EventBuffer<T>` (`EventBufferOptions`) | Bounded rolling buffer (`windowMs` default 10000, `maxSize` default 200) the React Native SDK uses to keep the most recent logs and actions |

## 2.x Control Plane

The parts of the 2.x browser SDK that do not need a browser. `@tracewayapp/frontend` wires them to OpenTelemetry, OpAMP and rrweb; see its [README](https://www.npmjs.com/package/@tracewayapp/frontend) for what the settings mean to an app.

| Export | Description |
|--------|-------------|
| `Settings`, `CollectionSettings`, `SignalSettings`, `ReplaySettings`, `MetricsSettings`, `BufferSettings`, `Mode`, `SignalName`, `Severity`, `Ceilings` | The collection settings document; `CollectionSettings` is the partial form `init()` and remote rules use |
| `Trigger`, `TriggerStep`, `TriggerAction`, `Matcher`, `Condition`, `ConditionOp`, `SignalSelector`, `Capture` | Triggers, their matchers and actions, and dashboard captures |
| `MODES`, `SIGNALS`, `SEVERITIES` | The allowed modes (`off`, `buffer`, `stream`), signal names and console severities |
| `defaultSettings(options?)` (`DefaultSettingsOptions`) | The built-in settings; `recordAllSessions` and `baselineSampleRate` change them |
| `defaultExceptionTrigger()`, `DEFAULT_EXCEPTION_TRIGGER_ID` | The built-in `default-exception` trigger: 10 minutes of breadcrumbs and a 30-second replay clip with an error |
| `ceilingsFrom(options?)` (`CeilingOptions`) | Ceilings from the `capture*`, `sessions` and `sessionRecording` options |
| `parseSettingsDocument(body)` | Parse a settings document (JSON text or bytes); throws `SettingsError` when it is not a JSON object or has an unsupported `schemaVersion` |
| `applyOverlay(base, overlay)` | Lay a partial document over settings; unknown fields are ignored, malformed known fields skipped |
| `applyLimits(...)`, `clampToCeilings(...)`, `lowerMode(a, b)`, `modeRank(mode)` | Hold modes at or below the plan's limits and the ceilings |
| `parseMatcher(value)` | Parse one trigger matcher; `null` when it is invalid |
| `ControlState` (`StreamOverride`) | The effective settings at any moment: defaults, remote overlay, ceilings, and temporary stream overrides from triggers and captures |
| `TriggerEngine` (`ObservedEvent`, `FiredTrigger`) | Follows multi-step triggers on the device and reports the ones that fire |
| `matches(matcher, lookup)`, `satisfiesVersion(version, constraint)`, `compareVersions(a, b)` (`FieldLookup`) | Evaluate a matcher against an event's fields; version comparison such as `>=2.1 <3` |
| `RingBuffer<T>` (`BufferEntry`, `RingBufferOptions`) | Keeps the newest telemetry within a byte and age budget until a flush takes it out |
| `Histogram`, `HISTOGRAM_SCALE`, `bucketIndex(value)` | Base-2 exponential histogram at one fixed scale, mergeable across devices |
| `MetricAggregator` (`MetricDims`, `MetricBatch`, `HistogramPoint`, `SumPoint`, `MetricExemplar`, `ExemplarSource`, `MetricAggregatorOptions`) | In-memory histograms and counters of one device |
| `encodeMetrics(...)` (`MetricResource`) | Render a metric batch as an OTLP/HTTP JSON request |
| `normalizePath(path)` | Turn a URL path into something close to its route template (`/orders/8841` becomes `/orders/:id`) |

## Constants

| Constant | Value |
|----------|-------|
| `METRIC_MEM_USED` | `"mem.used"` |
| `METRIC_MEM_TOTAL` | `"mem.total"` |
| `METRIC_CPU_USED_PCNT` | `"cpu.used_pcnt"` |

## Platform Support

| Environment | Status |
|---|---|
| Browser (any modern engine) | Yes |
| Node.js ≥ 18 | Yes |
| React Native (Hermes / JSC) | Yes |
| Cloudflare Workers / Deno / Bun | Yes |

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)
- [React Native SDK](https://www.npmjs.com/package/@tracewayapp/react-native)

## License

MIT
