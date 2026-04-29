# @tracewayapp/frontend

Traceway SDK for browser environments. Captures exceptions and messages with automatic batching and retry, and records a rolling timeline of console logs, network/navigation actions, and an rrweb-based session replay that ships alongside each error.

## Installation

```bash
npm install @tracewayapp/frontend
```

## Quick Start

```typescript
import { init, captureException, captureMessage, recordAction, flush } from "@tracewayapp/frontend";

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

// Record a custom breadcrumb that rides along with the next exception
recordAction("checkout", "payment_submitted", { amount: 42 });

// Force-send all pending exceptions
await flush();
```

`init()` automatically installs `window.onerror` and `window.onunhandledrejection` handlers, patches `console.*`, instruments `fetch` / `XMLHttpRequest`, instruments the History API, and starts an rrweb session recorder. Each captured exception is paired with the rolling timeline that preceded it.

## Logs, Actions, and Session Recordings

When an exception is captured, the SDK attaches a `SessionRecordingPayload` containing:

- **`events`** — rrweb DOM events for visual replay (Source: `session-recorder.ts`)
- **`logs`** — recent console output
- **`actions`** — recent network requests, route changes, and custom breadcrumbs
- **`startedAt` / `endedAt`** — wall-clock anchors so the backend can align logs/actions onto the replay timeline

### Logs

Captured automatically by patching `console.{debug, log, info, warn, error}`. The original console output is preserved — the SDK only piggybacks on the call. Each log is recorded as a `LogEvent` (`{ type: "log", timestamp, level, message }`).

Disable with `captureLogs: false`.

### Actions

Three sources feed the action buffer:

- **Network** — `fetch` and `XMLHttpRequest` are instrumented to record method, URL, status code, duration, and request/response sizes as `NetworkEvent`. Disable with `captureNetwork: false`.
- **Navigation** — `history.pushState`, `history.replaceState`, `popstate`, and `hashchange` are recorded as `NavigationEvent` (`push` / `replace` / `pop`). Static `<a>`-driven full-page loads are not captured (the document unloads first). Disable with `captureNavigation: false`.
- **Custom** — call `recordAction(category, name, data?)` to drop in a `CustomEvent` breadcrumb (e.g., `recordAction("user", "tapped_pay")`). Always recorded; there is no per-category opt-out.

### Session Recordings

An rrweb-based recorder runs in the background and segments events into chunks (default segment duration is set in `session-recorder.ts`). On exception, all buffered segments are flattened into the recording payload. Disable with `sessionRecording: false` — logs and actions are still attached when recording is off.

Tune the segment length with `sessionRecordingSegmentDuration` (ms).

### Buffer sizing

Logs and actions live in independent rolling buffers. Each is capped by:

- `eventsWindowMs` — drop entries older than this many ms (default `10_000`)
- `eventsMaxCount` — keep at most this many entries (default `200`)

## API

| Function | Description |
|----------|-------------|
| `init(connectionString, options?)` | Initialize the SDK and install global error / network / navigation / console / replay instrumentation |
| `captureException(error, options?)` | Capture an error with browser stack trace; optionally attach a `distributedTraceId` |
| `captureExceptionWithAttributes(error, attributes?, options?)` | Capture with key-value attributes |
| `captureMessage(msg)` | Capture an informational message |
| `recordAction(category, name, data?)` | Record a custom breadcrumb action |
| `flush(timeoutMs?)` | Force-send all pending exceptions; stops the session recorder |
| `getActiveDistributedTraceId()` | Return the in-flight distributed trace id, if any |
| `createAxiosInterceptor()` | Axios request interceptor that injects the distributed-trace header |

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `debug` | `boolean` | `false` | Enable debug logging |
| `debounceMs` | `number` | `1500` | Debounce interval before sending |
| `retryDelayMs` | `number` | `10000` | Delay before retrying a failed upload |
| `version` | `string` | `""` | Application version |
| `captureLogs` | `boolean` | `true` | Mirror `console.*` into the rolling log buffer |
| `captureNetwork` | `boolean` | `true` | Record `fetch` / `XHR` as network actions |
| `captureNavigation` | `boolean` | `true` | Record History API push / replace / pop as navigation actions |
| `sessionRecording` | `boolean` | `true` | Enable the rrweb session recorder |
| `sessionRecordingSegmentDuration` | `number` | recorder default | Segment length for the recorder (ms) |
| `eventsWindowMs` | `number` | `10000` | Time window kept in the log/action buffers |
| `eventsMaxCount` | `number` | `200` | Hard cap applied independently to logs and actions |
| `ignoreErrors` | `Array<string \| RegExp>` | see `DEFAULT_IGNORE_PATTERNS` | Drop exceptions whose stack/message match any pattern |
| `beforeCapture` | `(exception) => boolean` | — | Return `false` to suppress an exception; throws are swallowed |

## Requirements

- `fetch` API
- `CompressionStream` API (gzip) — Chrome 80+, Firefox 113+, Safari 16.4+
