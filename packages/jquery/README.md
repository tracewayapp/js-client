<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/jquery"><img src="https://img.shields.io/npm/v/@tracewayapp/jquery.svg" alt="npm"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway jQuery SDK

Error tracking and session replay for jQuery apps. Adds an `$.ajaxError` handler on top of [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend) so failed `$.ajax` calls surface in the Traceway dashboard with method, URL and status. Requests carry the W3C `traceparent` header, so they join the traces of an instrumented backend.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

## Features

- One-line `init()` that registers a `$(document).ajaxError(...)` handler
- Failed `$.ajax` calls captured as exceptions with `url`, `method`, `status` attributes
- Inherits everything from [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend): `window.onerror`, `unhandledrejection`, rrweb session replay, breadcrumbs (console, `fetch` / XHR, navigation, clicks), performance metrics, W3C `traceparent` propagation
- Binds to the global `jQuery`, or to the global `$` when it has `$.ajax`
- Collection settings you can change from the dashboard's **Data Collection** page; failed exports wait in IndexedDB and are retried

Upgrading from 1.x? See the [migration guide](https://docs.tracewayapp.com/client/js-sdk/migration).

## Installation

```bash
npm install @tracewayapp/jquery
```

This installs 2.x. Use `@tracewayapp/jquery@2` to pin the major, or `@tracewayapp/jquery@1` to stay on 1.x.

Or via CDN:

```html
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@tracewayapp/jquery@2/dist/traceway-jquery.iife.global.js"></script>
<script>
  TracewayJQuery.init("your-token@https://traceway.example.com/api/report");
</script>
```

The CDN build exposes every export on the `TracewayJQuery` global (`TracewayJQuery.captureException`, `TracewayJQuery.setAttribute`, `TracewayJQuery.flush`, and so on).

## Quick Start

```ts
import { init } from "@tracewayapp/jquery";

init("your-token@https://traceway.example.com/api/report");
```

That's it. `init()` runs the underlying `@tracewayapp/frontend` `init(...)` (so you also get the `window.onerror` and `unhandledrejection` handlers, `console.*`, `fetch` / `XHR`, History API and click instrumentation, and rrweb recording), then attaches a global `$(document).ajaxError(...)` handler that captures failed `$.ajax` calls.

The handler binds to the global `jQuery` (or `$`). If jQuery is only a bundled module and never lands on `window`, set `window.jQuery = window.$ = $` before `init()`; otherwise the rest of the SDK works but AJAX errors are silently skipped.

Call `init()` once, after jQuery is on the page. The SDK itself starts once per page (a second `init()` does not restart it until `await shutdown()`), and the `ajaxError` handler is bound once per page. `shutdown()` does not unbind it; it reports nothing while the SDK is stopped.

By default errors and messages are sent as they happen, and session start and end are reported for every visit. Console output, requests, navigation, clicks and the replay stay on the device: a captured error uploads up to 10 minutes of those breadcrumbs and a 30-second replay clip.

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

`captureException(error, attributes?)` and `captureMessage(message, attributes?)` take optional string attributes (`Record<string, string>`); `captureExceptionWithAttributes` is the same as `captureException`. `flush()` sends what is queued for sending; buffered breadcrumbs stay on the device.

The package also re-exports `track`, `metric`, `count`, `setMetricDimension`, `setRoute`, `startInteraction`, `refreshConfig`, `shutdown`, `getInstanceId` and the attribute functions below. `recordAction` and `DEFAULT_IGNORE_PATTERNS` are not exported by this package: use `track()` for app events, and import the pattern list from `@tracewayapp/frontend` if you need it. See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#api) for what each function does.

## Custom Attributes (global scope)

Attach app-level identifiers (`user.id`, `tenant`, feature flags, etc.) once and have them ride along every subsequent session and exception. Attribute values are strings:

```ts
import {
  setAttribute,
  setAttributes,
  removeAttribute,
  clearAttributes,
} from "@tracewayapp/jquery";

setAttribute("user.id", "u_42");
setAttributes({ tenant: "acme", plan: "pro" });

// ...later, on logout / tenant switch:
clearAttributes();
```

`clearAttributes()` empties the whole global scope; use `removeAttribute(key)` to drop single keys.

Layering order on each event: `auto-collected defaults < global scope < per-call attributes`. See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#custom-attributes-global-scope) for the full mechanics.

Remote rules and captures can target these attributes; `user.id` is the key to use for a user. After login, call `refreshConfig()` so a rule that targets the user applies at once instead of at the next poll.

## Always-on Session Recording

By default the replay stays on the device and an error uploads a 30-second clip. Pass `recordAllSessions: true` to stream every replay segment and breadcrumb as it is recorded — see [Session Replay](https://docs.tracewayapp.com/client/js-sdk/session-replay) for the full description.

```ts
init("your-token@https://traceway.example.com/api/report", {
  recordAllSessions: true,
});
```

## What Gets Captured Automatically

- **`$.ajax` errors** — an AJAX call that hits jQuery's error path becomes a captured exception with `{ url, method, status }` attributes (all strings) and a `${method} ${url} failed: ${status} ${message}` description, subject to the default filters below
- **`window.onerror` / `unhandledrejection`** — via `@tracewayapp/frontend`
- **`fetch` / `XMLHttpRequest`** — every HTTP call (including jQuery's underlying XHR) recorded as an OpenTelemetry CLIENT span
- **Navigation and clicks** — page loads, History API navigation (`pushState`, `replaceState`, `popstate`) and clicks
- **Console output** — `console.log`, `info`, `warn` and `error`. `console.debug` is below the default minimum severity (`collection.signals.console.minSeverity`, `"info"`)
- **rrweb session replay** — the default exception trigger uploads a 30-second DOM replay clip
- **Performance metrics** — web vitals, route changes and requests, aggregated on the device and uploaded every 300 seconds, when the page is hidden and at session end

Errors and messages are sent as they happen. The breadcrumbs (requests, navigation, clicks, console) and the replay are kept on the device and uploaded with an error: up to 10 minutes of breadcrumbs and the replay clip, with a 5-second cooldown between clips and at most 20 clips per session.

### Which AJAX errors are reported

The handler builds the message `<METHOD> <url> failed: <status> <text>`, for example `GET /api/users failed: 500 Internal Server Error`, and the default `ignoreErrors` patterns apply to it:

- **4xx responses are dropped** (`/failed: 4\d{2}/`), so a 401 or 422 does not become an issue.
- **Timeouts are dropped** (`/timeout/i` matches jQuery's `timeout` status text).
- **5xx responses are reported.**
- **A request that fails without a response** (status `0`, for instance when the network is down) is not matched by a default pattern and is reported, as `<METHOD> <url> failed: 0 error`.

To capture every AJAX error, pass `ignoreErrors: []`. To filter by status, use `beforeCapture`, which receives the `status` attribute as a string:

```ts
init("your-token@https://traceway.example.com/api/report", {
  ignoreErrors: [],
  beforeCapture: (exception) => {
    const status = Number(exception.attributes?.status);
    return !(status >= 400 && status < 500);
  },
});
```

With `captureHttpServerErrors: true` the base SDK reports every `fetch` / `XHR` response with status >= 500 as a message issue (`HTTP <status> <METHOD> <url>`). `$.ajax()` uses XHR, so a 5xx AJAX response then shows up twice: as that message and as the `ajaxError` exception. The option is off by default; leave it off unless you also want 5xx responses of plain `fetch` / `XHR` calls reported.

## Distributed Tracing

`$.ajax()` goes through `XMLHttpRequest`, which the SDK records as an OpenTelemetry CLIENT span, and same-origin requests carry the W3C `traceparent` header, so a backend instrumented with OpenTelemetry joins the same trace with no extra middleware. For an API on another origin, list it in `propagateTraceHeaderCorsUrls` (its CORS policy must allow the `traceparent` header). See [Distributed Tracing](https://docs.tracewayapp.com/client/js-sdk/distributed-tracing).

## Options

`init(connectionString, options?)` forwards its arguments directly to [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend) (`TracewayJQueryOptions` adds nothing to `TracewayFrontendOptions`). `connectionString` is the `token@url` string, or an options object with a `telemetry` destination to run the SDK [without a Traceway server](https://docs.tracewayapp.com/client/js-sdk/initialization#standalone-without-a-traceway-server). The most-used flags:

| Option | Default | Description |
|--------|---------|-------------|
| `version` | none | App version, reported as `service.version`. Groups releases, and remote rules can target it |
| `environment` | none | `deployment.environment.name`, e.g. `"production"` |
| `serviceName` | the page's host name | `service.name` of this app |
| `debug` | `false` | Log the problems the SDK would otherwise swallow: a rejected project token and a `beforeCapture` that throws. Captured events are not logged |
| `ignoreErrors` | the built-in patterns | Patterns matched against `Type: message`; matching exceptions and messages are dropped. See [Which AJAX errors are reported](#which-ajax-errors-are-reported). Pass `[]` to capture everything |
| `beforeCapture` | none | Receives `{ type, message, stack, attributes }`; return `false` to drop |
| `sessionRecording` | `true` | Allow rrweb session replay at all |
| `recordAllSessions` | `false` | Stream every replay segment and breadcrumb instead of keeping them on the device for error clips |
| `sessions` | `true` | Report session start and end |
| `captureLogs` | `true` | Allow `console.*` output as breadcrumbs |
| `captureNetwork` | `true` | Instrument `fetch` / `XHR`, which includes `$.ajax()`: CLIENT spans and the `traceparent` header. The `ajaxError` capture does not depend on it |
| `captureNavigation` | `true` | Allow page loads and History API push / replace / pop as breadcrumbs |
| `captureUserActions` | `true` | Allow clicks as breadcrumbs |
| `captureMetrics` | `true` | Allow the performance metrics aggregated on the device |
| `captureHttpServerErrors` | `false` | Report `fetch` / `XHR` responses with status >= 500 as message issues. A 5xx `$.ajax()` response is then reported twice, see above |
| `propagateTraceHeaderCorsUrls` | none | Cross-origin URLs that also get the `traceparent` header (same-origin requests always do) |
| `remoteConfig` | `true` | Fetch collection settings from Traceway, so the **Data Collection** page can change what the app sends without a release |

The `capture*`, `sessionRecording` and `sessions` options are ceilings: remote settings can restrict a signal further, but never turn on what you turned off here. The 1.x options `debounceMs`, `retryDelayMs`, `eventsWindowMs` and `eventsMaxCount` no longer exist.

See [Initialization](https://docs.tracewayapp.com/client/js-sdk/initialization#options-reference) for the full options reference.

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
- [jQuery guide](https://docs.tracewayapp.com/client/jquery)
- [Migration guide from 1.x](https://docs.tracewayapp.com/client/js-sdk/migration)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)

## License

MIT
