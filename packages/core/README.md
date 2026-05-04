<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/core"><img src="https://img.shields.io/npm/v/@tracewayapp/core.svg" alt="npm"></a>
  <a href="https://github.com/tracewayapp/traceway-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway JS Core

Shared types and utilities consumed by every Traceway JavaScript SDK. Zero runtime dependencies, framework-agnostic, safe to import anywhere — browser, Node, React Native, Hermes, Cloudflare Workers.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

> **You probably don't need to install this directly.** It's a transitive dependency of `@tracewayapp/frontend`, `@tracewayapp/react-native`, and the framework wrappers. Install one of those instead. Reach for `@tracewayapp/core` directly only if you're building your own SDK or rendering Traceway's wire types in a dashboard.

## Features

- Type definitions for the full Traceway wire format — exceptions, metrics, traces, spans, session recordings
- Discriminated union for the timeline event types (logs, network, navigation, custom breadcrumbs)
- A bounded rolling `EventBuffer<T>` keyed by time window + max size, used by every higher-level SDK to capture the last ~10 seconds of activity
- Connection-string parser, UUID v4 generator, ISO-8601 timestamp helper
- Constants for built-in metric names (`mem.used`, `cpu.used_pcnt`, etc.)
- Pure ESM + CJS dual output, full TypeScript declarations

## Installation

```bash
npm install @tracewayapp/core
```

## Quick Start

```ts
import {
  parseConnectionString,
  generateUUID,
  nowISO,
  EventBuffer,
  type LogEvent,
  type ReportRequest,
} from "@tracewayapp/core";

const { token, apiUrl } = parseConnectionString(
  "your-token@https://traceway.example.com/api/report",
);

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

## Wire Types

### Reporting

| Type | Description |
|------|-------------|
| `ExceptionStackTrace` | Single exception/message record |
| `MetricRecord` | Metric data point (`name`, `value`, `recordedAt`, optional `tags`) |
| `Span` | Sub-operation span within a trace |
| `Trace` | Endpoint or task trace |
| `CollectionFrame` | Batch of stack traces, metrics, traces, and session recordings |
| `ReportRequest` | Top-level request payload sent to `/api/report` |

### Timeline (logs, actions, recordings)

The browser, RN, and framework SDKs ship a rolling timeline of logs and action breadcrumbs alongside each captured exception. The wire types are defined here so dashboards and custom SDKs can share them.

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
| `parseConnectionString(str)` | Split `{token}@{apiUrl}` into `{ token, apiUrl }`; throws on malformed input |
| `generateUUID()` | Generate a UUID v4 string |
| `nowISO()` | Current time as ISO 8601 string |
| `msToNanoseconds(ms)` | Convert milliseconds to nanoseconds (integer) |
| `EventBuffer<T>` | Bounded rolling buffer (`windowMs`, `maxSize`) used by the higher-level SDKs to keep the most recent logs and actions |

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
