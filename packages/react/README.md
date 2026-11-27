<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/react"><img src="https://img.shields.io/npm/v/@tracewayapp/react.svg" alt="npm"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway React SDK

Error tracking and session replay for React apps. Provides `<TracewayProvider>` (which also catches render errors) and a `useTraceway()` hook on top of [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend).

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

> For React Native and Expo apps, use [`@tracewayapp/react-native`](https://www.npmjs.com/package/@tracewayapp/react-native) instead. It is a separate SDK with a provider and hook of the same names, but without the browser features described here (session replay, remote collection settings, `track` / `metric` / `count`).

## Features

- Provider that initializes Traceway once per page and acts as an error boundary
- Render-time exceptions are captured automatically and re-thrown so your app behaves exactly as without Traceway
- `useTraceway()` hook for capturing exceptions and messages and recording breadcrumbs from any component
- `useTracewayRoute()` to group performance metrics by route, `useTracewayAttributes()` / `<TracewayAttributes>` to bind attributes such as `user.id`
- Inherits everything from [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend): rrweb session replay, breadcrumbs (console, `fetch` / XHR, navigation, clicks), performance metrics, W3C `traceparent` propagation, and collection settings you can change from the dashboard's **Data Collection** page
- Simple one-line setup

Upgrading from 1.x? See the [migration guide](https://docs.tracewayapp.com/client/js-sdk/migration).

## Installation

```bash
npm install @tracewayapp/react
```

This installs 2.x. Use `@tracewayapp/react@2` to pin the major, or `@tracewayapp/react@1` to stay on 1.x.

## Quick Start

Wrap your application with `TracewayProvider`:

```tsx
import { TracewayProvider } from "@tracewayapp/react";

function App() {
  return (
    <TracewayProvider token={import.meta.env.VITE_TRACEWAY_TOKEN}>
      <YourApp />
    </TracewayProvider>
  );
}

export default App;
```

`token` is the project token (here from `VITE_TRACEWAY_TOKEN`; Next.js uses `NEXT_PUBLIC_TRACEWAY_TOKEN`). The SDK sends to Traceway Cloud; for a self-hosted server, pass its address as `baseUrl` (`baseUrl={import.meta.env.VITE_TRACEWAY_URL}`). Every other option of the browser SDK goes in `options`: `options={{ version: "1.4.2", debug: true }}`.

That's it. The provider runs `init(...)` once, which installs the `window.onerror` and `unhandledrejection` handlers, instruments `console.*`, `fetch` / `XHR`, the History API and clicks, and starts the rrweb recorder. It also acts as an error boundary: render-time exceptions are captured and re-thrown so the app behaves exactly as it would without Traceway.

By default errors and messages are sent as they happen, and session start and end are reported for every visit. Console output, requests, navigation, clicks and the replay stay on the device: a captured error uploads up to 10 minutes of those breadcrumbs and a 30-second replay clip.

### Upgrading from 2.0

The `connectionString` prop of 2.0 still works, but it is deprecated and logs one warning that names the new form: `connectionString="token@https://host/api/report"` becomes `token="token" baseUrl="https://host"`, and for Traceway Cloud just `token="token"`. Every variation of the old string keeps working (with or without `/api` or `/api/report`, a trailing slash, a query string, without a scheme, a server under a sub-path), and `baseUrl` is read the same way. The `transport` option is deprecated and ignored: the SDK always sends OTLP.

## Manual Capture

```tsx
import { useTraceway } from "@tracewayapp/react";

function CheckoutButton() {
  const { captureException, captureMessage } = useTraceway();

  async function handleSubmit() {
    try {
      await submitForm();
    } catch (error) {
      captureException(error as Error);
    }
  }

  return <button onClick={handleSubmit}>Submit</button>;
}
```

`captureException(error, attributes?)` and `captureMessage(message, attributes?)` take optional string attributes (`Record<string, string>`) for that one event.

The hook also returns `recordAction`, which records a custom breadcrumb for the replay timeline:

```tsx
const { recordAction } = useTraceway();

recordAction("checkout", "payment_submitted", { amount: 42 });
```

Like the other breadcrumbs it stays on the device and is uploaded with the next error, unless `recordAllSessions` or a remote rule streams it.

### Outside components

Everything on the hook, and the rest of the browser SDK's API, is also exported from `@tracewayapp/react` as plain functions, so utilities and stores do not need a second dependency on `@tracewayapp/frontend`:

```ts
import { captureException, track, metric, count, flush } from "@tracewayapp/react";

track("checkout_failed", { step: "payment" });
metric("checkout.duration", 840, { plan: "pro" });
count("cart.item_added");
```

The exports are `captureException`, `captureExceptionWithAttributes`, `captureMessage`, `log`, `recordAction`, `track`, `metric`, `count`, `setMetricDimension`, `setRoute`, `recordNavigation`, `tracer`, `trackRouter`, `routeFromParams`, `startInteraction`, `setAttribute`, `setAttributes`, `removeAttribute`, `clearAttributes`, `refreshConfig`, `flush`, `shutdown`, `getInstanceId`, `currentSessionId`, `getClient`, `DEFAULT_IGNORE_PATTERNS` and `SDK_VERSION`: every value of `@tracewayapp/frontend` except `init` (the provider calls it) and the `TracewayFrontendClient` class. Its types are all re-exported too: `TracewayFrontendOptions`, `StandaloneOptions`, `TelemetryOptions`, `TelemetryEndpoint`, `TracewayCapturedError` (`CapturedException` is its deprecated alias), `TracewayInteraction`, `TracewayLogLevel`, `ErrorLimits`, `CollectionLimits`, `Settings`, `CollectionSettings`, `Trigger`, `TriggerAction`, `Capture`, `Mode`, `SignalName`, `TracewayImagePolicy`, `RouteParams` and the event types `TracewayEvent`, `LogEvent`, `NetworkEvent`, `NavigationEvent` and `CustomEvent`. The functions do nothing until a `TracewayProvider` has mounted. See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#api) for what each one does.

## Route Names

Performance metrics are grouped by page, and a page is named by its route template (`/orders/:id`), not by its URL. Most routers need no code for it:

| Router | What names the route |
| --- | --- |
| React Router in framework mode, Remix | Nothing to do: the SDK reads the router from the page |
| TanStack Router | Nothing to do |
| Next.js Pages Router | Nothing to do |
| React Router `createBrowserRouter` | `<TracewayProvider router={router}>`, or `trackRouter(router)` |
| React Router `<BrowserRouter>` and `<Routes>` | `useTracewayRoute(useLocation().pathname, useParams())` in a layout route |
| Next.js App Router | `useTracewayRoute(usePathname(), useParams())` in a client component of the root layout |

```tsx
// React Router, data mode
const router = createBrowserRouter(routes);

<TracewayProvider token={import.meta.env.VITE_TRACEWAY_TOKEN} router={router}>
  <RouterProvider router={router} />
</TracewayProvider>;
```

```tsx
// React Router with <Routes>: a layout route sees the params of the page below it
function Layout() {
  useTracewayRoute(useLocation().pathname, useParams());
  return <Outlet />;
}
```

```tsx
// Next.js App Router: app/traceway-route.tsx, rendered once in app/layout.tsx
"use client";
import { usePathname, useParams } from "next/navigation";
import { useTracewayRoute } from "@tracewayapp/react";

export function TracewayRoute() {
  useTracewayRoute(usePathname(), useParams());
  return null;
}
```

To name a route yourself, call `useTracewayRoute("/orders/:id")` from the component it renders; that name wins. Between two pages of one route the component usually stays mounted and the second page is not named again, so prefer the path-and-params form where the router is not read from the page. With no router and no name the SDK replaces id-like path segments itself.

## Custom Attributes (global scope)

Two ways to attach app-level identifiers (`user.id`, `tenant`, feature flags, …) to every session and exception. Attribute values are strings.

**Declarative — `<TracewayAttributes>` or the `useTracewayAttributes` hook.** Pass a map; the SDK diffs against the previous map and pushes only the deltas. On unmount, every key the component owned is removed from scope.

```tsx
import { TracewayAttributes, useTracewayAttributes } from "@tracewayapp/react";

// As a component — drop in wherever you have the user/tenant context:
<TracewayAttributes attributes={user ? { "user.id": user.id, tenant: org.id } : null} />

// Or as a hook:
function App() {
  useTracewayAttributes(user ? { "user.id": user.id, tenant: org.id } : null);
  return <Routes />;
}
```

The hook accepts `null` / `undefined` as "empty map" — useful while user data is still loading or after logout. Pass `null` rather than a map with `undefined` values: the type is `Record<string, string>`. New object reference with the same content does not trigger SDK calls (a fingerprint check skips no-op renders). The hook removes every key it was given when it unmounts, so do not set the same key with `setAttribute` elsewhere.

**Imperative — `setAttribute` / `setAttributes` / `removeAttribute` / `clearAttributes`.** Persist in memory until cleared. Use these outside React component trees (background workers, init scripts):

```ts
import {
  setAttribute,
  setAttributes,
  clearAttributes,
} from "@tracewayapp/react";

setAttribute("build_channel", import.meta.env.VITE_CHANNEL ?? "dev");
setAttributes({ "user.id": "u_42", tenant: "acme", plan: "pro" });
// ...later, on logout:
clearAttributes();
```

`clearAttributes()` empties the whole global scope, including keys set by a mounted `useTracewayAttributes`; use `removeAttribute(key)` to drop single keys.

Layering order on each event: `auto-collected defaults < global scope < per-call attributes`. Per-call exception attributes from `captureException(err, { … })` still win over global keys on collision.

Remote rules and captures can target these attributes; `user.id` is the key to use for a user. After login, call `refreshConfig()` so a rule that targets the user applies at once instead of at the next poll.

## Always-on Session Recording

Pass `recordAllSessions: true` in `options` to stream every replay segment and breadcrumb as it is recorded, instead of keeping them on the device for error clips:

```tsx
<TracewayProvider
  token={import.meta.env.VITE_TRACEWAY_TOKEN}
  options={{ recordAllSessions: true, version: "1.0.0" }}
>
```

See [Session Replay](https://docs.tracewayapp.com/client/js-sdk/session-replay) for the full description.

## Distributed Tracing

Every `fetch` / `XHR` call is an OpenTelemetry CLIENT span, and same-origin requests carry the W3C `traceparent` header, so a backend instrumented with OpenTelemetry joins the same trace with no extra middleware. For an API on another origin, list it in `propagateTraceHeaderCorsUrls` (its CORS policy must allow the `traceparent` header). See [Distributed Tracing](https://docs.tracewayapp.com/client/js-sdk/distributed-tracing).

To tie the steps of one user action together, `startInteraction(name, attributes?)` returns a `TracewayInteraction` with `run`, `bind`, `setAttribute`, `captureException` and `end(failed?)`; see the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#distributed-tracing).

## Send telemetry to another OpenTelemetry provider

The `telemetry` option sends logs, traces and metrics to any OTLP/HTTP endpoint, while errors, replay, captures and remote config stay on Traceway: `options={{ telemetry: { url: "https://collector.example.com" } }}`. Without a `token` the SDK runs standalone and sends only there. See [Send telemetry to another OpenTelemetry provider](https://www.npmjs.com/package/@tracewayapp/frontend#send-telemetry-to-another-opentelemetry-provider).

## Options

`TracewayProvider`'s `options` prop forwards directly to [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend). The most-used flags:

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
| `propagateTraceHeaderCorsUrls` | none | Cross-origin URLs that also get the `traceparent` header (same-origin requests always do) |
| `remoteConfig` | `true` | Fetch collection settings from Traceway, so the **Data Collection** page can change what the app sends without a release |
| `collection.buffer.maxAgeSeconds` | `600` | Maximum age of buffered telemetry and replay in seconds |
| `collection.buffer.maxBytes` | `2097152` | Byte limit for buffered telemetry (replay has its own, `collection.buffer.replayMaxBytes`) |

The `capture*`, `sessionRecording`, `replayImages` and `sessions` options are ceilings: remote settings can restrict a signal further, but never turn on what you turned off here. The 1.x options `debounceMs`, `retryDelayMs`, `eventsWindowMs` and `eventsMaxCount` no longer exist.

See [Initialization](https://docs.tracewayapp.com/client/js-sdk/initialization#options-reference) for the full options reference.

## Breadcrumbs & Replay

Breadcrumbs and the replay are kept on the device by default. A captured error uploads up to 10 minutes of breadcrumbs and a 30-second replay clip (with a 5-second cooldown between clips and at most 20 clips per session) — so the dashboard shows you what the user saw and did right before the error. With `recordAllSessions: true` they stream instead.

- **Console** — `console.log`, `info`, `warn` and `error` output. `console.debug` is below the default minimum severity (`collection.signals.console.minSeverity`, `"info"`).
- **Requests** — `fetch` / `XHR` calls, recorded as OpenTelemetry CLIENT spans.
- **Navigation and clicks** — page loads, History API navigations (push / replace / pop) and clicks. Most React routers (React Router, Next.js client-side, Wouter, TanStack Router) flow through the History API and are captured automatically.
- **Custom** — `recordAction` and `track` events.
- **Session recordings** — rrweb-based replay; an error uploads a 30-second clip leading up to it.

Performance metrics (web vitals, route changes, requests) are separate from these: they are aggregated on the device and uploaded every 300 seconds, when the page is hidden and at session end.

## API

### `<TracewayProvider>`

| Prop | Type | Description |
|------|------|-------------|
| `token` | `string` | The project token. Without one, only a `telemetry` destination in `options` receives anything |
| `baseUrl` | `string` | The Traceway server, only for a self-hosted one. Default `https://cloud.tracewayapp.com` |
| `options` | `TracewayFrontendOptions` | Every other option, forwarded to `init()` from `@tracewayapp/frontend` |
| `router` | `object` | The app's router, to name every view by its route template: what `createBrowserRouter` (React Router) or `createRouter` (TanStack Router) returned. Not needed for routers the SDK reads from the page |
| `children` | `ReactNode` | Child components |

The provider calls `init()` in its constructor, so the props are read when it mounts; changing them later has no effect. `init()` runs once per page: a second call (React StrictMode's double invocation, a second provider) is a no-op until `await shutdown()`.

### `<TracewayErrorBoundary>` (deprecated since v1.1.0)

`TracewayProvider` catches render errors and reports them on its own. `TracewayErrorBoundary` is still exported in 2.x; use it only if you need a custom `fallback` UI for a specific subtree. Place it inside the provider.

| Prop | Type | Description |
|------|------|-------------|
| `children` | `ReactNode` | Child components to wrap |
| `fallback` | `ReactNode` | UI to render when an error is caught |
| `onError` | `(error, errorInfo) => void` | Optional callback fired after the error is captured |

### `useTraceway()`

Returns `{ captureException, captureExceptionWithAttributes, captureMessage, recordAction }`.

| Function | Description |
|----------|-------------|
| `captureException(error, attributes?)` | Capture an error, with optional string attributes |
| `captureExceptionWithAttributes(error, attributes?)` | Same as `captureException` |
| `captureMessage(message, attributes?)` | Capture a message issue |
| `recordAction(category, name, data?)` | Record a breadcrumb for the replay timeline |

Outside a `TracewayProvider` (an app that calls `init()` itself) it returns the same functions instead of throwing. Class components can read the same object from the exported `TracewayContext`.

### `useTracewayRoute(template)` / `useTracewayRoute(pathname, params)`

Names the page being shown by its route template (`string | null`), so performance metrics group by route. With a path and the params a router matched in it, the template is rebuilt from the two (`/orders/8841` and `{ id: "8841" }` give `/orders/:id`; a catch-all gives `:name*`, React Router's splat `*`). Calls `setRoute` whenever the template or the supplied pathname changes.

### `trackRouter(router)`

Names every page from the route templates of a React Router data router (`createBrowserRouter`) or a TanStack Router. The `router` prop of `<TracewayProvider>` does the same.

### `<TracewayAttributes>` / `useTracewayAttributes`

Bind a reactive `Record<string, string>` to the global attribute scope.

| Prop / arg | Type | Description |
|---|---|---|
| `attributes` | `Record<string, string> \| null \| undefined` | Map of keys to attach. `null`/`undefined` is treated as `{}` |

Behaviour: diff-only updates (only changed keys hit the SDK), removed keys are dropped, and on unmount every key the hook currently owns is removed. The component renders nothing.

## Platform Support

| Environment | Error Tracking | Session Replay |
|---|---|---|
| React 18+ in any modern browser | Yes | Yes |
| Next.js (App / Pages router) | Yes | Yes |
| Vite / CRA / Remix | Yes | Yes |
| React Native / Expo | Use [`@tracewayapp/react-native`](https://www.npmjs.com/package/@tracewayapp/react-native) | No |

This package covers the browser. During server rendering the provider renders its children and the SDK does not start (there is no `window`), so server-side errors are not reported by it. For the server half of a Next.js or Remix app, see the [OpenTelemetry guides](https://docs.tracewayapp.com/client/otel).

### Next.js App Router

`@tracewayapp/react` ships with the `"use client"` directive, so `TracewayProvider` goes straight into `app/layout.tsx`, a Server Component, with no wrapper file:

```tsx
// app/layout.tsx
import { TracewayProvider } from "@tracewayapp/react";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <TracewayProvider token={process.env.NEXT_PUBLIC_TRACEWAY_TOKEN}>{children}</TracewayProvider>
      </body>
    </html>
  );
}
```

Server code (route handlers, server actions, a util shared by server and client) imports the plain functions from `@tracewayapp/frontend` instead, whose functions do nothing on the server. To name pages by their route, render the `TracewayRoute` client component from [Route Names](#route-names) in the same layout.

## Running the example

The repo ships a minimal example app at [`examples/react-demo/`](examples/react-demo/). From the monorepo root:

```bash
npm install
npm run build
cd packages/react/examples/react-demo
npm install
npm run dev
```

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [React guide](https://docs.tracewayapp.com/client/react)
- [Migration guide from 1.x](https://docs.tracewayapp.com/client/js-sdk/migration)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)
- [React Native SDK](https://www.npmjs.com/package/@tracewayapp/react-native)

## License

MIT
