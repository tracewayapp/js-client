# @tracewayapp/core

Shared types and utilities for all Traceway JavaScript SDKs. Zero runtime dependencies.

## Installation

```bash
npm install @tracewayapp/core
```

## Types

| Type | Description |
|------|-------------|
| `ExceptionStackTrace` | Exception/message record matching the Traceway protocol |
| `MetricRecord` | Metric data point (`name`, `value`, `recordedAt`) |
| `Span` | Sub-operation span within a trace |
| `Trace` | Endpoint or task trace |
| `CollectionFrame` | Batch of stack traces, metrics, and traces |
| `ReportRequest` | Top-level request payload sent to `/api/report` |
| `TracewayOptions` | Configuration options for SDK initialization |

## Utilities

| Function | Description |
|----------|-------------|
| `generateUUID()` | Generate a UUID v4 string |
| `parseConnectionString(str)` | Split `{token}@{apiUrl}` into `{ token, apiUrl }` |
| `nowISO()` | Current time as ISO 8601 string |
| `msToNanoseconds(ms)` | Convert milliseconds to nanoseconds (integer) |

## Constants

| Constant | Value |
|----------|-------|
| `METRIC_MEM_USED` | `"mem.used"` |
| `METRIC_MEM_TOTAL` | `"mem.total"` |
| `METRIC_CPU_USED_PCNT` | `"cpu.used_pcnt"` |
