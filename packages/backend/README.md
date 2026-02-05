# @tracewayapp/backend

Traceway SDK for Node.js backends. Core telemetry collection library.

## Quick Start

```ts
import * as traceway from "@tracewayapp/backend";

traceway.init("your-token@https://your-traceway-server.com/api/report", {
  version: "1.0.0",
  debug: true,
});

// Capture an error
traceway.captureException(new Error("something broke"));

// Capture a message
traceway.captureMessage("Deployment completed");

// Capture a custom metric
traceway.captureMetric("queue.length", 42);

// Graceful shutdown
await traceway.shutdown();
```

## Architecture

### Two Modes of Operation

The SDK supports both **manual** and **automatic** context propagation:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Your Application                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  ┌─────────────────────────────────────────────────────────────┐    │
│  │                   AsyncLocalStorage                          │    │
│  │  ┌─────────────────────────────────────────────────────┐    │    │
│  │  │ TraceContext (per request/task)                      │    │    │
│  │  │  - traceId: string                                   │    │    │
│  │  │  - spans: Span[]                                     │    │    │
│  │  │  - attributes: Record<string, string>                │    │    │
│  │  │  - startedAt: Date                                   │    │    │
│  │  │  - statusCode, bodySize, clientIP, endpoint          │    │    │
│  │  └─────────────────────────────────────────────────────┘    │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                              │                                       │
│    withTraceContext() ───────┘                                       │
│                                                                      │
│  captureException() ──────► auto-detects context ──────┐            │
│  captureMessage() ────────► auto-detects context ──────┤            │
│  endSpan() ───────────────► auto-adds to context ──────┤            │
│  captureCurrentTrace() ───► reads from context ────────┤            │
│                                                        ▼            │
│                                            ┌────────────────────┐   │
│                                            │ CollectionFrameStore│   │
│                                            │ (global singleton)  │   │
│                                            └────────────────────┘   │
│                                                        │            │
│                                               gzip + POST           │
│                                                        ▼            │
│                                                  Traceway API       │
└─────────────────────────────────────────────────────────────────────┘
```

### Automatic Context Propagation (Recommended)

The SDK uses Node.js `AsyncLocalStorage` to automatically propagate trace context through async operations:

```ts
import * as traceway from "@tracewayapp/backend";

traceway.init("token@https://api.traceway.io/api/report");

// Wrap your request handler
app.get("/api/users", (req, res) => {
  traceway.withTraceContext(
    { endpoint: `${req.method} ${req.path}`, clientIP: req.ip },
    async () => {
      // All operations inside automatically belong to this trace

      const span = traceway.startSpan("db-query");
      const users = await db.query("SELECT * FROM users");
      traceway.endSpan(span); // Auto-added to trace context

      // Exceptions auto-link to trace
      if (!users.length) {
        traceway.captureMessage("No users found");
      }

      res.json(users);

      // Capture the trace at the end
      traceway.setTraceResponseInfo(200, JSON.stringify(users).length);
      traceway.captureCurrentTrace();
    }
  );
});
```

### Context API

| Function | Description |
|----------|-------------|
| `withTraceContext(options, fn)` | Run function within a new trace context |
| `getTraceContext()` | Get current context (or undefined) |
| `getTraceId()` | Get current trace ID (or undefined) |
| `hasTraceContext()` | Check if inside a trace context |
| `setTraceAttribute(key, value)` | Set attribute on current trace |
| `setTraceAttributes(attrs)` | Set multiple attributes |
| `setTraceResponseInfo(status, size?)` | Set HTTP response info |
| `addSpanToContext(span)` | Manually add a span |
| `getTraceSpans()` | Get all spans in current trace |
| `getTraceDuration()` | Get elapsed time in ms |
| `forkTraceContext(fn)` | Fork context for parallel ops |
| `captureCurrentTrace()` | Capture trace from context |

### Building Framework Middleware

The context API makes it easy to build framework-specific middleware:

```ts
// Express middleware
import * as traceway from "@tracewayapp/backend";

