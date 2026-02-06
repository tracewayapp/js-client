# @tracewayapp/backend

Traceway SDK for Node.js backends. Provides error tracking, distributed tracing, span management, and metrics collection.

## Installation

```bash
npm install @tracewayapp/backend
```

## Quick Start

```typescript
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
init("your-token@https://traceway.example.com/api/report");

// Use trace context for HTTP requests
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
    }
  );
}

// Graceful shutdown
process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});
```

## API

### Core Functions

| Function | Description |
|----------|-------------|
| `init(connectionString, options?)` | Initialize the SDK |
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

### Context API

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

### Utility Functions

| Function | Description |
|----------|-------------|
| `shouldSample(isError)` | Check if trace should be recorded |
| `measureTask(title, fn)` | Execute function as auto-captured task |

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

## Requirements

- Node.js >= 18
