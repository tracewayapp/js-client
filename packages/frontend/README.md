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

Error tracking and session replay for browser apps. Capture exceptions with full stack traces, plus the last 30 seconds of console logs, network calls, navigation transitions, custom breadcrumbs, and an rrweb DOM replay — automatically.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

This is the framework-agnostic browser SDK. Use it directly in vanilla JS / TS, or pick a thin framework wrapper that initializes it for you: [`@tracewayapp/react`](https://www.npmjs.com/package/@tracewayapp/react), [`@tracewayapp/vue`](https://www.npmjs.com/package/@tracewayapp/vue), [`@tracewayapp/svelte`](https://www.npmjs.com/package/@tracewayapp/svelte), [`@tracewayapp/jquery`](https://www.npmjs.com/package/@tracewayapp/jquery).

## Features

- Automatic capture of `window.onerror` and `unhandledrejection`
- Built on OpenTelemetry: OTLP/HTTP logs and spans, with the Browser SIG's instrumentations
- **rrweb session replay** — an error clip by default; stream whole sessions with `recordAllSessions` or a remote rule
- **Breadcrumbs** — console, `fetch` / XHR, navigation, clicks and custom events, kept on the device and uploaded with an error
- **Web vitals** and resource timing
- **Long tasks** and **route change timing**, off until remote config, a trigger or a capture turns them on
- **Auto-collected attributes** — `url`, `path`, `referrer`, `userAgent`, `language`, `platform`, `viewport`, `screen`, `timezone` stamped on every session and exception
- **Global attribute scope** — `setAttribute("user.id", "42")` and friends to attach app-level identifiers (tenant, user id, feature flag) to every subsequent session and exception
- Distributed tracing — `fetch` / XHR spans with the W3C `traceparent` header
- Source-map resolution on the backend (see [`@tracewayapp/sourcemap-upload`](https://www.npmjs.com/package/@tracewayapp/sourcemap-upload))
- Failed OTLP batches wait in IndexedDB and retry in the current page, on connectivity recovery, and on later pages
- Remote control — Traceway decides over OpAMP what each group of clients sends, buffers or drops
- Simple one-line setup

## Installation

```bash
npm install @tracewayapp/frontend@2
```

Or via CDN (no bundler):

```html
<script src="https://cdn.jsdelivr.net/npm/@tracewayapp/frontend@2/dist/traceway.iife.global.js"></script>
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
| `serviceName` | the page's host name | `service.name` of this app |
| `version` | `""` | `service.version`; rules can target releases with it |
| `environment` | none | `deployment.environment.name` |
| `attributes` | `{}` | Initial global attributes, see `setAttribute` |
| `debug` | `false` | Print debug info to the console |
| `ignoreErrors` | sensible defaults | `string \| RegExp` patterns matched against `Type: message`; matching exceptions are dropped |
| `beforeCapture` | none | `({ type, message, stack, attributes }) => boolean`; return `false` to drop |
| `transport` | `"auto"` | Detect older servers and use `/api/report`; `"legacy"` forces that protocol, `"otlp"` disables fallback |
| `remoteConfig` | `true` | Fetch collection settings from Traceway over OpAMP (see below) |
| `collection` | SDK defaults | Local signal modes, sampling, triggers, buffer limits, and metric upload interval |
| `telemetry` | Traceway endpoints | OTLP/HTTP base URL, per-signal URLs, and headers; required in standalone mode |
| `sessionRecording` | `true` | Allow rrweb session replay at all |
| `sessionRecordingSegmentDuration` | `30000` | Replay segment length (ms) |
| `collectionLimits` | `{ maxBytes: 52428800, maxEvents: 10000 }` | Shared per-session diagnostic upload ceiling; can be lowered |
| `baselineSampleRate` | `0` | Stable healthy-session breadcrumb/request sample, from 0 to 1; does not stream replay |
| `errorLimits` | `{ maxPerMinute: 60, duplicateWindowMs: 1000 }` | Per-client rolling error limit and duplicate suppression |
| `recordAllSessions` | `false` | Stream every replay segment and every breadcrumb by default instead of keeping them for error clips |
| `sessions` | `true` | Record session start and end |
| `captureLogs`, `captureNetwork`, `captureNavigation`, `captureUserActions`, `captureWebVitals`, `captureResourceTiming`, `captureLongTasks`, `captureRouteTiming` | `true` | Allow a signal at all |
| `captureMetrics` | `true` | Performance metrics: histograms and counters aggregated on the device, one small upload per flush |
| `metricDimensions` | none | Up to two dimensions of your own on every performance metric, e.g. `{ plan: "pro" }` |
| `captureHttpServerErrors` | `false` | Report fetch / XHR responses with status >= 500 as message issues |
| `propagateTraceHeaderCorsUrls` | none | Cross-origin URLs that get the W3C `traceparent` header (same-origin requests always do) |
| `exportDelayMs` | `1000` | Delay between OTLP exports |

The `capture*`, `sessionRecording` and `sessions` options are **ceilings**: remote settings can switch a signal off or
keep it on the device, but never turn on what `init()` turned off. The `DEFAULT_IGNORE_PATTERNS` export contains the
built-in `ignoreErrors` list.

## Remote control

Each signal is in one of three modes: **stream** (sent right away), **buffer** (kept on the device and uploaded only
when a trigger fires or the dashboard starts a capture) or **off**. Without remote settings:
errors and messages stream; console, network, navigation, clicks, custom events and replay are buffered; and up to 20 errors per session upload the last 30 seconds of them with a replay clip.

In the dashboard (project Settings > Data Collection) you write rules that target clients by what they report: release
(`service.version`), browser, OS, `user.id` or any attribute you set with `setAttribute`, and a percentage rollout. A rule
can change modes and sample rates, and add triggers ("3 failed requests within a minute: upload the last 2 minutes and
stream for 5"). A capture makes one device, user or session upload what it buffered and stream everything for a while,
including signals a rule switched off, but never what `init()` turned off or what your plan does not include. A
trigger can start a capture too, e.g. "if `payment failed` is logged 3 times in a minute, capture for 30 minutes"; the
line that started it is part of it.

The SDK polls for its settings at start, every few minutes and when the tab becomes visible after the polling interval, and remembers them for the
next page. Call `refreshConfig()` after login so rules targeting `user.id` apply at once, and `track(name, attributes)`
to record events triggers can match.

## Breadcrumbs & Replay

Console calls, `fetch` / XHR, route changes, clicks and `recordAction` / `track` events are recorded as OpenTelemetry
log records and spans, tagged with the session. By default they are **buffered** on the device: an error uploads the
last 10 minutes of breadcrumbs and a 30-second replay clip with the exception, and the replay player shows them next to the recording. With
`recordAllSessions`, or when remote settings say so, they stream; remote settings can also switch them off. Replay
segments carry only the recording, so each breadcrumb is uploaded once.

rrweb session replay runs only when replay is not off (it is loaded lazily, so a page with replay off never downloads
it). Each segment replays on its own; buffered segments upload with an error clip, streamed segments upload as they
complete. Replay goes to Traceway's recordings endpoint, not OTLP.

## Custom Attributes (global scope)

Attach app-level identifiers (`userId`, `tenant`, feature flags, etc.) once and have them ride along every subsequent session and exception:

```ts
import {
  setAttribute,
  setAttributes,
  removeAttribute,
  clearAttributes,
} from "@tracewayapp/frontend";

setAttribute("user.id", "u_42");
setAttributes({ tenant: "acme", plan: "pro" });

// ...later, on logout / tenant switch:
clearAttributes();
```

Layering order on each event: `auto-collected defaults < global scope < per-call attributes`. Per-call exception attributes from `captureExceptionWithAttributes(err, { … })` still win over global keys on collision.

When sessions are enabled and the global scope changes mid-session, the SDK pushes a refresh upsert so the in-flight session row picks up the new attributes immediately rather than waiting for close.

The auto-collected defaults are: `url`, `path`, `referrer`, `userAgent`, `language`, `platform`, `viewport`, `screen`, `timezone`. The backend additionally stamps `client.ip` from the request.

## Distributed Tracing

Every `fetch` / `XHR` is an OpenTelemetry CLIENT span, and same-origin requests carry the W3C `traceparent` header, so
a backend instrumented with OpenTelemetry joins the same trace. List cross-origin API hosts in
`propagateTraceHeaderCorsUrls` (their CORS policy must allow the `traceparent` header). Axios and other libraries are
covered because they use fetch or XHR. 1.x's `traceway-trace-id` header, `getActiveDistributedTraceId()` and
`createAxiosInterceptor()` are gone.

## Source Maps

When you build for production, the browser stack traces are minified. Upload your source maps after each build so the dashboard can resolve them back to the original file:line:col:

```bash
npx @tracewayapp/sourcemap-upload \
  --url https://traceway.example.com \
  --token YOUR_SOURCE_MAP_TOKEN \
  --directory dist/assets
```

Maps are matched by filename, so there is nothing to configure at runtime. See [`@tracewayapp/sourcemap-upload`](https://www.npmjs.com/package/@tracewayapp/sourcemap-upload) for the full CLI reference.

For exact build-to-map matching, add [`@tracewayapp/bundler-plugin`](https://www.npmjs.com/package/@tracewayapp/bundler-plugin) to your Vite, Rollup, or webpack config. It embeds an ECMA-426 debug ID into each bundle and its map; the SDK picks the IDs up at runtime automatically and reports them with every exception, so frames resolve against the map from the exact build that threw, immune to filename collisions and concurrent deploys.

## API

| Function | Description |
|----------|-------------|
| `init(connectionString, options?)` | Start the SDK (a second call is a no-op until `shutdown()`) |
| `captureException(error, attributes?)` | Capture an error |
| `captureExceptionWithAttributes(error, attributes?)` | Same as `captureException` |
| `captureMessage(message, attributes?)` | Capture a message issue |
| `recordAction(category, name, data?)` | Record a breadcrumb triggers can match |
| `track(eventName, attributes?)` | Record a named app event triggers can match |
| `setAttribute(key, value)` / `setAttributes(map)` | Attach attributes to every later exception and the session; also used to target remote rules |
| `removeAttribute(key)` / `clearAttributes()` | Drop global attributes |
| `refreshConfig()` | Fetch remote settings now, e.g. right after login |
| `flush(timeoutMs?)` | Send what is queued; buffered telemetry stays on the device |
| `shutdown()` | Flush and remove all instrumentation |
| `getInstanceId()` | This browser profile's id (`service.instance.id`), which the dashboard can capture |

## Browser support and persistence

The browser SDK needs modern JavaScript, Fetch, and Web Crypto. IndexedDB and Web Locks are used when available;
blocked storage falls back to memory. Replay uploads use `fflate` for gzip and do not require `CompressionStream`.

Buffered telemetry shares one byte/age budget across pages. IndexedDB stores it per session, with a bounded
sessionStorage navigation checkpoint because unload-time asynchronous writes can be abandoned. Replay segments
stay in memory. Failed OTLP exports retry with backoff and on connectivity recovery; durable delivery is best effort
under storage quotas, browser termination, and permanent server rejection.

Remote capture cancellation takes effect at the next successful poll. Input-masking changes restart rrweb and discard
incompatible buffered replay. Collection limits are checked again before queued and restored telemetry is exported.
See the [remote settings reference](https://docs.tracewayapp.com/learn/remote-config/reference) for limits and timing.

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

## Local configuration without OpAMP

The browser SDK supports both static collection policies and Traceway-managed policies. To use only OpenTelemetry, pass an options object to `init` instead of a Traceway connection string:

```ts
import { init, metric, count } from '@tracewayapp/frontend';

init({
  serviceName: 'shop-web',
  telemetry: { url: 'https://collector.example.com/otlp' },
  exportDelayMs: 2000,
  collection: {
    signals: {
      errors: { mode: 'stream' },
      console: { mode: 'stream', minSeverity: 'warn' },
      network: { mode: 'stream', sampleRate: 0.25 },
      custom: { mode: 'stream' },
      resourceTiming: { mode: 'off' },
    },
    metrics: { enabled: true, sampleRate: 1, flushSeconds: 30 },
    buffer: { persist: false, maxAgeSeconds: 60 },
    triggers: [{ id: 'default-exception', enabled: false }],
  },
});

metric('checkout.duration', 840, { plan: 'pro' });
count('checkout.completed');
```

No Traceway server, account, or token is required. Standalone mode disables OpAMP, legacy fallback, Traceway session metadata, and replay uploads, even if those options are enabled. A local session ID still supports sampling and telemetry correlation. Exceptions are ordinary OTLP logs sent to your collector. The SDK retains its error filters and collection defaults; set `ignoreErrors: []` to remove the built-in error filters.

`collection` is a typed partial settings document (`CollectionSettings`). It controls signal modes (`off`, `buffer`, `stream`), sampling, console severity, metrics, buffer retention, replay, and local triggers. Omitted fields retain SDK defaults: most breadcrumbs are buffered, errors stream, and metrics flush every 300 seconds. Triggers merge by ID; disable `default-exception` explicitly to stop automatic lookback uploads. `exportDelayMs` controls log/span batching; `collection.metrics.flushSeconds` controls metric uploads (clamped to 30–3600 seconds). `flush()` sends queued exports and metrics, but does not release buffered events; a trigger's `flush` action releases those.

With a Traceway connection string, use `remoteConfig: false` and `collection` for static configuration while retaining Traceway exceptions and replay. No cached remote policy is read and no OpAMP request is sent. With remote config enabled, precedence is built-in defaults → local `collection` → cached/live remote overlay → `capture*`, `sessions`, and `sessionRecording` ceilings. Triggers and captures also respect those ceilings.

## Traceway exceptions and replay, external logs and metrics

Keep Traceway's control plane and replay storage while exporting ordinary logs, spans, and metrics to another OTLP backend:

```ts
import { init } from '@tracewayapp/frontend';

init('PROJECT_TOKEN@https://traceway.example.com', {
  serviceName: 'shop-web',
  telemetry: {
    url: 'https://collector.example.com/otlp',
    // Optional overrides use complete signal URLs, with no path appended.
    metrics: { url: 'https://metrics.example.com/v1/metrics' },
    logs: { url: 'https://logs.example.com/v1/logs' },
  },
  collection: {
    signals: { console: { mode: 'stream' }, network: { mode: 'stream' } },
    metrics: { flushSeconds: 30 },
  },
});
```

A shared `telemetry.url` appends `/v1/logs`, `/v1/traces`, and `/v1/metrics`. Each signal can override it with `{ url, headers }`. Without a shared base, unspecified signals keep their Traceway destination; standalone mode requires a base or all three signal URLs. URLs must use HTTP(S), without embedded credentials, a query, or a fragment. Signal headers override shared `telemetry.headers`; Traceway's token is never added to external requests.

When logs are redirected, exception events, `captureMessage` issues, and SDK control/session metadata go only to Traceway. Ordinary console/custom/performance logs go to the logs receiver; network spans and metrics use their own destinations. OpAMP and rrweb recordings keep using the Traceway connection string. This lets an OTLP Collector forward telemetry to a Grafana stack while Traceway stores issues and replays. External breadcrumbs are not copied into Traceway's session timeline. Both destinations retain `session.id` for correlation. Replay is Traceway-specific, outside OTLP.

Live exports, restored buffers, and retries use the configured signal destinations and credentials. Persistent telemetry queues and pending metric batches are isolated by destination. Custom `logExporter`/`spanExporter` overrides replace the corresponding live telemetry exporter; Traceway's issue/session routing still applies, and persisted records use the configured HTTP destinations.

The receiver must support OTLP/HTTP JSON, allow your application's origin, POST, and configured headers through CORS. See the [OpenTelemetry browser exporter guide](https://opentelemetry.io/docs/languages/js/exporters/). Use browser-safe ingestion credentials or your own ingestion proxy; keep backend credentials on the collector. Metrics use delta counters and exponential histograms, so configure the downstream pipeline to accept or convert those types.

These options apply to the 2.x browser SDK and its React, Vue, Svelte, and jQuery wrappers. Their `connectionString` argument/prop also accepts the standalone options object. React Native still uses the separate native reporting transport.

## Production collection policy

Production defaults keep session lifecycle metadata and performance metrics on, with healthy breadcrumbs, web vital events and replay buffered locally. An accepted exception uploads up to 10 minutes of buffered breadcrumbs and a 30-second replay clip; no full-session replay is uploaded by default. Error clips have a 5-second cooldown and a limit of 20 per session.

Errors are not sampled by default. Duplicate exceptions (same type, message and stack) within 1 second are suppressed, and each running client accepts at most 60 errors in a rolling minute. The next accepted error carries the aggregate `traceway.error.suppressed_count`. Configure `errorLimits: { maxPerMinute: 60, duplicateWindowMs: 1000 }` to tune these limits; they reset when the SDK is recreated.

For an optional stable sample of healthy-session breadcrumbs and request spans, use `baselineSampleRate: 0.01` (1%). The default is 0. Selection uses the session ID and persists across page reloads within that session. It does not enable replay or override explicitly disabled signals, signal filters, or exporter limits. Web vitals remain enabled independently, so performance diagnosis is not restricted to sessions with errors.

### Older Traceway servers

The default transport probes OpAMP before exporting. A missing endpoint (404, 405, or 501) selects the legacy
`/api/report` protocol for exceptions, messages, sessions, replay, and replay breadcrumbs. Existing connection
strings ending in `/api/report` continue to work. Exception clips travel in the same report as their exception,
which older servers require to link replay correctly.

A cross-origin server without an OpAMP CORS route appears to browsers as a network failure. The initial failure
also selects legacy reporting, while OpAMP retries with backoff. A later successful handshake switches to OTLP
and remote settings. Once OpAMP has connected, a temporary outage keeps the last applied settings and OTLP
transport. Authentication failures do not select legacy mode. Explicit external `telemetry` destinations are not
automatically redirected to `/api/report`.

For a known older server, use `transport: "legacy"` to skip OpAMP entirely. If you disable `remoteConfig`, automatic
server detection is disabled too; set `transport: "legacy"` when using that option with an older server.

## Performance metrics

Web vitals, route changes, main-thread blocking, requests, page views and errors are aggregated on the device into
histograms and counters, and uploaded as one small payload when the page is hidden, at session end, and every five
minutes. The detailed events behind them stay on the device until a trigger or a capture asks for them. A payload
that fails to upload, or whose page goes away before the server answers, is kept in `localStorage` (three payloads,
64 KB, 24 hours at most) and sent once more on the next page load; after that it is dropped.

```ts
import { metric, count, setRoute } from "@tracewayapp/frontend";

setRoute("/orders/:id"); // name the page by its route template; without it the path is normalized
metric("checkout.duration", 840, { plan: "pro" }); // a custom distribution, at most two dimensions
count("cart.item_added");
setMetricDimension("plan", "pro"); // on every metric from now on; at most two keys, never a user id
```

Besides the web vitals of the page load, INP and CLS are measured per view (`browser.view.inp`,
`browser.view.cls`), so a route reached by a single-page-app navigation has its own numbers. A slow LCP, INP or CLS
also reports the element behind it as a short CSS selector, and long animation frames report the time each script
took. "Users affected" comes from counters the device deduplicates itself: a browser profile is counted once per UTC
day, and once per day for each kind of trouble (an error, a poor vital, a rage click, a failed request). No user or
device id is sent; a browser without `localStorage` is left out of those counts. `metricDimensions` in `init()`
sets the dimensions of your own from the start.

`@tracewayapp/react` has `useTracewayRoute(template)`, `@tracewayapp/vue` has `trackRouter(router)` and
`@tracewayapp/svelte` has `trackRoute(routeId)`. Set `captureMetrics: false` to send none of it.
