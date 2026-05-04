<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/backend"><img src="https://img.shields.io/npm/v/@tracewayapp/backend.svg" alt="npm"></a>
  <a href="https://github.com/tracewayapp/traceway-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway Node.js SDK

> **Deprecated.** For new Node.js / Express / Fastify integrations, use [OpenTelemetry](https://opentelemetry.io/) instead — see the [Node.js OTel guide](https://docs.tracewayapp.com/client/node-sdk) and the [OTel overview](https://docs.tracewayapp.com/client/otel). This package will keep receiving security fixes but is no longer the recommended path for new code.

Error tracking, distributed tracing, span management, and metrics collection for Node.js backends.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

## Features

- Automatic capture of unhandled exceptions
- Distributed tracing — `withTraceContext`, `startSpan`, `endSpan` API for HTTP requests and background tasks
- AsyncLocalStorage-based context that carries trace info across `await` boundaries
- Metric collection — built-in process metrics (`mem.used`, `cpu.used_pcnt`) plus user-defined metrics with optional tags
- Sampling for normal vs. error traces, configurable independently
- Gzip-compressed batched transport, retry on failure
- Graceful `shutdown()` that flushes in-flight data before the process exits

## Installation

```bash
npm install @tracewayapp/backend
```

## Quick Start

```ts
import {
  init,
  captureException,
  withTraceContext,
  startSpan,
  endSpan,
  captureCurrentTrace,
  shutdown,
} from "@tracewayapp/backend";

// Initialize once at startup
init("your-token@https://traceway.example.com/api/report", {
  version: "1.0.0",
  serverName: "api-1",
});

// Wrap each HTTP request in a trace context:
async function handleRequest(req, res) {
  await withTraceContext(
    {
      endpoint: `${req.method} ${req.path}`,
      clientIP: req.ip,
    },
    async () => {
      try {
        const dbSpan = startSpan("database-query");
        const users = await db.query("SELECT * FROM users");
        endSpan(dbSpan);

        res.json(users);
      } catch (error) {
        captureException(error);
        res.status(500).json({ error: "Internal error" });
      } finally {
        captureCurrentTrace();
      }
    },
  );
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});
```

## Manual Capture

```ts
import {
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  captureMetric,
  captureMetricWithTags,
} from "@tracewayapp/backend";

// Capture an error (auto-detects in-flight trace context)
captureException(error);

// Capture an error with explicit attributes and trace id
captureExceptionWithAttributes(error, { tenant: "acme" }, traceId);

// Capture a message
captureMessage("startup completed");

// Capture metrics
captureMetric("request.duration", 150);
captureMetricWithTags("request.duration", 150, {
  region: "us-east",
  service: "users",
});
```

## API

### Core

| Function | Description |
|----------|-------------|
| `init(connectionString, options?)` | Initialize the SDK |
| `shutdown()` | Stop timers, flush remaining data, await final upload |

### Capture

| Function | Description |
|----------|-------------|
| `captureException(error)` | Capture error (auto-detects trace context) |
| `captureExceptionWithAttributes(error, attrs?, traceId?)` | Capture with explicit context |
| `captureMessage(msg, attrs?)` | Capture message (auto-detects trace context) |
| `captureMetric(name, value)` | Capture a custom metric |
| `captureMetricWithTags(name, value, tags)` | Capture a metric with key-value tags |
| `captureTrace(...)` | Capture HTTP trace (manual mode) |
| `captureTask(...)` | Capture background task (manual mode) |
| `captureCurrentTrace()` | Capture trace from current context |

### Spans

| Function | Description |
|----------|-------------|
| `startSpan(name)` | Start a span (returns `SpanHandle`) |
| `endSpan(span, addToContext?)` | End span (auto-adds to context by default) |

### Trace Context

| Function | Description |
|----------|-------------|
| `withTraceContext(options, fn)` | Run function within a new trace context |
| `runWithTraceContext(options, fn)` | Run function within a new trace context (alternative) |
| `getTraceContext()` | Get current context (or `undefined`) |
| `getTraceId()` | Get current trace ID (or `undefined`) |
| `hasTraceContext()` | Check if inside a trace context |
| `setTraceAttribute(key, value)` | Set attribute on current trace |
| `setTraceAttributes(attrs)` | Set multiple attributes |
| `setTraceResponseInfo(status, size?)` | Set HTTP response info |
| `addSpanToContext(span)` | Manually add a span |
| `getTraceSpans()` | Get all spans in current trace |
| `getTraceDuration()` | Get elapsed time in ms |
| `forkTraceContext(fn)` | Fork context for parallel ops |

### Utilities

| Function | Description |
|----------|-------------|
| `shouldSample(isError)` | Check if trace should be recorded |
| `measureTask(title, fn)` | Execute function as auto-captured task |

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `debug` | `false` | Enable debug logging to console |
| `version` | `""` | App version string sent with reports |
| `serverName` | hostname | Server identifier sent with reports |
| `maxCollectionFrames` | `12` | Ring buffer capacity for pending frames |
| `collectionInterval` | `5000` | Frame rotation interval (ms) |
| `uploadThrottle` | `2000` | Minimum gap between uploads (ms) |
| `metricsInterval` | `30000` | System metrics collection interval (ms) |
| `sampleRate` | `1.0` | Normal trace sampling rate (0.0-1.0) |
| `errorSampleRate` | `1.0` | Error trace sampling rate (0.0-1.0) |

## Platform Support

| Environment | Error Tracking | Distributed Tracing | Metrics |
|---|---|---|---|
| Node.js ≥ 18 | Yes | Yes | Yes |
| Bun | Yes | Yes | Yes |
| Deno | Partial — bring your own AsyncLocalStorage shim | Partial | Yes |
| Cloudflare Workers / Edge runtimes | No — use OTel instead | No | No |

## Migration to OpenTelemetry

For new code, prefer OTel — it has wider ecosystem support, more instrumentation, and is what the Traceway dashboard treats as a first-class citizen. The Traceway backend ingests OTLP/HTTP traces, metrics, and logs at `/api/otel/v1/{traces,metrics,logs}`. See:

- [Node.js OTel guide](https://docs.tracewayapp.com/client/node-sdk)
- [NestJS OTel guide](https://docs.tracewayapp.com/client/nestjs)
- [OTel overview](https://docs.tracewayapp.com/client/otel)

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [OpenTelemetry](https://opentelemetry.io/)

## License

MIT
