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
- Binds to the `jQuery` option for a bundled jQuery, else to the global `jQuery`, or to the global `$` when it has `$.ajax`
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
  TracewayJQuery.init({ token: "YOUR_TOKEN" });
</script>
```

The CDN build exposes every export on the `TracewayJQuery` global (`TracewayJQuery.captureException`, `TracewayJQuery.recordAction`, `TracewayJQuery.flush`, and so on). [`examples/jquery-cdn/`](examples/jquery-cdn/) is a page that uses it.

## Quick Start

With a bundler, pass the jQuery you import as the `jQuery` option:

```ts
import $ from "jquery";
import { init } from "@tracewayapp/jquery";

init({ token: import.meta.env.VITE_TRACEWAY_TOKEN, jQuery: $ });
```

`token` is the project token, here from `VITE_TRACEWAY_TOKEN`. The SDK sends to Traceway Cloud; for a self-hosted server, add its address as `baseUrl` (`baseUrl: import.meta.env.VITE_TRACEWAY_URL`). Every other option goes in the same object: `init({ token: import.meta.env.VITE_TRACEWAY_TOKEN, jQuery: $, version: "1.4.2", debug: true })`.

That's it. `init()` runs the underlying `@tracewayapp/frontend` `init(...)` (so you also get the `window.onerror` and `unhandledrejection` handlers, `console.*`, `fetch` / `XHR`, History API and click instrumentation, and rrweb recording), then attaches a global `$(document).ajaxError(...)` handler that captures failed `$.ajax` calls.

The handler binds to the `jQuery` option. Without it, it binds to `window.jQuery`, or to `window.$` when that has `$.ajax`, which is where a `<script>` tag puts jQuery. A bundled jQuery never lands on `window`, so pass it. When there is neither, `init()` warns once: `Traceway: jQuery was not found on window, so failed $.ajax calls are not reported. Pass it as the jQuery option: init({ token, jQuery: $ })`. The rest of the SDK works either way.

Call `init()` once, after jQuery is on the page. The SDK itself starts once per page (a second `init()` does not restart it until `await shutdown()`), and the `ajaxError` handler is bound once per page. `shutdown()` does not unbind it; it reports nothing while the SDK is stopped.

By default errors and messages are sent as they happen, and session start and end are reported for every visit. Console output, requests, navigation, clicks and the replay stay on the device: a captured error uploads up to 10 minutes of those breadcrumbs and a 30-second replay clip.

### Upgrading from 2.0

2.0 started with a connection string, `init("token@https://host/api/report", options)`. It still works, but it is deprecated and logs one warning that names the new form: `init({ ...options, token, baseUrl: "https://host" })`, and for Traceway Cloud just `init({ ...options, token })`. Every variation of the old string keeps working (with or without `/api` or `/api/report`, a trailing slash, a query string, without a scheme, a server under a sub-path), and `baseUrl` is read the same way. The `transport` option is deprecated and ignored: the SDK always sends OTLP.

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

The package also re-exports `log`, `recordAction`, `track`, `metric`, `count`, `setMetricDimension`, `setRoute`, `recordNavigation`, `tracer`, `trackRouter`, `routeFromParams`, `startInteraction`, `setAttribute`, `setAttributes`, `removeAttribute`, `clearAttributes`, `refreshConfig`, `shutdown`, `getInstanceId`, `currentSessionId`, `getClient`, `DEFAULT_IGNORE_PATTERNS` and `SDK_VERSION`: every value of `@tracewayapp/frontend` except its `init` (this package's `init` replaces it) and the `TracewayFrontendClient` class. The CDN build has them all on `TracewayJQuery`. Its types are all re-exported too: `TracewayFrontendOptions`, `StandaloneOptions`, `TelemetryOptions`, `TelemetryEndpoint`, `TracewayCapturedError` (`CapturedException` is its deprecated alias), `TracewayInteraction`, `TracewayLogLevel`, `ErrorLimits`, `CollectionLimits`, `Settings`, `CollectionSettings`, `Trigger`, `TriggerAction`, `Capture`, `Mode`, `SignalName`, `TracewayImagePolicy`, `RouteParams` and the event types `TracewayEvent`, `LogEvent`, `NetworkEvent`, `NavigationEvent` and `CustomEvent`, plus this package's `TracewayJQueryOptions`. The package declares no global `$` or `jQuery` types, so it works next to `@types/jquery`. See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#api) for what each function does.

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
init({
  token: import.meta.env.VITE_TRACEWAY_TOKEN,
  jQuery: $,
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
- **An aborted request is not reported**: the app cancelled it (`jqXHR.abort()`, a typeahead dropping the previous request).

To capture every AJAX error, pass `ignoreErrors: []`. To filter by status, use `beforeCapture`, which receives the `status` attribute as a string:

```ts
init({
  token: import.meta.env.VITE_TRACEWAY_TOKEN,
  jQuery: $,
  ignoreErrors: [],
  beforeCapture: (exception) => {
    const status = Number(exception.attributes?.status);
    return !(status >= 400 && status < 500);
  },
});
```

With `captureHttpServerErrors: true` the base SDK reports every `fetch` / `XHR` response with status >= 500 as a message issue (`HTTP <status> <METHOD> <url>`). `$.ajax()` uses XHR, so a 5xx AJAX response then shows up twice: as that message and as the `ajaxError` exception. The option is off by default; leave it off unless you also want 5xx responses of plain `fetch` / `XHR` calls reported.

## Distributed Tracing

`$.ajax()` goes through `XMLHttpRequest`, which the SDK records as an OpenTelemetry CLIENT span, and same-origin requests carry the W3C `traceparent` header, so a backend instrumented with OpenTelemetry joins the same trace with no extra middleware. For an API on another origin, list it in `propagateTraceHeaderCorsUrls` (its CORS policy must allow the `traceparent` header): a string such as `"https://api.example.com/"` matches every URL that starts with it, a `RegExp` is tested against the URL. See [Distributed Tracing](https://docs.tracewayapp.com/client/js-sdk/distributed-tracing).

To tie the steps of one user action together, `startInteraction(name, attributes?)` returns a `TracewayInteraction` with `run`, `bind`, `setAttribute`, `captureException` and `end(failed?)`; see the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#distributed-tracing).

## Send telemetry to another OpenTelemetry provider

The `telemetry` option sends logs, traces and metrics to any OTLP/HTTP endpoint, while errors, replay, captures and remote config stay on Traceway: `init({ token: "YOUR_TOKEN", telemetry: { url: "https://collector.example.com" } })`. Without a `token` the SDK runs standalone and sends only there. See [Send telemetry to another OpenTelemetry provider](https://www.npmjs.com/package/@tracewayapp/frontend#send-telemetry-to-another-opentelemetry-provider).

## Options

`init(options)` forwards its options directly to [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend); `TracewayJQueryOptions` adds the `jQuery` option to `TracewayFrontendOptions`. The most-used flags:

| Option | Default | Description |
|--------|---------|-------------|
| `token` | none | The project token. Without one, only a `telemetry` destination receives anything |
| `baseUrl` | `https://cloud.tracewayapp.com` | The Traceway server; set it only for a self-hosted one |
| `jQuery` | `window.jQuery`, else `window.$` | The jQuery whose failed `$.ajax` calls are reported; pass it when jQuery is bundled (`import $ from "jquery"`) |
| `version` | none | App version, reported as `service.version`. Groups releases, and remote rules can target it |
| `environment` | none | `deployment.environment.name`, e.g. `"production"` |
| `serviceName` | the page's host name | `service.name` of this app |
| `debug` | `false` | Logs with the page's own `console.warn`, so Traceway never records the lines: the start (`Traceway: started (…/api/otel/v1/logs), session …`), remote config applied, rejected or unavailable, every dropped exception or message and why (`ignoreErrors`, `beforeCapture`, `errorLimits`, the session upload budget `collectionLimits`), a repeated `init()`, the Vue plugin's caught errors, and SDK failures it contained |
| `ignoreErrors` | the built-in patterns | Patterns matched against `Type: message`; matching exceptions and messages are dropped. See [Which AJAX errors are reported](#which-ajax-errors-are-reported). Pass `[]` to capture everything |
| `beforeCapture` | none | Receives `{ error, type, message, isMessage, stack, attributes }` (`TracewayCapturedError`); return `false` to drop. `error` is what was thrown or passed to `captureException`, undefined for a message |
| `sessionRecording` | `true` | Allow rrweb session replay at all |
| `replayImages` | `"always"` | The most the replay records of pictures (`"off"`, `"wifi"`, `"always"`): `replay.images`, from `collection` or a rule, applies only up to it |
| `collection.replay.maskAllInputs` | `true` | Record input values as `*`. Set to `true` here, no rule can switch it off |
| `recordAllSessions` | `false` | Stream every replay segment and breadcrumb instead of keeping them on the device for error clips |
| `sessions` | `true` | Report session start and end |
| `captureLogs` | `true` | Allow `console.*` output as breadcrumbs |
| `captureNetwork` | `true` | Instrument `fetch` / `XHR`, which includes `$.ajax()`: CLIENT spans and the `traceparent` header. The `ajaxError` capture does not depend on it |
| `captureNavigation` | `true` | Allow page loads and History API push / replace / pop as breadcrumbs |
| `captureUserActions` | `true` | Allow clicks as breadcrumbs |
| `captureMetrics` | `true` | Allow the performance metrics aggregated on the device |
| `captureHttpServerErrors` | `false` | Report `fetch` / `XHR` responses with status >= 500 as message issues. A 5xx `$.ajax()` response is then reported twice, see above |
| `propagateTraceHeaderCorsUrls` | none | Cross-origin URLs that also get the `traceparent` header (same-origin requests always do): a string matches every URL that starts with it, a `RegExp` is tested against the URL |
| `remoteConfig` | `true` | Fetch collection settings from Traceway, so the **Data Collection** page can change what the app sends without a release |

The `capture*`, `sessionRecording`, `replayImages` and `sessions` options are ceilings: remote settings can restrict a signal further, but never turn on what you turned off here. The 1.x options `debounceMs`, `retryDelayMs`, `eventsWindowMs` and `eventsMaxCount` no longer exist.

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