export function tracewayMiddleware() {
  return (req, res, next) => {
    traceway.withTraceContext(
      {
        endpoint: `${req.method} ${req.path}`,
        clientIP: req.ip,
        attributes: { userAgent: req.get("User-Agent") || "" },
      },
      () => {
        // Intercept response to capture trace
        const originalEnd = res.end;
        res.end = function (...args) {
          traceway.setTraceResponseInfo(
            res.statusCode,
            res.get("Content-Length") ? parseInt(res.get("Content-Length")) : 0
          );
          traceway.captureCurrentTrace();
          return originalEnd.apply(this, args);
        };

        next();
      }
    );
  };
}

// Usage
app.use(tracewayMiddleware());
app.get("/api/users", async (req, res) => {
  // Context is already set up - just use the SDK
  const span = traceway.startSpan("fetch-users");
  try {
    const users = await getUsers();
    traceway.endSpan(span);
    res.json(users);
  } catch (err) {
    traceway.endSpan(span);
    traceway.captureException(err); // Auto-linked to request trace
    res.status(500).json({ error: "Internal error" });
  }
});
```

```ts
// Fastify plugin
import * as traceway from "@tracewayapp/backend";

export const tracewayPlugin = (fastify, opts, done) => {
  fastify.addHook("onRequest", (request, reply, done) => {
    traceway.withTraceContext(
      {
        endpoint: `${request.method} ${request.url}`,
        clientIP: request.ip,
      },
      () => done()
    );
  });

  fastify.addHook("onResponse", (request, reply, done) => {
    traceway.setTraceResponseInfo(reply.statusCode);
    traceway.captureCurrentTrace();
    done();
  });

  done();
};
```

### Manual Mode (Legacy)

You can still use explicit parameter passing if preferred:

```ts
import * as traceway from "@tracewayapp/backend";
import { generateUUID } from "@tracewayapp/core";

const traceId = generateUUID();
const spans: Span[] = [];

const span = traceway.startSpan("operation");
// ... do work ...
spans.push(traceway.endSpan(span, false)); // false = don't auto-add to context

traceway.captureTrace(traceId, "GET /api", 150, new Date(), 200, 1024, "127.0.0.1", {}, spans);
traceway.captureExceptionWithAttributes(err, {}, traceId);
```

## Public API

### Core Functions

| Function | Description |
|----------|-------------|
| `init(connectionString, options?)` | Initialize the SDK (throws if already initialized) |
| `shutdown()` | Stop timers, flush remaining data, and await final upload |

### Capture Functions

| Function | Description |
|----------|-------------|
| `captureException(error)` | Capture error (auto-detects trace context) |
| `captureExceptionWithAttributes(error, attrs?, traceId?)` | Capture with explicit context |
| `captureMessage(msg, attrs?)` | Capture message (auto-detects trace context) |
| `captureMetric(name, value)` | Capture a custom metric |
| `captureTrace(...)` | Capture HTTP trace (manual mode) |
| `captureTask(...)` | Capture background task (manual mode) |
| `captureCurrentTrace()` | Capture trace from current context |

### Span Functions

| Function | Description |
|----------|-------------|
| `startSpan(name)` | Start a span (returns `SpanHandle`) |
| `endSpan(span, addToContext?)` | End span (auto-adds to context by default) |

### Utility Functions

| Function | Description |
|----------|-------------|
| `shouldSample(isError)` | Check if trace should be recorded |
| `measureTask(title, fn)` | Execute function as auto-captured task |

### Span Handle vs Span Object

`startSpan()` returns a **span handle** for tracking:
```ts
interface SpanHandle {
  id: string;        // UUID
  name: string;      // Operation name
  startTime: string; // ISO timestamp
  startedAt: number; // Unix ms (for duration calc)
}
```

`endSpan()` returns a **Span object** for the trace:
```ts
interface Span {
  id: string;        // Same UUID
  name: string;      // Operation name
  startTime: string; // ISO timestamp
  duration: number;  // Nanoseconds
}
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debug` | `boolean` | `false` | Enable debug logging to console |
| `maxCollectionFrames` | `number` | `12` | Ring buffer capacity for pending frames |
| `collectionInterval` | `number` | `5000` | Frame rotation interval (ms) |
| `uploadThrottle` | `number` | `2000` | Minimum gap between uploads (ms) |
| `metricsInterval` | `number` | `30000` | System metrics collection interval (ms) |
| `version` | `string` | `""` | Application version sent with reports |
| `serverName` | `string` | hostname | Server identifier sent with reports |
| `sampleRate` | `number` | `1.0` | Normal trace sampling rate (0.0-1.0) |
| `errorSampleRate` | `number` | `1.0` | Error trace sampling rate (0.0-1.0) |

## Collection Frame Lifecycle

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. COLLECT                                                        │
│    captureException/Trace/Metric ──► Current CollectionFrame     │
│                                                                   │
│ 2. ROTATE (every collectionInterval ms)                          │
│    Current frame ──► Send Queue (ring buffer, max 12 frames)     │
│                                                                   │
│ 3. UPLOAD (respects uploadThrottle)                              │
│    Send Queue ──► gzip ──► POST /api/report                      │
│    Headers: Authorization: Bearer {token}                        │
│             Content-Type: application/json                        │
│             Content-Encoding: gzip                                │
│                                                                   │
│ 4. CLEANUP                                                        │
│    200 OK ──► Remove frames from queue                           │
│    Failure ──► Retain frames for retry                           │
│                                                                   │
│ 5. SHUTDOWN                                                       │
│    shutdown() ──► Rotate current ──► Upload all ──► Stop timers  │
└──────────────────────────────────────────────────────────────────┘
```

