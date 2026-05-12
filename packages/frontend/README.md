<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/frontend"><img src="https://img.shields.io/npm/v/@tracewayapp/frontend.svg" alt="npm"></a>
  <a href="https://github.com/tracewayapp/traceway-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway Browser SDK

Error tracking and session replay for browser apps. Capture exceptions with full stack traces, plus the last ~10 seconds of console logs, network calls, navigation transitions, custom breadcrumbs, and an rrweb DOM replay — automatically.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

This is the framework-agnostic browser SDK. Use it directly in vanilla JS / TS, or pick a thin framework wrapper that initializes it for you: [`@tracewayapp/react`](https://www.npmjs.com/package/@tracewayapp/react), [`@tracewayapp/vue`](https://www.npmjs.com/package/@tracewayapp/vue), [`@tracewayapp/svelte`](https://www.npmjs.com/package/@tracewayapp/svelte), [`@tracewayapp/jquery`](https://www.npmjs.com/package/@tracewayapp/jquery).

## Features

- Automatic capture of `window.onerror` and `unhandledrejection`
- Full browser stack traces normalized to Traceway's wire format
- **rrweb session replay** — exception-bound clip by default; opt into **always-on session recording** for full-session replay (see below)
- **Logs** — every `console.{debug,log,info,warn,error}` line, kept in a rolling buffer
- **Actions** — every `fetch` / `XMLHttpRequest` call, History API navigation, and custom breadcrumb
- **Auto-collected attributes** — `url`, `path`, `referrer`, `userAgent`, `language`, `platform`, `viewport`, `screen`, `timezone` stamped on every session and exception
- **Global attribute scope** — `setAttribute("userId", "42")` and friends to attach app-level identifiers (tenant, user id, feature flag) to every subsequent session and exception
- Distributed tracing — propagates a `traceway-trace-id` header across `fetch` / `XHR` / Axios
- Source-map resolution on the backend (see [`@tracewayapp/sourcemap-upload`](https://www.npmjs.com/package/@tracewayapp/sourcemap-upload))
- Gzip-compressed transport via native `CompressionStream` (the page-unload flush sends raw JSON so it dispatches synchronously)
- Self-request filter — the SDK does not log its own `/api/report` calls into the action buffer
- Debounced, retrying batch uploads
- Simple one-line setup

## Installation

```bash
npm install @tracewayapp/frontend
```

Or via CDN (no bundler):

```html
<script src="https://cdn.jsdelivr.net/npm/@tracewayapp/frontend@1/dist/traceway.iife.global.js"></script>
<script>
  Traceway.init("your-token@https://traceway.example.com/api/report");
</script>
```

## Quick Start

```ts
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

// Force-send all pending exceptions (e.g. before page unload)
await flush();
```

`init()` automatically installs `window.onerror` and `unhandledrejection` handlers, patches `console.*`, instruments `fetch` / `XMLHttpRequest`, instruments the History API, and starts an rrweb session recorder. Each captured exception is paired with the rolling timeline that preceded it.

## Manual Capture

```ts
import {
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  flush,
} from "@tracewayapp/frontend";

// Capture a caught error
try {
  await riskyOperation();
} catch (e) {
  captureException(e as Error);
}

// Capture with attributes (key-value tags)
captureExceptionWithAttributes(error, { tenant: "acme", region: "us-east" });

// Capture a message
captureMessage("User completed checkout");

// Force send pending events
await flush();
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `version` | `""` | App version string, attached to every report |
| `debug` | `false` | Print debug info to the console |
| `debounceMs` | `1500` | Milliseconds before flushing batched events |
| `retryDelayMs` | `10000` | Retry delay on failed uploads |
| `ignoreErrors` | sensible defaults | Array of `string \| RegExp` patterns; matching exceptions are dropped |
| `beforeCapture` | none | `(exception) => boolean` — return `false` to drop |
| `captureLogs` | `true` | Mirror `console.*` into the rolling log buffer |
| `captureNetwork` | `true` | Record `fetch` / `XHR` as network actions |
| `captureNavigation` | `true` | Record History API push / replace / pop as navigation actions |
| `sessionRecording` | `true` | Enable the rrweb session recorder |
| `sessionRecordingSegmentDuration` | `30000` | Segment length for the recorder (ms). 30 s by default; the always-on path uploads each segment as it rotates |
| `recordAllSessions` | `false` | When `true`, upload every segment continuously and create a parent session row, regardless of whether an exception fires. Sessions end on 15 min inactivity, 60 min max duration, or `pagehide` |
| `eventsWindowMs` | `10000` (`30000` with `recordAllSessions`) | Rolling window kept in the log/action buffers |
| `eventsMaxCount` | `200` (`600` with `recordAllSessions`) | Hard cap applied independently to logs and actions |

The `DEFAULT_IGNORE_PATTERNS` export contains the built-in `ignoreErrors` list — you can extend it rather than replace it.

## Logs & Actions

Every captured exception ships with the last ~10 seconds of session context, attached to the same `sessionRecordings[]` entry on the wire:

- **`events`** — rrweb DOM events for visual replay
- **`logs`** — recent console output
- **`actions`** — recent network requests, route changes, custom breadcrumbs
- **`startedAt` / `endedAt`** — wall-clock anchors so the backend can align logs/actions onto the replay timeline (`offsetIntoVideoMs = event.timestamp − recording.startedAt`)

### Logs

Captured automatically by patching `console.{debug, log, info, warn, error}`. The original console output is preserved — the SDK only piggybacks on the call.

Disable with `captureLogs: false`.

### Actions

Three sources feed the action buffer:

- **Network** — `fetch` and `XMLHttpRequest` are instrumented to record method, URL, status code, duration, and request/response sizes. Disable with `captureNetwork: false`.
- **Navigation** — `history.pushState`, `history.replaceState`, `popstate`, and `hashchange` are recorded (`push` / `replace` / `pop`). Static `<a>`-driven full-page loads aren't captured — the document unloads first. Disable with `captureNavigation: false`.
- **Custom** — call `recordAction(category, name, data?)` to drop in a breadcrumb (`recordAction("user", "tapped_pay")`). Always recorded; there's no per-category opt-out.

### Session Recordings

An rrweb-based recorder runs in the background and segments events into chunks. On exception, all buffered segments are flattened into the recording payload. Disable with `sessionRecording: false` — logs and actions are still attached when recording is off.

Tune the segment length with `sessionRecordingSegmentDuration` (ms).

### Buffer sizing

Logs and actions live in independent rolling buffers. Each is capped by:

- `eventsWindowMs` — drop entries older than this many ms (default `10_000`, or `30_000` when `recordAllSessions: true` so every 30 s segment carries its full activity)
- `eventsMaxCount` — keep at most this many entries (default `200`, or `600` with `recordAllSessions`)

## Always-on Session Recording

By default the SDK only ships a session-replay clip when an exception fires (the last ~30 s of rrweb events plus logs/actions). Set `recordAllSessions: true` to record **every** session continuously:

```ts
init("your-token@https://traceway.example.com/api/report", {
  recordAllSessions: true,
});
```

What changes:

- A persistent `sessionId` is generated at SDK init (or after bfcache restore) and attached to every exception captured during that session.
- Each ~30 s rrweb segment is uploaded as a separate `session_recordings` row pointing at a parent `sessions` row in the dashboard.
- Sessions end on **15 min inactivity** (no DOM events), **60 min max duration**, or `pagehide` (close tab / navigate away). The closing payload uses `fetch keepalive` so it survives unload.
- The exception-bound 10 s clip still ships alongside, so the issue page keeps its inline replay; the new Sessions page in the dashboard plays the full timeline.
- Logs and actions are flushed onto each segment as it rotates (drained from the rolling buffer to avoid double-counting).

With `recordAllSessions: false`, only exception-bound clips ship — the default and lowest-cost mode.

## Custom Attributes (global scope)

Attach app-level identifiers (`userId`, `tenant`, feature flags, etc.) once and have them ride along every subsequent session and exception:

```ts
import {
  setAttribute,
  setAttributes,
  removeAttribute,
  clearAttributes,
} from "@tracewayapp/frontend";

setAttribute("userId", "u_42");
setAttributes({ tenant: "acme", plan: "pro" });

// ...later, on logout / tenant switch:
clearAttributes();
```

Layering order on each event: `auto-collected defaults < global scope < per-call attributes`. Per-call exception attributes from `captureExceptionWithAttributes(err, { … })` still win over global keys on collision.

If `recordAllSessions: true` is on and the global scope changes mid-session, the SDK pushes a refresh upsert so the in-flight session row picks up the new attributes immediately rather than waiting for close.

The auto-collected defaults are: `url`, `path`, `referrer`, `userAgent`, `language`, `platform`, `viewport`, `screen`, `timezone`. The backend additionally stamps `client.ip` from the request.

## Distributed Tracing

When the SDK is initialized inside an app served alongside a Traceway-instrumented backend, every outgoing `fetch` / `XHR` automatically gets a `traceway-trace-id` header. Use `getActiveDistributedTraceId()` to read the in-flight id, or `createAxiosInterceptor()` to add the header to a shared Axios instance:

```ts
import axios from "axios";
import { createAxiosInterceptor } from "@tracewayapp/frontend";

const api = axios.create({ baseURL: "/api" });
api.interceptors.request.use(createAxiosInterceptor());
```

## Source Maps

When you build for production, the browser stack traces are minified. Upload your source maps after each build so the dashboard can resolve them back to the original file:line:col:

```bash
npx @tracewayapp/sourcemap-upload \
  --url https://traceway.example.com \
  --token YOUR_SOURCE_MAP_TOKEN \
  --version 1.0.0 \
  --directory dist/assets
```

The `--version` flag must match the `version` you pass to `init()`. See [`@tracewayapp/sourcemap-upload`](https://www.npmjs.com/package/@tracewayapp/sourcemap-upload) for the full CLI reference.

## API

| Function | Description |
|----------|-------------|
| `init(connectionString, options?)` | Initialize the SDK and install all global instrumentation |
| `captureException(error, options?)` | Capture an error with browser stack trace; optional `distributedTraceId` |
| `captureExceptionWithAttributes(error, attrs?, options?)` | Capture with key-value attributes (per-call; merged on top of global scope) |
| `captureMessage(msg)` | Capture an informational message |
| `recordAction(category, name, data?)` | Record a custom breadcrumb |
| `setAttribute(key, value)` | Attach a key/value to every subsequent session and exception |
| `setAttributes(map)` | Bulk version of `setAttribute` |
| `removeAttribute(key)` | Drop a single key from the global scope |
| `clearAttributes()` | Drop everything in the global scope |
| `flush(timeoutMs?)` | Force-send all pending exceptions; stops the session recorder |
| `getActiveDistributedTraceId()` | Return the in-flight distributed trace id, if any |
| `createAxiosInterceptor()` | Axios request interceptor that injects the distributed-trace header |

## Platform Support

| Environment | Error Tracking | Session Replay |
|---|---|---|
| Chrome 80+ | Yes | Yes |
| Firefox 113+ | Yes | Yes |
| Safari 16.4+ | Yes | Yes |
| Edge 80+ | Yes | Yes |
| Older browsers | No | No |

The `CompressionStream` API used for gzip-compressed uploads is supported in Chrome 80+, Firefox 113+, Safari 16.4+ — the SDK requires it for the regular sync path. The page-unload flush always sends raw JSON (so the request can dispatch synchronously inside the `pagehide` handler), and the backend accepts both.

For React Native and Expo apps, use [`@tracewayapp/react-native`](https://www.npmjs.com/package/@tracewayapp/react-native) instead — it intentionally omits rrweb (no DOM) but preserves the logs, actions, and exception capture pipeline.

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [React wrapper](https://www.npmjs.com/package/@tracewayapp/react)
- [Vue wrapper](https://www.npmjs.com/package/@tracewayapp/vue)
- [Svelte wrapper](https://www.npmjs.com/package/@tracewayapp/svelte)
- [jQuery wrapper](https://www.npmjs.com/package/@tracewayapp/jquery)
- [React Native SDK](https://www.npmjs.com/package/@tracewayapp/react-native)

## License

MIT
