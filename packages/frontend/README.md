# @tracewayapp/frontend

Traceway SDK for browser environments. Captures exceptions and messages with automatic batching and retry.

## Installation

```bash
npm install @tracewayapp/frontend
```

## Quick Start

```typescript
import { init, captureException, captureMessage, flush } from "@tracewayapp/frontend";

// Initialize once at app startup
init("your-token@https://traceway.example.com/api/report");

// Capture errors
try {
  riskyOperation();
} catch (error) {
  captureException(error);
}

// Capture custom messages
captureMessage("User completed checkout");

// Force-send all pending exceptions
await flush();
```

`init()` automatically installs `window.onerror` and `window.onunhandledrejection` handlers to capture uncaught errors.

## API

| Function | Description |
|----------|-------------|
| `init(connectionString, options?)` | Initialize the SDK and install global error handlers |
| `captureException(error)` | Capture an error with browser stack trace |
| `captureExceptionWithAttributes(error, attributes?)` | Capture with key-value attributes |
| `captureMessage(msg)` | Capture an informational message |
| `flush()` | Force-send all pending exceptions immediately |

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debug` | `boolean` | `false` | Enable debug logging |
| `debounceMs` | `number` | `1500` | Debounce interval before sending |
| `version` | `string` | `""` | Application version |

## Requirements

- `fetch` API
- `CompressionStream` API (gzip) — Chrome 80+, Firefox 113+, Safari 16.4+
