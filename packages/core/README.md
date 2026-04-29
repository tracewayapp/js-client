# @tracewayapp/core

Shared types and utilities for all Traceway JavaScript SDKs. Zero runtime dependencies.

## Installation

```bash
npm install @tracewayapp/core
```

## Types

### Reporting

| Type | Description |
|------|-------------|
| `ExceptionStackTrace` | Exception/message record matching the Traceway protocol |
| `MetricRecord` | Metric data point (`name`, `value`, `recordedAt`, optional `tags`) |
| `Span` | Sub-operation span within a trace |
| `Trace` | Endpoint or task trace |
| `CollectionFrame` | Batch of stack traces, metrics, traces, and session recordings |
| `ReportRequest` | Top-level request payload sent to `/api/report` |
| `TracewayOptions` | Configuration options for SDK initialization |

### Logs, Actions, and Session Recordings

The frontend SDK ships a rolling timeline of logs and action breadcrumbs alongside each captured exception, plus an rrweb-based session replay. The wire types are defined here so other packages and dashboards can share them.

| Type | Description |
|------|-------------|
| `TracewayEventBase` | Discriminator (`type`) + `timestamp` shared by all timeline events |
| `LogEvent` | Console log entry: `level` (`debug` / `info` / `warn` / `error`) + `message` |
| `NetworkEvent` | `fetch` / `XHR` request: `method`, `url`, `durationMs`, optional `statusCode`, byte counts, `error` |
| `NavigationEvent` | History API transition: `action` (`push` / `replace` / `pop`), `from`, `to` |
| `CustomEvent` | User-defined breadcrumb from `recordAction(category, name, data?)` |
| `TracewayEvent` | Discriminated union of the four event types above |
| `SessionRecordingPayload` | Replay frames + buffered `logs` + `actions` + `startedAt` / `endedAt` anchors, attached to an exception via `exceptionId` |

## Utilities

| Function | Description |
|----------|-------------|
| `generateUUID()` | Generate a UUID v4 string |
| `parseConnectionString(str)` | Split `{token}@{apiUrl}` into `{ token, apiUrl }` |
| `nowISO()` | Current time as ISO 8601 string |
| `msToNanoseconds(ms)` | Convert milliseconds to nanoseconds (integer) |
| `EventBuffer<T>` | Bounded rolling buffer (`windowMs`, `maxSize`) used by the frontend SDK to keep the most recent logs and actions |

## Constants

| Constant | Value |
|----------|-------|
| `METRIC_MEM_USED` | `"mem.used"` |
| `METRIC_MEM_TOTAL` | `"mem.total"` |
| `METRIC_CPU_USED_PCNT` | `"cpu.used_pcnt"` |