## Auto-Collected Metrics

Every `metricsInterval` ms (default: 30s), these metrics are automatically captured:

| Name | Description | Unit |
|------|-------------|------|
| `mem.used` | Process RSS memory | MB |
| `mem.total` | Total system memory | MB |
| `cpu.used_pcnt` | CPU usage (delta-based) | % (0-100) |

## Sampling

Use sampling to reduce data volume in high-traffic applications:

```ts
traceway.init(connectionString, {
  sampleRate: 0.1,      // Record 10% of normal traces
  errorSampleRate: 1.0, // Record 100% of error traces
});

// In your code, check before capturing:
if (traceway.shouldSample(isError)) {
  traceway.captureTrace(...);
}
```

The `measureTask()` function automatically respects sampling rates.

## Comparison with Go Client

| Go Client Feature | JS Backend Equivalent |
|-------------------|----------------------|
| `Init(connectionString, opts...)` | `init(connectionString, options)` |
| `StartTrace(ctx) context.Context` | `withTraceContext(options, fn)` |
| `GetTraceFromContext(ctx)` | `getTraceContext()` |
| `GetTraceIdFromContext(ctx)` | `getTraceId()` |
| `GetAttributesFromContext(ctx)` | `getTraceContext()?.attributes` |
| `WithAttributes(ctx, fn)` | `setTraceAttribute()` / `setTraceAttributes()` |
| `StartSpan(ctx, name)` | `startSpan(name)` (auto-adds on `endSpan()`) |
| `CaptureException(err)` | `captureException(err)` (auto-detects context) |
| `CaptureExceptionWithContext(ctx, err)` | `captureException(err)` inside `withTraceContext()` |
| `CaptureTrace(tc, ...)` | `captureCurrentTrace()` or `captureTrace(...)` |
| `CaptureTask(tc, ...)` | `captureCurrentTrace()` with `isTask: true` |
| `MeasureTask(title, fn)` | `measureTask(title, fn)` |
| `Recover()` / `RecoverWithContext(ctx)` | Use try/catch with `captureException()` |
| `tracewayhttp.New(...)` | Build with `withTraceContext()` (see examples) |
| `tracewaygin.New(...)` | Build with `withTraceContext()` (see examples) |
| `tracewaydb.NewTwDB(...)` | Wrap DB calls with `startSpan()`/`endSpan()` |

## Thread Safety

The SDK is designed for concurrent use in Node.js:
- `AsyncLocalStorage` provides request isolation automatically
- `CollectionFrameStore` uses synchronous operations (Node.js event loop)
- Timer callbacks are non-blocking via `unref()`
- `shutdown()` is async and awaits the final upload
- Parallel requests each get their own isolated trace context
