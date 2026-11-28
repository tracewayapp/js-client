<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/vue"><img src="https://img.shields.io/npm/v/@tracewayapp/vue.svg" alt="npm"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway Vue SDK

Error tracking and session replay for Vue 3 apps. Provides a plugin with a global `errorHandler`, a `useTraceway()` composable, and inherits the full instrumentation pipeline from [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend).

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

## Features

- Vue 3 plugin that registers a global `app.config.errorHandler` and runs `init()` once
- `useTraceway()` composable for capturing exceptions and messages and recording breadcrumbs from any component
- `trackRouter()` to group performance metrics by route, `useTracewayAttributes()` / `<TracewayAttributes>` to bind attributes such as `user.id`
- Inherits everything from [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend): rrweb session replay, breadcrumbs (console, `fetch` / XHR, navigation, clicks), performance metrics, W3C `traceparent` propagation, and collection settings you can change from the dashboard's **Data Collection** page
- Vue Router push/replace flows through the History API and is captured automatically
- Simple one-line setup

Upgrading from 1.x? See the [migration guide](https://docs.tracewayapp.com/client/js-sdk/migration).

## Installation

```bash
npm install @tracewayapp/vue
```

This installs 2.x. Use `@tracewayapp/vue@2` to pin the major, or `@tracewayapp/vue@1` to stay on 1.x.

## Quick Start

Install the plugin in your Vue application:

```ts
import { createApp } from "vue";
import { createTracewayPlugin } from "@tracewayapp/vue";
import App from "./App.vue";

const app = createApp(App);

app.use(createTracewayPlugin({
  token: import.meta.env.VITE_TRACEWAY_TOKEN,
}));

app.mount("#app");
```

`token` is the project token, here from `VITE_TRACEWAY_TOKEN`. The SDK sends to Traceway Cloud; for a self-hosted server, pass its address as `baseUrl` (`baseUrl: import.meta.env.VITE_TRACEWAY_URL`). Every other option of the browser SDK goes in `options`: `options: { version: "1.4.2", debug: true }`.

That's it. The plugin runs `init(...)` once, which installs the `window.onerror` and `unhandledrejection` handlers, instruments `console.*`, `fetch` / `XHR`, the History API and clicks, and starts the rrweb recorder. The plugin also assigns a global Vue `errorHandler`, so errors thrown in components, watchers and lifecycle hooks are captured.

By default errors and messages are sent as they happen, and session start and end are reported for every visit. Console output, requests, navigation, clicks and the replay stay on the device: a captured error uploads up to 10 minutes of those breadcrumbs and a 30-second replay clip.

### Upgrading from 2.0

The `connectionString` field of 2.0 still works, but it is deprecated and logs one warning that names the new form: `connectionString: "token@https://host/api/report"` becomes `token: "token", baseUrl: "https://host"`, and for Traceway Cloud just `token: "token"`. Every variation of the old string keeps working (with or without `/api` or `/api/report`, a trailing slash, a query string, without a scheme, a server under a sub-path), and `baseUrl` is read the same way. The `transport` option is deprecated and ignored: the SDK always sends OTLP.

## Manual Capture

```vue
<script setup>
import { useTraceway } from "@tracewayapp/vue";

const { captureException, captureMessage } = useTraceway();

async function handleSubmit() {
  try {
    await submitForm();
  } catch (error) {
    captureException(error);
  }
}
</script>

<template>
  <button @click="handleSubmit">Submit</button>
</template>
```

`captureException(error, attributes?)` and `captureMessage(message, attributes?)` take optional string attributes (`Record<string, string>`) for that one event.

The composable also returns `recordAction`, which records a custom breadcrumb for the replay timeline:

```ts
const { recordAction } = useTraceway();

recordAction("checkout", "payment_submitted", { amount: 42 });
```

Like the other breadcrumbs it stays on the device and is uploaded with the next error, unless `recordAllSessions` or a remote rule streams it.

### Outside components

Everything on the composable, and the rest of the browser SDK's API, is also exported from `@tracewayapp/vue` as plain functions, so stores, router guards and utilities do not need a second dependency on `@tracewayapp/frontend`:

```ts
import { captureException, track, metric, count, flush } from "@tracewayapp/vue";

track("checkout_failed", { step: "payment" });
metric("checkout.duration", 840, { plan: "pro" });
count("cart.item_added");
```

The exports are `captureException`, `captureExceptionWithAttributes`, `captureMessage`, `log`, `recordAction`, `track`, `metric`, `count`, `setMetricDimension`, `setRoute`, `recordNavigation`, `tracer`, `routeFromParams`, `startInteraction`, `setAttribute`, `setAttributes`, `removeAttribute`, `clearAttributes`, `refreshConfig`, `flush`, `shutdown`, `getInstanceId`, `currentSessionId`, `getClient`, `DEFAULT_IGNORE_PATTERNS` and `SDK_VERSION`: every value of `@tracewayapp/frontend` except `init` (the plugin calls it), the `TracewayFrontendClient` class and `trackRouter`, which this package has its own of (see [Route Names](#route-names)). Its types are all re-exported too: `TracewayFrontendOptions`, `StandaloneOptions`, `TelemetryOptions`, `TelemetryEndpoint`, `TracewayCapturedError` (`CapturedException` is its deprecated alias), `TracewayInteraction`, `TracewayLogLevel`, `ErrorLimits`, `CollectionLimits`, `Settings`, `CollectionSettings`, `Trigger`, `TriggerAction`, `Capture`, `Mode`, `SignalName`, `TracewayImagePolicy`, `RouteParams` and the event types `TracewayEvent`, `LogEvent`, `NetworkEvent`, `NavigationEvent` and `CustomEvent`. The functions do nothing until the plugin is installed. See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#api) for what each one does.

## Route Names

Performance metrics are grouped by page, and a page is named by its matched route pattern (`/orders/:id`), not by its URL. There is nothing to set up: the plugin takes Vue Router from the app it is installed in, whichever of the two is installed first, and Nuxt works the same way. Nuxt writes the patterns of its file routes with a trailing `()` (`pages/orders/[id].vue` is `/orders/:id()`, a catch-all is `/docs/:slug(.*)*`), and that is the name the page gets.

A router that is not installed in the app can be passed once, after creating it:

```ts
import { createRouter, createWebHistory } from "vue-router";
import { trackRouter } from "@tracewayapp/vue";

const router = createRouter({ history: createWebHistory(), routes });
trackRouter(router);
```

This `trackRouter` is the Vue package's own: it sets the route name with `setRoute` after each navigation (`router.afterEach`), where the browser SDK's `trackRouter` reads the router itself. The plugin already reads the router installed next to it, so it is only needed for a router the app does not install. Without a router the SDK replaces id-like path segments itself.

## Custom Attributes (global scope)

Attach app-level identifiers (`user.id`, `tenant`, feature flags, etc.) once and have them ride along every subsequent session and exception. Attribute values are strings.

**Declarative — the `useTracewayAttributes` composable or `<TracewayAttributes>`.** Pass a getter, a ref or a plain map. The composable tracks reactive state, pushes only the keys that changed, and removes the keys it owns when the component unmounts:

```vue
<script setup>
import { useTracewayAttributes } from "@tracewayapp/vue";
import { useUser } from "./auth";

const { user, org } = useUser();
useTracewayAttributes(() =>
  user.value && org.value
    ? { "user.id": String(user.value.id), tenant: String(org.value.id) }
    : null
);
</script>
```

Return `null` (or `undefined`) when there is nothing to attach; the composable then removes the keys it had set. The component form does the same and renders nothing:

```vue
<script setup>
import { TracewayAttributes } from "@tracewayapp/vue";
import { useUser } from "./auth";

const { user, org } = useUser();
</script>

<template>
  <TracewayAttributes
    v-if="user && org"
    :attributes="{ 'user.id': String(user.id), tenant: String(org.id) }"
  />
</template>
```

Treat every key you pass to the composable or the component as owned by it: do not set the same key with `setAttribute` elsewhere, because the unmount cleanup removes it.

**Imperative — `setAttribute` / `setAttributes` / `removeAttribute` / `clearAttributes`.** Use these outside components (stores, router guards, init scripts):

```ts
import {
  setAttribute,
  setAttributes,
  removeAttribute,
  clearAttributes,
} from "@tracewayapp/vue";

setAttribute("user.id", "u_42");
setAttributes({ tenant: "acme", plan: "pro" });

// ...later, on logout / tenant switch:
removeAttribute("user.id");
removeAttribute("tenant");
```

`clearAttributes()` empties the whole global scope, so it also drops keys set by other parts of the app. Prefer `removeAttribute` per key, or `useTracewayAttributes`, unless that is what you want.

Layering order on each event: `auto-collected defaults < global scope < per-call attributes`. See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#custom-attributes-global-scope) for the full mechanics.

Remote rules and captures can target these attributes; `user.id` is the key to use for a user. After login, call `refreshConfig()` so a rule that targets the user applies at once instead of at the next poll.

## Always-on Session Recording

Pass `recordAllSessions: true` to stream every replay segment and breadcrumb as it is recorded, instead of keeping them on the device for error clips:

```ts
app.use(createTracewayPlugin({
  token: import.meta.env.VITE_TRACEWAY_TOKEN,
  options: { recordAllSessions: true, version: "1.0.0" },
}));
```

See [Session Replay](https://docs.tracewayapp.com/client/js-sdk/session-replay) for the full description.

## Distributed Tracing

Every `fetch` / `XHR` call is an OpenTelemetry CLIENT span, and same-origin requests carry the W3C `traceparent` header, so a backend instrumented with OpenTelemetry joins the same trace with no extra middleware. For an API on another origin, list it in `propagateTraceHeaderCorsUrls` (its CORS policy must allow the `traceparent` header): a string such as `"https://api.example.com/"` matches every URL that starts with it, a `RegExp` is tested against the URL. See [Distributed Tracing](https://docs.tracewayapp.com/client/js-sdk/distributed-tracing).

To tie the steps of one user action together, `startInteraction(name, attributes?)` returns a `TracewayInteraction` with `run`, `bind`, `setAttribute`, `captureException` and `end(failed?)`; see the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#distributed-tracing).

## Send telemetry to another OpenTelemetry provider

The `telemetry` option sends logs, traces and metrics to any OTLP/HTTP endpoint, while errors, replay, captures and remote config stay on Traceway: `options: { telemetry: { url: "https://collector.example.com" } }`. Without a `token` the SDK runs standalone and sends only there. See [Send telemetry to another OpenTelemetry provider](https://www.npmjs.com/package/@tracewayapp/frontend#send-telemetry-to-another-opentelemetry-provider).

## Options

The `options` field forwards directly to [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend). The most-used flags:

| Option | Default | Description |
|--------|---------|-------------|
| `version` | none | App version, reported as `service.version`. Groups releases, and remote rules can target it |
| `environment` | none | `deployment.environment.name`, e.g. `"production"` |
| `serviceName` | the page's host name | `service.name` of this app |
| `debug` | `false` | Logs with the page's own `console.warn`, so Traceway never records the lines: the start (`Traceway: started (…/api/otel/v1/logs), session …`), remote config applied, rejected or unavailable, every dropped exception or message and why (`ignoreErrors`, `beforeCapture`, `errorLimits`, the session upload budget `collectionLimits`), a repeated `init()`, the Vue plugin's caught errors, and SDK failures it contained |
| `ignoreErrors` | `DEFAULT_IGNORE_PATTERNS` | Patterns matched against `Type: message`; matching exceptions and messages are dropped. The defaults drop common network-failure, timeout and 4xx error messages. Pass `[]` to capture everything |
| `beforeCapture` | none | Receives `{ error, type, message, isMessage, stack, attributes }` (`TracewayCapturedError`); return `false` to drop. `error` is what was thrown or passed to `captureException`, undefined for a message |
| `sessionRecording` | `true` | Allow rrweb session replay at all |
| `replayImages` | `"always"` | The most the replay records of pictures (`"off"`, `"wifi"`, `"always"`): `replay.images`, from `collection` or a rule, applies only up to it |
| `collection.replay.maskAllInputs` | `true` | Record input values as `*`. Set to `true` here, no rule can switch it off |
| `recordAllSessions` | `false` | Stream every replay segment and breadcrumb instead of keeping them on the device for error clips |
| `sessions` | `true` | Report session start and end |
| `captureLogs` | `true` | Allow `console.*` output as breadcrumbs |
| `captureNetwork` | `true` | Instrument `fetch` / `XHR`: CLIENT spans and the `traceparent` header |
| `captureNavigation` | `true` | Allow page loads and History API push / replace / pop as breadcrumbs |
| `captureUserActions` | `true` | Allow clicks as breadcrumbs |
| `captureMetrics` | `true` | Allow the performance metrics aggregated on the device |
| `captureHttpServerErrors` | `false` | Report `fetch` / `XHR` responses with status >= 500 as message issues |
| `propagateTraceHeaderCorsUrls` | none | Cross-origin URLs that also get the `traceparent` header (same-origin requests always do): a string matches every URL that starts with it, a `RegExp` is tested against the URL |
| `remoteConfig` | `true` | Fetch collection settings from Traceway, so the **Data Collection** page can change what the app sends without a release |
| `collection.buffer.maxAgeSeconds` | `600` | Maximum age of buffered telemetry and replay in seconds |
| `collection.buffer.maxBytes` | `2097152` | Byte limit for buffered telemetry (replay has its own, `collection.buffer.replayMaxBytes`) |

The `capture*`, `sessionRecording`, `replayImages` and `sessions` options are ceilings: remote settings can restrict a signal further, but never turn on what you turned off here. The 1.x options `debounceMs`, `retryDelayMs`, `eventsWindowMs` and `eventsMaxCount` no longer exist.

See [Initialization](https://docs.tracewayapp.com/client/js-sdk/initialization#options-reference) for the full options reference.

## Breadcrumbs & Replay

Breadcrumbs and the replay are kept on the device by default. A captured error uploads up to 10 minutes of breadcrumbs and a 30-second replay clip (with a 5-second cooldown between clips and at most 20 clips per session). With `recordAllSessions: true` they stream instead.

- **Console** — `console.log`, `info`, `warn` and `error` output. `console.debug` is below the default minimum severity (`collection.signals.console.minSeverity`, `"info"`).
- **Requests** — `fetch` / `XHR` calls, recorded as OpenTelemetry CLIENT spans.
- **Navigation and clicks** — page loads, History API navigations and clicks. Vue Router push/replace/pop is captured automatically.
- **Custom** — `recordAction` and `track` events.
- **Session recordings** — rrweb-based replay; an error uploads a 30-second clip leading up to it.

Performance metrics (web vitals, route changes, requests) are separate from these: they are aggregated on the device and uploaded every 300 seconds, when the page is hidden and at session end.

## API

### `createTracewayPlugin(config)`

Returns a Vue plugin that initializes Traceway and registers a global error handler.

| Field | Type | Description |
|-------|------|-------------|
| `token` | `string` | The project token. Without one, only a `telemetry` destination in `options` receives anything |
| `baseUrl` | `string` | The Traceway server, only for a self-hosted one. Default `https://cloud.tracewayapp.com` |
| `options` | `TracewayFrontendOptions` | Every other option, forwarded to `init()` from `@tracewayapp/frontend` |

`init()` runs once per page: a second call is a no-op until `await shutdown()`.

The plugin assigns `app.config.errorHandler`. An `Error` is reported with `captureException`; any other thrown value is reported as a message, with `captureMessage(String(err))`. With `debug: true` the handler also logs the error and Vue's info string (`Traceway: Vue error (<info>)`) with the page's own `console.warn`, so the line is not recorded as a log of the app. Vue has a single `errorHandler` slot. A handler assigned before `app.use(createTracewayPlugin(...))` keeps being called after Traceway has captured the error. Without one, Vue's own handling stays as it is without Traceway: after the capture the error goes back to Vue, which logs it with `console.error` in production and rethrows it in development. A handler your app assigns afterwards replaces Traceway's, so call `captureException` from it yourself. During server-side rendering the plugin leaves the slot alone, since the SDK only reports from the browser.

### `useTraceway()`

Returns `{ captureException, captureExceptionWithAttributes, captureMessage, recordAction }`.

| Function | Description |
|----------|-------------|
| `captureException(error, attributes?)` | Capture an error, with optional string attributes |
| `captureExceptionWithAttributes(error, attributes?)` | Same as `captureException` |
| `captureMessage(message, attributes?)` | Capture a message issue |
| `recordAction(category, name, data?)` | Record a breadcrumb for the replay timeline |

Without the plugin (an app that calls `init()` itself) it returns the same functions instead of throwing. The same object is available with `inject(TracewayKey)`.

### `trackRouter(router)`

Registers a `router.afterEach` hook that reports the last matched route record's `path` with `setRoute`, or `null` when nothing matched. It is this package's own, not the browser SDK's `trackRouter`, and is only needed for a router the plugin does not see. Anything that is not a router is ignored.

### `useTracewayAttributes(attributes)` / `<TracewayAttributes>`

Bind a reactive `Record<string, string>` to the global attribute scope.

| Prop / arg | Type | Description |
|---|---|---|
| `attributes` | `Record<string, string> \| null \| undefined`; the composable also takes a ref or a getter of one | Map of keys to attach. `null`/`undefined` is treated as `{}` |

Behaviour: diff-only updates (only changed keys hit the SDK), removed keys are dropped, and on unmount every key it currently owns is removed. The component renders nothing.

## Platform Support

| Environment | Error Tracking | Session Replay |
|---|---|---|
| Vue 3.3+ in any modern browser | Yes | Yes |
| Vite / Nuxt 3 (client) | Yes | Yes |
| Vue 2 | No (use [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend) directly) | No |

This package covers the browser. In Nuxt, install the plugin from a universal plugin file (`plugins/traceway.ts`, not `traceway.client.ts`): the server pass only provides the injection key that `useTraceway()` needs, and the SDK does not start there (there is no `window`), so server-side errors are not reported by it.

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [Vue guide](https://docs.tracewayapp.com/client/vue)
- [Migration guide from 1.x](https://docs.tracewayapp.com/client/js-sdk/migration)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)

## License

MIT
