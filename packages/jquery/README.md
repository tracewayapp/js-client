<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/jquery"><img src="https://img.shields.io/npm/v/@tracewayapp/jquery.svg" alt="npm"></a>
  <a href="https://github.com/tracewayapp/traceway-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway jQuery SDK

Error tracking and session replay for jQuery apps. Adds an `$.ajaxError` handler on top of [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend) so every failed `$.ajax` call surfaces in the Traceway dashboard with method, URL, status, and full distributed-trace propagation.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

## Features

- One-line `init()` that registers a `jq(document).ajaxError(...)` handler
- Failed `$.ajax` calls captured as exceptions with `url`, `method`, `status` attributes
- Reads incoming `traceway-trace-id` response headers to correlate with the backend
- Inherits everything from [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend): `window.onerror`, `unhandledrejection`, console logs, `fetch` / `XHR` actions, History API navigation, rrweb session replay
- Works with `jQuery`, `$`, or `$.ajax` — picks whichever is on the page
- Gzip-compressed transport, debounced batching, retry on failure

## Installation

```bash
npm install @tracewayapp/jquery
```

Or via CDN:

```html
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@tracewayapp/jquery@1/dist/traceway-jquery.iife.global.js"></script>
<script>
  TracewayJQuery.init("your-token@https://traceway.example.com/api/report");
</script>
```

## Quick Start

```ts
import { init } from "@tracewayapp/jquery";

init("your-token@https://traceway.example.com/api/report");
```

That's it. `init()` runs the underlying `@tracewayapp/frontend` `init(...)` (so you also get `window.onerror`, `unhandledrejection`, console mirror, `fetch` / `XHR` instrumentation, History API instrumentation, and rrweb recording), then attaches a global `$(document).ajaxError(...)` handler that captures every failed `$.ajax` call.

## Manual Capture

Manual capture functions are re-exported from `@tracewayapp/frontend`:

```ts
import {
  captureException,
  captureExceptionWithAttributes,
  captureMessage,
  flush,
} from "@tracewayapp/jquery";

try {
  riskyOperation();
} catch (e) {
  captureException(e);
}

captureExceptionWithAttributes(error, { tenant: "acme" });
captureMessage("User completed checkout");
await flush();
```

## Custom Attributes (global scope)

Attach app-level identifiers (`userId`, `tenant`, feature flags, etc.) once and have them ride along every subsequent session and exception:

```ts
import {
  setAttribute,
  setAttributes,
  removeAttribute,
  clearAttributes,
} from "@tracewayapp/jquery";

setAttribute("userId", "u_42");
setAttributes({ tenant: "acme", plan: "pro" });

// ...later, on logout / tenant switch:
clearAttributes();
```

Layering order on each event: `auto-collected defaults < global scope < per-call attributes`. See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#custom-attributes-global-scope) for the full mechanics.

## Always-on Session Recording

By default the SDK only ships a session-replay clip when an exception fires. Pass `recordAllSessions: true` to record every session continuously — see the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#always-on-session-recording) for the full description.

```ts
init("your-token@https://traceway.example.com/api/report", {
  recordAllSessions: true,
});
```

## What Gets Captured Automatically

- **`$.ajax` errors** — any AJAX call that hits jQuery's error path becomes a captured exception with `{ url, method, status }` attributes and a `${method} ${url} failed: ${status} ${message}` description
- **`window.onerror` / `unhandledrejection`** — via `@tracewayapp/frontend`
- **`fetch` / `XMLHttpRequest`** — every HTTP call (including jQuery's underlying XHR) recorded as a network action with method, URL, status, duration, byte counts
- **History API navigation** — `pushState`, `replaceState`, `popstate`, `hashchange`
- **Console output** — `console.{debug, log, info, warn, error}` mirrored into the rolling log buffer
- **rrweb session replay** — last ~10 seconds of DOM events ship alongside each exception

## Distributed Tracing

If the response to a failed `$.ajax` call contains a `traceway-trace-id` header (set by a Traceway-instrumented backend), the SDK reads it and attaches it to the captured exception so the dashboard can stitch the failed request into the same trace. Falls back to the SDK's in-flight distributed-trace id if the header is missing.

## Options

`init()` forwards options directly to [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend). The most-used flags:

| Option | Default | Description |
|--------|---------|-------------|
| `version` | `""` | App version string, attached to every report |
| `debug` | `false` | Print debug info to the console |
| `captureLogs` | `true` | Mirror `console.*` into the rolling log buffer |
| `captureNetwork` | `true` | Record `fetch` / `XHR` as network actions |
| `captureNavigation` | `true` | Record History API push / replace / pop as navigation actions |
| `sessionRecording` | `true` | Enable the rrweb session recorder |
| `recordAllSessions` | `false` | Always-on session recording (every segment uploaded continuously, full session row in the dashboard) |

See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend) for the full options reference.

## Platform Support

| Environment | Error Tracking | Session Replay |
|---|---|---|
| jQuery 1.5+ in any modern browser | Yes | Yes |
| Bundled with Webpack / Vite / Rollup | Yes | Yes |
| Loaded via `<script>` from CDN | Yes | Yes |

If you're not using jQuery, install [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend) directly.

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)

## License

MIT
