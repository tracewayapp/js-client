<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/svelte"><img src="https://img.shields.io/npm/v/@tracewayapp/svelte.svg" alt="npm"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway Svelte SDK

Error tracking and session replay for Svelte and SvelteKit apps. Provides `setupTraceway()` / `getTraceway()` context helpers on top of [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend).

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

## Features

- Context-based setup that initializes Traceway once during component init
- `getTraceway()` helper for capturing exceptions and messages and recording breadcrumbs from any descendant component
- `trackRoute()` to group performance metrics by route, `useTracewayAttributes()` to bind attributes such as `user.id`, `captureSvelteError()` for `<svelte:boundary>`
- Inherits everything from [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend): rrweb session replay, breadcrumbs (console, `fetch` / XHR, navigation, clicks), performance metrics, W3C `traceparent` propagation, and collection settings you can change from the dashboard's **Data Collection** page
- SvelteKit's client-side routing flows through the History API and is captured automatically
- Simple one-line setup

Upgrading from 1.x? See the [migration guide](https://docs.tracewayapp.com/client/js-sdk/migration).

## Installation

```bash
npm install @tracewayapp/svelte
```

This installs 2.x. Use `@tracewayapp/svelte@2` to pin the major, or `@tracewayapp/svelte@1` to stay on 1.x.

## Quick Start

Call `setupTraceway` in your root component:

```svelte
<script>
  import { setupTraceway } from "@tracewayapp/svelte";

  setupTraceway({
    connectionString: "your-token@https://traceway.example.com/api/report",
  });
</script>

<slot />
```

That's it. `setupTraceway` runs `init(...)` synchronously, which installs the `window.onerror` and `unhandledrejection` handlers, instruments `console.*`, `fetch` / `XHR`, the History API and clicks, and starts the rrweb recorder.

By default errors and messages are sent as they happen, and session start and end are reported for every visit. Console output, requests, navigation, clicks and the replay stay on the device: a captured error uploads up to 10 minutes of those breadcrumbs and a 30-second replay clip.

The examples use Svelte 4 syntax, which Svelte 5 still compiles. In Svelte 5 runes mode, write `{@render children()}` instead of `<slot />` and `onclick` instead of `on:click`.

### Render-time errors

Svelte does **not** have a global error-boundary primitive like React or Vue. The global `window.onerror` and `unhandledrejection` handlers catch runtime errors (event handlers, async work), but a component that throws during render does not automatically reach those handlers.

- **Svelte 5+** ships [`<svelte:boundary>`](https://svelte.dev/docs/svelte/svelte-boundary). Pipe its `onerror` prop into Traceway via the exported `captureSvelteError` helper:

  ```svelte
  <script>
    import { captureSvelteError } from "@tracewayapp/svelte";
  </script>

  <svelte:boundary onerror={(error) => captureSvelteError(error)}>
    <YourApp />
    {#snippet failed(error, reset)}
      <p>Something went wrong.</p>
    {/snippet}
  </svelte:boundary>
  ```

- **Svelte 4** has no boundary primitive at all. Wrap risky code in `try/catch` and call `captureSvelteError(err)` manually, or upgrade to Svelte 5 for `<svelte:boundary>`.

`captureSvelteError` reports an `Error` with `captureException` and any other thrown value as a message, with `captureMessage(String(err))`.

### SvelteKit

In SvelteKit, set up Traceway in the root layout. Do **not** gate it on the `browser` import: `setupTraceway` is what puts the capture functions into Svelte's context, so if it is skipped during SSR, every child component that calls `getTraceway()` throws on the server. The call is safe there: without `window` the SDK does not start, so it installs nothing and sends nothing, and the capture functions do nothing. Errors thrown on the server are not reported by this package.

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { setupTraceway } from "@tracewayapp/svelte";

  setupTraceway({
    connectionString: "your-token@https://traceway.example.com/api/report",
  });
</script>

<slot />
```

SvelteKit hands errors from a failed `load` or a render crash during client-side navigation to `handleError` in `src/hooks.client.js`. Report them there with the plain `captureException` export (Svelte context is not available in a hook); see [SvelteKit Error Handling](https://docs.tracewayapp.com/client/svelte/context#sveltekit-error-handling).

## Manual Capture

Use `getTraceway` in child components:

```svelte
<script>
  import { getTraceway } from "@tracewayapp/svelte";

  const { captureException } = getTraceway();

  async function handleSubmit() {
    try {
      await submitForm();
    } catch (error) {
      captureException(error);
    }
  }
</script>

<button on:click={handleSubmit}>Submit</button>
```

`captureException(error, attributes?)` and `captureMessage(message, attributes?)` take optional string attributes (`Record<string, string>`) for that one event.

The context also holds `recordAction`, which records a custom breadcrumb for the replay timeline:

```ts
const { recordAction } = getTraceway();

recordAction("checkout", "payment_submitted", { amount: 42 });
```

Like the other breadcrumbs it stays on the device and is uploaded with the next error, unless `recordAllSessions` or a remote rule streams it.

### Outside components

Everything in the context, and the rest of the browser SDK's API, is also exported from `@tracewayapp/svelte` as plain functions, so stores, hooks and utilities do not need a second dependency on `@tracewayapp/frontend`:

```ts
import { captureException, track, metric, count, flush } from "@tracewayapp/svelte";

track("checkout_failed", { step: "payment" });
metric("checkout.duration", 840, { plan: "pro" });
count("cart.item_added");
```

The exports are `captureException`, `captureExceptionWithAttributes`, `captureMessage`, `recordAction`, `track`, `metric`, `count`, `setMetricDimension`, `setRoute`, `startInteraction`, `setAttribute`, `setAttributes`, `removeAttribute`, `clearAttributes`, `refreshConfig`, `flush`, `shutdown`, `getInstanceId` and `DEFAULT_IGNORE_PATTERNS`. They do nothing until `setupTraceway` has run. See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#api) for what each one does.

## Route Names

Performance metrics are grouped by page. Call `trackRoute` with the route id so they group by route (`/orders/[id]`) and not by URL. In SvelteKit, from the root layout:

```svelte
<!-- src/routes/+layout.svelte, Svelte 5 -->
<script>
  import { page } from "$app/state";
  import { setupTraceway, trackRoute } from "@tracewayapp/svelte";

  let { children } = $props();

  setupTraceway({
    connectionString: "your-token@https://traceway.example.com/api/report",
  });

  $effect(() => {
    page.url.pathname; // Run again for another URL with the same route id.
    trackRoute(page.route.id);
  });
</script>

{@render children()}
```

On Svelte 4, or a SvelteKit version without `$app/state`, import `page` from `$app/stores` and write `$: trackRoute($page.route.id);`. `trackRoute(null)` clears the name. Without a name the SDK replaces id-like path segments itself.

## Custom Attributes (global scope)

Two ways to attach app-level identifiers (`user.id`, `tenant`, feature flags, …) to every session and exception. Attribute values are strings.

**Declarative — `useTracewayAttributes`**, a factory that returns a sync function. Call once during component setup; invoke the returned function from `$effect` (Svelte 5) or `$:` (Svelte 4). The hook diffs the new map against the previous one and pushes only the deltas; on `onDestroy` every key it currently owns is removed.

```svelte
<!-- Svelte 5 -->
<script>
  import { useTracewayAttributes } from "@tracewayapp/svelte";
  let { user, org } = $props();
  const sync = useTracewayAttributes();
  $effect(() => sync(user ? { "user.id": user.id, tenant: org.id } : null));
</script>
```

```svelte
<!-- Svelte 4 -->
<script>
  import { useTracewayAttributes } from "@tracewayapp/svelte";
  export let user; export let org;
  const sync = useTracewayAttributes();
  $: sync(user ? { "user.id": user.id, tenant: org.id } : null);
</script>
```

The sync function accepts `null` / `undefined` as "empty map" — useful while user data loads or after logout. The factory must run during component init so `onDestroy` can register cleanup. It removes every key it set when the component is destroyed, so do not set the same key with `setAttribute` elsewhere.

**Imperative — `setAttribute` / `setAttributes` / `removeAttribute` / `clearAttributes`.** Use these outside component trees (stores, `hooks.client.js`):

```ts
import {
  setAttribute,
  setAttributes,
  clearAttributes,
} from "@tracewayapp/svelte";

setAttribute("build_channel", "canary");
setAttributes({ "user.id": "u_42", tenant: "acme", plan: "pro" });
// ...later, on logout:
clearAttributes();
```

`clearAttributes()` empties the whole global scope, including keys set by a live `useTracewayAttributes`; use `removeAttribute(key)` to drop single keys.

Layering order on each event: `auto-collected defaults < global scope < per-call attributes`. See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#custom-attributes-global-scope) for the full mechanics.

Remote rules and captures can target these attributes; `user.id` is the key to use for a user. After login, call `refreshConfig()` so a rule that targets the user applies at once instead of at the next poll.

## Always-on Session Recording

Pass `recordAllSessions: true` to stream every replay segment and breadcrumb as it is recorded, instead of keeping them on the device for error clips:

```svelte
<script>
  import { setupTraceway } from "@tracewayapp/svelte";

  setupTraceway({
    connectionString: "your-token@https://traceway.example.com/api/report",
    options: { recordAllSessions: true },
  });
</script>
```

See [Session Replay](https://docs.tracewayapp.com/client/js-sdk/session-replay) for the full description.

## Distributed Tracing

Every `fetch` / `XHR` call is an OpenTelemetry CLIENT span, and same-origin requests carry the W3C `traceparent` header, so a backend instrumented with OpenTelemetry joins the same trace with no extra middleware. For an API on another origin, list it in `propagateTraceHeaderCorsUrls` (its CORS policy must allow the `traceparent` header). See [Distributed Tracing](https://docs.tracewayapp.com/client/js-sdk/distributed-tracing).

## Options

The `options` field forwards directly to [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend). The most-used flags:

| Option | Default | Description |
|--------|---------|-------------|
| `version` | none | App version, reported as `service.version`. Groups releases, and remote rules can target it |
| `environment` | none | `deployment.environment.name`, e.g. `"production"` |
| `serviceName` | the page's host name | `service.name` of this app |
| `debug` | `false` | Log the problems the SDK would otherwise swallow: a rejected project token and a `beforeCapture` that throws. Captured events are not logged |
| `ignoreErrors` | `DEFAULT_IGNORE_PATTERNS` | Patterns matched against `Type: message`; matching exceptions and messages are dropped. The defaults drop common network-failure, timeout and 4xx error messages. Pass `[]` to capture everything |
| `beforeCapture` | none | Receives `{ type, message, stack, attributes }`; return `false` to drop |
| `sessionRecording` | `true` | Allow rrweb session replay at all |
| `recordAllSessions` | `false` | Stream every replay segment and breadcrumb instead of keeping them on the device for error clips |
| `sessions` | `true` | Report session start and end |
| `captureLogs` | `true` | Allow `console.*` output as breadcrumbs |
| `captureNetwork` | `true` | Instrument `fetch` / `XHR`: CLIENT spans and the `traceparent` header |
| `captureNavigation` | `true` | Allow page loads and History API push / replace / pop as breadcrumbs |
| `captureUserActions` | `true` | Allow clicks as breadcrumbs |
| `captureMetrics` | `true` | Allow the performance metrics aggregated on the device |
| `captureHttpServerErrors` | `false` | Report `fetch` / `XHR` responses with status >= 500 as message issues |
| `propagateTraceHeaderCorsUrls` | none | Cross-origin URLs that also get the `traceparent` header (same-origin requests always do) |
| `remoteConfig` | `true` | Fetch collection settings from Traceway, so the **Data Collection** page can change what the app sends without a release |
| `collection.buffer.maxAgeSeconds` | `600` | Maximum age of buffered telemetry and replay in seconds |
| `collection.buffer.maxBytes` | `2097152` | Byte limit for buffered telemetry (replay has its own, `collection.buffer.replayMaxBytes`) |

The `capture*`, `sessionRecording` and `sessions` options are ceilings: remote settings can restrict a signal further, but never turn on what you turned off here. The 1.x options `debounceMs`, `retryDelayMs`, `eventsWindowMs` and `eventsMaxCount` no longer exist.

See [Initialization](https://docs.tracewayapp.com/client/js-sdk/initialization#options-reference) for the full options reference.

## Breadcrumbs & Replay

Breadcrumbs and the replay are kept on the device by default. A captured error uploads up to 10 minutes of breadcrumbs and a 30-second replay clip (with a 5-second cooldown between clips and at most 20 clips per session). With `recordAllSessions: true` they stream instead.

- **Console** — `console.log`, `info`, `warn` and `error` output. `console.debug` is below the default minimum severity (`collection.signals.console.minSeverity`, `"info"`).
- **Requests** — `fetch` / `XHR` calls, recorded as OpenTelemetry CLIENT spans.
- **Navigation and clicks** — page loads, History API navigations and clicks. SvelteKit's client-side routing is captured automatically.
- **Custom** — `recordAction` and `track` events.
- **Session recordings** — rrweb-based replay; an error uploads a 30-second clip leading up to it.

Performance metrics (web vitals, route changes, requests) are separate from these: they are aggregated on the device and uploaded every 300 seconds, when the page is hidden and at session end.

## API

### `setupTraceway(config)`

Initializes Traceway and stores the API in Svelte context. Must be called during component initialization.

| Field | Type | Description |
|-------|------|-------------|
| `connectionString` | `string \| StandaloneOptions` | Traceway connection string (`token@url`). An options object with a `telemetry` destination instead runs the SDK [without a Traceway server](https://docs.tracewayapp.com/client/js-sdk/initialization#standalone-without-a-traceway-server) |
| `options` | `TracewayFrontendOptions` | Forwarded to `init()` from `@tracewayapp/frontend` |

Returns `{ captureException, captureExceptionWithAttributes, captureMessage, recordAction }`.

`init()` runs once per page: a later `setupTraceway` call (a nested layout, a remounted root) sets the context again but does not restart the SDK or apply its options, until `await shutdown()`.

### `getTraceway()`

Returns `{ captureException, captureExceptionWithAttributes, captureMessage, recordAction }`.

| Function | Description |
|----------|-------------|
| `captureException(error, attributes?)` | Capture an error, with optional string attributes |
| `captureExceptionWithAttributes(error, attributes?)` | Same as `captureException` |
| `captureMessage(message, attributes?)` | Capture a message issue |
| `recordAction(category, name, data?)` | Record a breadcrumb for the replay timeline |

Throws if used outside a component tree where `setupTraceway` has been called. `useTraceway` is an alias of `getTraceway`, for parity with the React and Vue packages. The context key is exported as `TRACEWAY_KEY`.

### `captureSvelteError(err)`

Reports a thrown value: `captureException` for an `Error`, `captureMessage(String(err))` for anything else. Works without context, so it can be passed straight to `<svelte:boundary onerror>`.

### `trackRoute(routeId)`

Names the page being shown by its route id (`string | null`), so performance metrics group by route. Calls `setRoute`.

### `useTracewayAttributes()`

Returns a `(attrs: Record<string, string> | null | undefined) => void` setter. Call once during component init, then invoke the setter from `$effect` (Svelte 5) or a `$:` reactive statement (Svelte 4). Diffs against the last map; removes every owned key on `onDestroy`.

## Platform Support

| Environment | Error Tracking | Session Replay |
|---|---|---|
| Svelte 4+ in any modern browser | Yes | Yes |
| SvelteKit (browser) | Yes | Yes |
| SvelteKit SSR | No. `setupTraceway` still has to run on the server to set the context, but the SDK does not start there | No |

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [Svelte guide](https://docs.tracewayapp.com/client/svelte)
- [Migration guide from 1.x](https://docs.tracewayapp.com/client/js-sdk/migration)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)

## License

MIT
