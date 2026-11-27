<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/frontend"><img src="https://img.shields.io/npm/v/@tracewayapp/frontend.svg" alt="npm"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway Browser SDK

Error tracking, session replay and performance metrics for browser apps, built on OpenTelemetry. Capture exceptions with full stack traces and the events leading up to them. The default exception trigger can upload up to ten minutes of breadcrumbs and a 30-second rrweb replay clip.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

This is the framework-agnostic browser SDK. Use it directly in vanilla JS / TS, or pick a thin framework wrapper that initializes it for you: [`@tracewayapp/react`](https://www.npmjs.com/package/@tracewayapp/react), [`@tracewayapp/vue`](https://www.npmjs.com/package/@tracewayapp/vue), [`@tracewayapp/svelte`](https://www.npmjs.com/package/@tracewayapp/svelte), [`@tracewayapp/jquery`](https://www.npmjs.com/package/@tracewayapp/jquery).

## Features

- Automatic capture of `window.onerror` and `unhandledrejection`
- Built on OpenTelemetry: OTLP/HTTP logs, spans and metrics, with the Browser SIG's instrumentations
- **rrweb session replay** — an error clip by default; stream whole sessions with `recordAllSessions` or a remote rule
- **Privacy masks** — `class="traceway-mask"` replays text as `*` and images as empty boxes, `class="traceway-blank"` replays an empty box; input values are masked by default
- **Breadcrumbs** — console and `log()` lines, `fetch` / XHR, navigation, clicks and custom events, kept on the device and uploaded with an error
- **Sessions** — the start, end and attributes of every session, reported by default
- **Performance metrics** — web vitals, route changes, requests, page views and errors aggregated on the device and uploaded as one small payload, plus your own `metric()` and `count()`
- **Web vital events**, kept on the device like the other breadcrumbs
- **Resource timing**, **long task** and **route change timing** events, off until `collection`, a remote rule, a trigger or a capture turns them on
- **Auto-collected attributes** — `url`, `path`, `referrer`, `userAgent`, `language`, `platform`, `viewport`, `screen`, `timezone` stamped on every session, exception and message
- **Global attribute scope** — `setAttribute("user.id", "42")` and friends to attach app-level identifiers (tenant, user id, feature flag) to every subsequent session, exception and message
- Distributed tracing — `fetch` / XHR spans with the W3C `traceparent` header
- Source-map resolution on the backend (see [`@tracewayapp/sourcemap-upload`](https://www.npmjs.com/package/@tracewayapp/sourcemap-upload))
- Failed OTLP batches wait in IndexedDB and retry in the current page, on connectivity recovery, and on later pages
- Remote control — Traceway decides over OpAMP what each group of clients sends, buffers or drops; or keep a local `collection` policy
- Simple one-line setup

Upgrading a browser app? See the [migration guide from v1 to v2 and the three browser setups](https://github.com/tracewayapp/js-client/blob/main/README.md#migration-guide-from-v1-to-v2), or the same guide in the [docs](https://docs.tracewayapp.com/client/js-sdk/migration).

## Installation

```bash
npm install @tracewayapp/frontend
```

This installs 2.x. Append `@2` to pin the major, or `@1` to stay on the 1.x SDK ([1.x reference](https://docs.tracewayapp.com/client/js-sdk/v1)).

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

// Initialize once at app startup; a second call is ignored until shutdown()
init("your-token@https://traceway.example.com/api/report");

// Capture errors
try {
  riskyOperation();
} catch (error) {
  captureException(error);
}

// Capture custom messages
captureMessage("User completed checkout");

// Record a custom breadcrumb; it stays on the device and is uploaded with the next exception
recordAction("checkout", "payment_submitted", { amount: 42 });

// Send what is queued now, e.g. before a redirect your code performs
await flush();
```

The connection string is `token@url`. The URL is the Traceway server, with or without a trailing `/api/report`.

`init()` automatically installs `window.onerror` and `unhandledrejection` handlers, patches `console.*`, instruments `fetch` / `XMLHttpRequest`, navigation and clicks, measures web vitals, and starts an rrweb session recorder unless replay is off. A captured exception uploads the breadcrumbs and the replay clip buffered before it.

`flush()` sends the queued logs, spans and replay uploads and the pending performance metrics. It does not release buffered breadcrumbs, and it does not end the session or stop the recorder. The SDK sends what is queued by itself when the page is hidden, so you only need `flush()` where your code navigates away or must wait for delivery.

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
  captureException(e);
}

// Capture with attributes (string key-value tags)
try {
  await riskyOperation();
} catch (e) {
  captureException(e, { tenant: "acme", region: "us-east" });
  // The same call under its 1.x name:
  captureExceptionWithAttributes(e, { tenant: "acme", region: "us-east" });
}

// Capture a message, optionally with attributes
captureMessage("User completed checkout", { plan: "pro" });

// Send what is queued
await flush();
```

### Logs

`log(message, level?, attributes?)` records a log line of your own. The level is a `TracewayLogLevel`: `"trace"`,
`"debug"`, `"info"` (the default), `"warn"`, `"error"` or `"fatal"`. Attribute values are strings, numbers or booleans.

```ts
import { log } from "@tracewayapp/frontend";

log("cart synced", "debug", { items: 3 });
log("payment provider slow", "warn", { provider: "stripe" });
```

A `log()` line is handled like a `console.*` line. It belongs to the console signal, so it is kept on the device by
default and uploaded with an error, the console `minSeverity` applies (default `info`: the `debug` line above is
dropped), remote rules can stream it or switch it off, and `captureLogs: false` turns it off. On the wire it is an
OpenTelemetry log record without an event name: the body is the message, the severity number and text come from the
level (trace 1 `TRACE`, debug 5 `DEBUG`, info 9 `INFO`, warn 13 `WARN`, error 17 `ERROR`, fatal 21 `FATAL`), and the
attributes are the global ones, then yours, then `log.source = "api"`. Use `captureMessage` for a line that should
open an issue.

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `serviceName` | the page's host name | `service.name` of this app |
| `version` | none | `service.version`; rules can target releases with it |
| `environment` | none | `deployment.environment.name` |
| `attributes` | `{}` | Initial global attributes, see `setAttribute` |
| `debug` | `false` | Log the problems the SDK would otherwise swallow: rejected remote-config credentials and a `beforeCapture` that throws |
| `ignoreErrors` | `DEFAULT_IGNORE_PATTERNS` | `string \| RegExp` patterns matched against `Type: message`; matching exceptions and messages are dropped |
| `beforeCapture` | none | `({ type, message, stack, attributes }) => boolean`; return `false` to drop |
| `errorLimits` | `{ maxPerMinute: 60, duplicateWindowMs: 1000 }` | Per-client rolling error limit and duplicate suppression |
| `remoteConfig` | `true` | Fetch collection settings from Traceway over OpAMP (see below) |
| `collection` | SDK defaults | Local signal modes, sampling, triggers, buffer limits, and metric upload interval |
| `telemetry` | Traceway endpoints | OTLP/HTTP base URL, per-signal URLs, and headers; required in standalone mode |
| `transport` | `"auto"` | Detect older servers and use `/api/report`; `"legacy"` forces that protocol, `"otlp"` disables fallback |
| `exportDelayMs` | `1000` | Delay between log and span exports (ms) |
| `sessions` | `true` | Report session start and end |
| `sessionRecording` | `true` | Allow rrweb session replay at all |
| `sessionRecordingSegmentDuration` | `30000` | Replay segment length (ms) |
| `recordAllSessions` | `false` | Stream every replay segment and every breadcrumb by default instead of keeping them for error clips |
| `baselineSampleRate` | `0` | Stable healthy-session breadcrumb/request sample, from 0 to 1; does not stream replay |
| `collectionLimits` | `{ maxBytes: 52428800, maxEvents: 10000 }` | Shared per-session diagnostic upload ceiling; can only be lowered |
| `captureLogs`, `captureNetwork`, `captureNavigation`, `captureUserActions`, `captureWebVitals`, `captureResourceTiming`, `captureLongTasks`, `captureRouteTiming` | `true` | Allow a signal at all: console output and `log()` lines, `fetch` / XHR, navigation, clicks, web vital events, resource and navigation timing, long tasks, route change timing |
| `captureMetrics` | `true` | Performance metrics: histograms and counters aggregated on the device, one small upload per flush |
| `metricDimensions` | none | Up to two dimensions of your own on every performance metric, e.g. `{ plan: "pro" }`; never a user id |
| `captureHttpServerErrors` | `false` | Report fetch / XHR responses with status >= 500 as message issues |
| `propagateTraceHeaderCorsUrls` | none | Cross-origin URLs that get the W3C `traceparent` header (same-origin requests always do) |
| `logExporter`, `spanExporter` | none | Advanced: replace the OTLP/HTTP exporter of logs or spans, e.g. with an in-memory exporter in tests |

The `capture*`, `sessionRecording` and `sessions` options are **ceilings**: collection settings, local or remote, can switch
a signal off or keep it on the device, but never turn on what `init()` turned off. A ceiling that is left on does not
start a signal by itself: the events of resource timing, long tasks and route timing are `off` in the default collection
settings until `collection`, a rule, a trigger or a capture turns them on. The `DEFAULT_IGNORE_PATTERNS` export contains
the built-in `ignoreErrors` list.

The 1.x options `debounceMs`, `retryDelayMs`, `eventsWindowMs` and `eventsMaxCount` no longer exist: `exportDelayMs`
sets the export delay, the SDK manages retries itself, and retention is set with `collection.buffer.maxAgeSeconds` and
`collection.buffer.maxBytes`.

## Remote control

Each signal is in one of three modes: **stream** (sent right away), **buffer** (kept on the device and uploaded only
when a trigger fires or the dashboard starts a capture) or **off**. By default, errors and messages stream. The SDK buffers console, network, navigation, clicks, custom events, web vital events, and replay; resource timing, long task and route timing events are off. The default exception trigger uploads up to ten minutes of breadcrumbs and a 30-second replay clip with an error; the clip has a 5-second cooldown and a limit of 20 per session.

On the **Data Collection** page in the project's sidebar you write rules that target clients by what they report: release
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

Console calls, `log()` lines, `fetch` / XHR, route changes, clicks and `recordAction` / `track` events are recorded as OpenTelemetry
log records and spans, tagged with the session. By default they are **buffered** on the device: an error uploads the
last 10 minutes of breadcrumbs and a 30-second replay clip with the exception, and the replay player shows them next to the recording. With
`recordAllSessions`, or when remote settings say so, they stream; remote settings can also switch them off. Replay
segments carry only the recording, so each breadcrumb is uploaded once.

rrweb session replay runs only when replay is not off (it is loaded lazily, so a page with replay off never downloads
it). Each segment replays on its own; buffered segments upload with an error clip, streamed segments upload as they
complete. Replay goes to Traceway's recordings endpoint, not OTLP.

### Privacy masks

Mark the parts of the page the replay must not show with a class in your markup; no code is needed. Masking happens
in the browser, before anything is uploaded.

| Class | What the replay shows |
|-------|-----------------------|
| `traceway-mask` | The element and its layout. Text inside it is recorded with every character except whitespace replaced by `*`. `img`, `picture`, `video`, `canvas` and `svg` elements inside it, or carrying the class themselves, are recorded as empty boxes of their size, without their source URL or content |
| `traceway-blank` | An empty box of the element's size. Nothing inside it is recorded: no text, no images, no input values or input events |

```html
<p class="traceway-mask">Card ending 4242, Alice Smith</p>
<!-- replays as: **** ****** ***** ***** ***** -->
<div class="traceway-mask"><img src="/avatars/42.jpg"> Alice Smith</div>
<div class="traceway-blank"><canvas id="signature"></canvas></div>
```

rrweb's own classes keep working next to them: `rr-mask` masks text like `traceway-mask` but leaves images as they
are, `rr-block` records an empty box like `traceway-blank`, and `rr-ignore` stops recording an input's events.

Input values follow `maskAllInputs` (on by default; set it in `collection.replay` or with a remote rule): with it on,
the value of every `input`, `textarea` and `select` is recorded as `*`; with it off, only passwords are. A field that
must stay hidden even then belongs inside `traceway-blank`. Images outside a mask are not uploaded: the replay loads
them from their URLs when it plays.

## Custom Attributes (global scope)

Attach app-level identifiers (`user.id`, `tenant`, feature flags, etc.) once and have them ride along every subsequent session, exception and message. Values are strings. Use the key `user.id` for the user, so captures and rules can target it:

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

Layering order on each event: `auto-collected defaults < global scope < per-call attributes`. Per-call attributes from `captureException(err, { … })` still win over global keys on collision.

When sessions are enabled and the global scope changes mid-session, the SDK pushes a refresh upsert so the in-flight session row picks up the new attributes immediately rather than waiting for close.

The auto-collected defaults are: `url`, `path`, `referrer`, `userAgent`, `language`, `platform`, `viewport`, `screen`, `timezone`. The backend additionally stamps `client.ip` from the request.

## Distributed Tracing

Every `fetch` / `XHR` is an OpenTelemetry CLIENT span, and same-origin requests carry the W3C `traceparent` header, so
a backend instrumented with OpenTelemetry joins the same trace. List cross-origin API hosts in
`propagateTraceHeaderCorsUrls` (their CORS policy must allow the `traceparent` header). Axios and other libraries are
covered because they use fetch or XHR. 1.x's `traceway-trace-id` header, `getActiveDistributedTraceId()` and
`createAxiosInterceptor()` are gone.

To tie several steps of one user action together, `startInteraction(name)` starts a span and returns
`{ traceId, run, bind, captureException, end }` (`undefined` before `init()`). Requests started while a `run(callback)`
or a `bind(callback)` function executes, and errors reported with its `captureException`, join that trace. The context
is not carried across an `await`, so wrap each later step in another `run`. Call `end()` when the action is over.

## Performance metrics

Web vitals, route changes, main-thread blocking, requests, page views and errors are aggregated on the device into
histograms and counters, and uploaded as one small payload when the page is hidden, at session end, and every five
minutes. The detailed events behind them stay on the device until a trigger or a capture asks for them. A payload
that fails to upload, or whose page goes away before the server answers, is kept in `localStorage` (three payloads,
64 KB, 24 hours at most) and sent once more on the next page load; after that it is dropped.

```ts
import { metric, count, setRoute, setMetricDimension } from "@tracewayapp/frontend";

setRoute("/orders/:id"); // name the page yourself; without it the app's router or the normalized path names it
metric("checkout.duration", 840, { plan: "pro" }); // a custom distribution, at most two dimensions
count("cart.item_added");
setMetricDimension("plan", "pro"); // on every metric from now on; at most two keys, never a user id
```

Besides the web vitals of the page load, INP and CLS are measured per view (`browser.view.inp`,
`browser.view.cls`), so a route reached by a single-page-app navigation has its own numbers. A slow LCP, INP or CLS
also reports the element behind it as a short CSS selector that stays the same across renders: ids that look
generated and utility classes are left out in favour of `data-testid`, `data-slot`, `name`, `role` and plain class
names, and nothing the user typed or reads is used. Give the controls people use a `data-testid` and a slow interaction
names them, for example `button[data-testid="place-order"]`. The element is named as it is clicked or typed in, so a
control that removes itself (a deleted row, a menu item) is still named. A slow interaction also reports which part took longest (input
delay, processing or presentation) and, where the browser names it, the longest script. Long animation frames
report the time each script took. "Users affected" comes from counters the device deduplicates itself: a browser
profile is counted once per UTC day, and once per day for each kind of trouble (an error, a poor vital, a rage click,
a failed request). No user or device id is sent; a browser without `localStorage` is left out of those counts.
`metricDimensions` in `init()` sets the dimensions of your own from the start.

**Elements regroup once.** Versions up to 2.0.2 named the element with the web-vitals library's selector, which keeps
generated ids and every class. After upgrading, web vitals attributed to an element (`browser.web_vital.target` and
the `browser.web_vital.attribution` counter) start new groups once, and from then on stay the same across renders
and releases.

Set `captureMetrics: false` to send none of it. See [Client Metrics](https://docs.tracewayapp.com/learn/client-metrics).

### Route names

Metrics are grouped by page, and a page is named by its route template (`/orders/:id`), so two orders are one
series. The SDK takes the template from the app's router wherever the router can be read from the page, and a
name set with `setRoute` wins over it:

| Router | What names the route |
| --- | --- |
| React Router in framework mode, Remix | Nothing to do: the SDK reads the router from the page |
| TanStack Router | Nothing to do |
| Next.js Pages Router | Nothing to do |
| Vue Router, Nuxt | Nothing to do |
| React Router `createBrowserRouter` | `trackRouter(router)`, or `<TracewayProvider router={router}>` |
| React Router `<BrowserRouter>` and `<Routes>` | `useTracewayRoute(useLocation().pathname, useParams())` in a layout route |
| Next.js App Router | `useTracewayRoute(usePathname(), useParams())` in a client component of the root layout |
| SvelteKit | `$effect(() => { page.url.pathname; trackRoute(page.route.id); })` in the root layout |
| Anything else | `setRoute("/orders/:id")`, or nothing: id-like path segments are replaced (`/orders/8841` becomes `/orders/:id`) |

`trackRouter(router)` takes a React Router data router, a TanStack Router, a Vue Router or the Next.js Pages Router
and may be called before `init()`. `routeFromParams(pathname, params)` is what `useTracewayRoute` uses to rebuild
a template from a path and its params. A view is only named after a route the router is showing for that view's
path. A match with an unreported base or locale prefix is provisional and checked again as the router catches up. `detectRoutes: false` in `init()` switches the
reading of routers off.

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

Production defaults keep session lifecycle metadata and performance metrics on, with healthy breadcrumbs, web vital events and replay buffered locally. An accepted exception uploads up to 10 minutes of buffered breadcrumbs and a 30-second replay clip; no full-session replay is uploaded by default. Error clips have a 5-second cooldown and a limit of 20 per session; an error inside the cooldown or past the limit still uploads its breadcrumbs.

Errors are not sampled by default. Duplicate exceptions (same type, message and stack) within 1 second are suppressed, and each running client accepts at most 60 errors in a rolling minute. The next accepted error carries the aggregate `traceway.error.suppressed_count`. Configure `errorLimits: { maxPerMinute: 60, duplicateWindowMs: 1000 }` to tune these limits: `maxPerMinute` is held between 1 and 1000, `duplicateWindowMs` is at most 60000, and 0 turns duplicate suppression off. The counts reset when the SDK is recreated. Messages are not limited.

For an optional stable sample of healthy-session breadcrumbs and request spans, use `baselineSampleRate: 0.01` (1%). The default is 0. Selection uses the session ID and persists across page reloads within that session. It does not enable replay or override explicitly disabled signals, signal filters, or exporter limits. Performance metrics are uploaded independently of it, so performance diagnosis is not restricted to sessions with errors.

## Older Traceway servers

The default transport probes OpAMP before exporting. A missing endpoint (404, 405, or 501) selects the legacy
`/api/report` protocol for exceptions, messages, sessions, replay, and replay breadcrumbs. Existing connection
strings ending in `/api/report` continue to work. Exception clips travel in the same report as their exception,
which older servers require to link replay correctly.

A cross-origin server without an OpAMP CORS route appears to browsers as a network failure. The initial failure
also selects legacy reporting, while OpAMP retries with backoff. A later successful handshake switches to OTLP
and remote settings. Once OpAMP has connected, a temporary outage keeps the last applied settings and OTLP
transport. Authentication failures do not select legacy mode. Explicit external `telemetry` destinations are not
automatically redirected to `/api/report`, and `telemetry` cannot be combined with `transport: "legacy"`. Request
spans and performance metrics are not sent while the legacy protocol is in use.

For a known older server, use `transport: "legacy"` to skip OpAMP entirely. If you disable `remoteConfig`, automatic
server detection is disabled too; set `transport: "legacy"` when using that option with an older server.

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
| `init(connectionString, options?)` | Start the SDK (a second call is a no-op until `shutdown()`). `init(options)` with a single options object starts standalone mode |
| `captureException(error, attributes?)` | Capture an error, optionally with string attributes |
| `captureExceptionWithAttributes(error, attributes?)` | Same as `captureException` |
| `captureMessage(message, attributes?)` | Capture a message issue |
| `log(message, level?, attributes?)` | Record a log line; `level` is `"trace"`, `"debug"`, `"info"` (default), `"warn"`, `"error"` or `"fatal"`. See [Logs](#logs) |
| `recordAction(category, name, data?)` | Record a breadcrumb triggers can match |
| `track(eventName, attributes?)` | Record a named app event triggers can match |
| `metric(name, value, dims?)` | Record one observation of a custom distribution; at most two dimensions |
| `count(name, n?, dims?)` | Add to a custom counter |
| `setRoute(template)` | Name the page by its route template, e.g. `/orders/:id`; `null` goes back to the router's name or the normalized path |
| `trackRouter(router)` | Name every page from this router's route templates. See [Route names](#route-names) |
| `routeFromParams(pathname, params)` | Rebuild a route template from a path and the params a router matched in it |
| `setMetricDimension(key, value)` | Set a dimension of your own on every performance metric from now on; `null` removes it |
| `startInteraction(name)` | Start a span for one user action; returns `{ traceId, run, bind, captureException, end }`, or `undefined` before `init()` |
| `setAttribute(key, value)` / `setAttributes(map)` | Attach attributes to every later exception and message and to the session; also used to target remote rules |
| `removeAttribute(key)` / `clearAttributes()` | Drop global attributes |
| `refreshConfig()` | Fetch remote settings now, e.g. right after login |
| `flush(timeoutMs?)` | Send what is queued, including pending metrics; buffered telemetry stays on the device |
| `shutdown()` | Flush, remove all instrumentation and stop recording; `init()` may be called again afterwards |
| `getInstanceId()` | This browser profile's id (`service.instance.id`), which the dashboard can capture |
| `currentSessionId()` | The current session's id (`session.id`), or `null` before `init()` and between sessions |
| `getClient()` | The running `TracewayFrontendClient`, or `null` before `init()` |

Also exported: `DEFAULT_IGNORE_PATTERNS`, `SDK_VERSION`, the `TracewayFrontendClient` class, and the types
`TracewayFrontendOptions`, `StandaloneOptions`, `TelemetryOptions`, `TelemetryEndpoint`, `CapturedException`,
`TracewayLogLevel`, `CollectionSettings`, `Settings`, `Trigger`, `TriggerAction`, `Capture`, `Mode` and `SignalName`.

## Browser support and persistence

The browser SDK needs modern JavaScript and Fetch. Web Crypto, IndexedDB and Web Locks are used when available;
blocked storage falls back to memory. Web vitals are measured in browsers that have `Array.prototype.at` (Chrome 92,
Safari 15.4 and later). Replay uploads use `fflate` for gzip and do not require `CompressionStream`.

Buffered telemetry shares one byte/age budget across pages. IndexedDB stores it per session, with a bounded
sessionStorage navigation checkpoint because unload-time asynchronous writes can be abandoned. Replay segments
stay in memory. Failed OTLP exports retry with backoff and on connectivity recovery; durable delivery is best effort
under storage quotas, browser termination, and permanent server rejection.

Remote capture cancellation takes effect at the next successful poll. Input-masking changes restart rrweb and discard
incompatible buffered replay. Collection limits are checked again before queued and restored telemetry is exported.
See the [remote settings reference](https://docs.tracewayapp.com/learn/remote-config/reference) for limits and timing.

## Platform differences

The browser SDK and the Traceway app SDKs (Flutter, Android, iOS) use the same names and send the same records.
What differs:

- **Only in the browser**: replay is an rrweb recording of the page's DOM, where the apps record wireframes of
  their views (Flutter can also record video). Masks are classes in the markup (`traceway-mask`, `traceway-blank`,
  rrweb's `rr-*`), not a mask API with `TracewayMaskMode`. Navigation is recorded from the History API and route
  templates are read from the app's router (`trackRouter`, `routeFromParams`), so there is no `recordNavigation`.
  `console.*` is captured automatically. Web vital, resource timing, long task and route change timing events,
  `captureHttpServerErrors`, `startInteraction(name).bind`, and `transport` with its `/api/report` fallback for
  older servers exist only here.
- **Only in the apps**: process-ending crash capture with native symbolication, `recordNavigation`,
  `reportFullyDisplayed()` and the `app.*` performance metrics (app start, slow and frozen frames, hangs; Android and
  Flutter today), the mask API (`TracewayMask`, `View.tracewayMask`, `UIView.tracewayMask`, `.tracewayMask(_:)`)
  with its blur and blank modes, the replay image policy (`replayImages`, `replay.images`, which the browser
  ignores), the frame options (`screenCapture`, `fps`, `maxBufferFrames`), and `legacyConnectionString`, which
  delivers reports a 1.x app left on the device.
- **Same feature, browser idiom**: the start call is `init` (Flutter `Traceway.run`, iOS `Traceway.initialize`);
  `getInstanceId()` and `currentSessionId()` are functions (iOS has the properties `instanceId` and
  `currentSessionId`); `flush(timeoutMs?)` takes milliseconds (Swift `flush(timeout:)` takes seconds);
  cross-origin trace headers are set with `propagateTraceHeaderCorsUrls` (apps: `propagateTraceHeaderUrls`).

For React Native and Expo apps, use [`@tracewayapp/react-native`](https://www.npmjs.com/package/@tracewayapp/react-native) instead. It shares the version number but not this SDK: it keeps its own API and the native reporting transport, captures exceptions with console logs and network and navigation actions, and has no session replay, remote config or OTLP export.

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com/client/js-sdk)
- [Remote SDK config](https://docs.tracewayapp.com/learn/remote-config)
- [React wrapper](https://www.npmjs.com/package/@tracewayapp/react)
- [Vue wrapper](https://www.npmjs.com/package/@tracewayapp/vue)
- [Svelte wrapper](https://www.npmjs.com/package/@tracewayapp/svelte)
- [jQuery wrapper](https://www.npmjs.com/package/@tracewayapp/jquery)
- [React Native SDK](https://www.npmjs.com/package/@tracewayapp/react-native)

## License

MIT
