# @tracewayapp/frontend

Traceway SDK for browser environments. Reports exceptions and messages only (no traces or metrics).

## Quick Start

```ts
import * as traceway from "@tracewayapp/frontend";

traceway.init("your-token@https://your-traceway-server.com/api/report");

// Capture an error
traceway.captureException(new Error("something broke"));

// Capture a message
traceway.captureMessage("User completed onboarding");

// Flush pending exceptions immediately
await traceway.flush();
```

## API

| Function | Description |
|----------|-------------|
| `init(connectionString, options?)` | Initialize the SDK and install global error handlers |
| `captureException(error)` | Capture an error with browser stack trace |
| `captureExceptionWithAttributes(error, attributes?)` | Capture with key-value attributes |
| `captureMessage(msg)` | Capture an informational message |
| `flush()` | Force-send all pending exceptions immediately |

## Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debug` | `boolean` | `false` | Enable debug logging |
| `debounceMs` | `number` | `1500` | Debounce interval before sending |
| `version` | `string` | `""` | Application version |

## Sync Queue Behavior

```
captureException()
    |
    v
pendingExceptions[]  -->  scheduleSync() (1.5s debounce)
                              |
                              v  (debounce fires)
                          doSync()
                              |
                    +---------+---------+
                    |                   |
              isSyncing?            send batch
                    |                   |
                  return          +-----+-----+
                              success     failure
                                |           |
                              done    re-queue batch
                                           |
                                    if pending > 0
                                           |
                                    doSync() again
```

- Only one sync at a time (no concurrent fetches)
- New exceptions during an in-flight request are queued for the next batch
- On failure, the batch is re-queued at the front of the pending list
- On success after re-queue, any new pending items trigger an immediate sync

## Global Error Handlers

`init()` automatically installs `window.onerror` and `window.onunhandledrejection` handlers. Previous handlers are chained and called after Traceway captures the error.

## Browser Requirements

- `fetch` API
- `CompressionStream` API (gzip) — available in Chrome 80+, Firefox 113+, Safari 16.4+

## Stack Trace Format

Handles both V8 format (`at func (file:line:col)`) and Firefox format (`func@file:line:col`), producing Go-like output:

```
TypeError: Cannot read properties of null
handleClick()
    app.js:42
render()
    component.js:15
```
