<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/react"><img src="https://img.shields.io/npm/v/@tracewayapp/react.svg" alt="npm"></a>
  <a href="https://github.com/tracewayapp/traceway-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway React SDK

Error tracking and session replay for React apps. Provides `<TracewayProvider>` (which also catches render errors) and a `useTraceway()` hook on top of [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend).

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

> For React Native and Expo apps, use [`@tracewayapp/react-native`](https://www.npmjs.com/package/@tracewayapp/react-native) instead — it has the same API but omits the browser-only rrweb recorder.

## Features

- Provider that initializes Traceway exactly once and acts as an error boundary
- Render-time exceptions are captured automatically and re-thrown so your app behaves exactly as without Traceway
- `useTraceway()` hook for capturing exceptions and messages from any component
- Inherits everything from [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend): rrweb session replay, console logs, network/navigation actions, gzip transport
- Simple one-line setup

## Installation

```bash
npm install @tracewayapp/react
```

## Quick Start

Wrap your application with `TracewayProvider`:

```tsx
import { TracewayProvider } from "@tracewayapp/react";

function App() {
  return (
    <TracewayProvider
      connectionString="your-token@https://traceway.example.com/api/report"
      options={{ version: "1.0.0" }}
    >
      <YourApp />
    </TracewayProvider>
  );
}

export default App;
```

That's it. The provider runs `init(...)` once, which installs `window.onerror`, `unhandledrejection`, the `console.*` mirror, the `fetch` / `XHR` instrumentation, the History API instrumentation, and the rrweb recorder. It also acts as an error boundary: render-time exceptions are captured and re-thrown so the app behaves exactly as it would without Traceway.

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

To record a custom action breadcrumb, import `recordAction` directly from `@tracewayapp/frontend` (it's not on the hook surface):

```tsx
import { recordAction } from "@tracewayapp/frontend";

recordAction("checkout", "payment_submitted", { amount: 42 });
```

## Custom Attributes (global scope)

Two ways to attach app-level identifiers (`userId`, `tenant`, feature flags, …) to every session and exception.

**Declarative — `<TracewayAttributes>` or the `useTracewayAttributes` hook.** Pass a map; the SDK diffs against the previous map and pushes only the deltas. On unmount, every key the component owned is removed from scope.

```tsx
import { TracewayAttributes, useTracewayAttributes } from "@tracewayapp/react";

// As a component — drop in wherever you have the user/tenant context:
<TracewayAttributes attributes={{ userId: user.id, tenant: org.id }} />

// Or as a hook:
function App() {
  useTracewayAttributes({ userId: user?.id, tenant: org?.id });
  return <Routes />;
}
```

The hook accepts `null` / `undefined` as "empty map" — useful while user data is still loading or after logout. New object reference with the same content does not trigger SDK calls (a fingerprint check skips no-op renders).

**Imperative — `setAttribute` / `setAttributes` / `removeAttribute` / `clearAttributes`.** Persist in memory until cleared. Use these outside React component trees (background workers, init scripts):

```ts
import {
  setAttribute,
  setAttributes,
  clearAttributes,
} from "@tracewayapp/react";

setAttribute("build_channel", import.meta.env.VITE_CHANNEL ?? "dev");
setAttributes({ tenant: "acme", plan: "pro" });
// ...later, on logout:
clearAttributes();
```

Layering order on each event: `auto-collected defaults < global scope < per-call attributes`. Per-call exception attributes from `captureExceptionWithAttributes(err, { … })` still win over global keys on collision.

## Always-on Session Recording

Pass `recordAllSessions: true` in `options` to upload full sessions continuously (not just exception-bound clips):

```tsx
<TracewayProvider
  connectionString="your-token@https://traceway.example.com/api/report"
  options={{ recordAllSessions: true, version: "1.0.0" }}
>
```

See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#always-on-session-recording) for the full description.

## Options

`TracewayProvider`'s `options` prop forwards directly to [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend). The most-used flags:

| Option | Default | Description |
|--------|---------|-------------|
| `version` | `""` | App version string, attached to every report |
| `debug` | `false` | Print debug info to the console |
| `captureLogs` | `true` | Mirror `console.*` into the rolling log buffer |
| `captureNetwork` | `true` | Record `fetch` / `XHR` as network actions |
| `captureNavigation` | `true` | Record History API push / replace / pop as navigation actions |
| `sessionRecording` | `true` | Enable the rrweb session recorder |
| `recordAllSessions` | `false` | Always-on session recording (every ~30 s segment uploaded continuously) |
| `eventsWindowMs` | `10000` | Rolling window kept in the log/action buffers (ms) |
| `eventsMaxCount` | `200` | Hard cap applied independently to logs and actions |

See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend) for the full options reference.

## Logs & Actions

Each captured exception ships with the buffered logs, actions, and replay frames — so the dashboard shows you what the user saw and did right before the error.

- **Logs** — `console.{debug, log, info, warn, error}` mirrored into a rolling buffer.
- **Actions** — `fetch` / `XHR` and History API navigations (push / replace / pop) recorded as breadcrumbs. Most React routers (React Router, Next.js client-side, Wouter, TanStack Router) flow through the History API and are captured automatically.
- **Session recordings** — rrweb-based replay of the seconds leading up to each exception.

## API

### `<TracewayProvider>`

| Prop | Type | Description |
|------|------|-------------|
| `connectionString` | `string` | Traceway connection string (`token@url`) |
| `options` | `TracewayFrontendOptions` | Forwarded to `init()` from `@tracewayapp/frontend` |
| `children` | `ReactNode` | Child components |

### `<TracewayErrorBoundary>` (deprecated since v1.1.0)

`TracewayProvider` now catches render errors and reports them on its own. Use `TracewayErrorBoundary` only if you need a custom `fallback` UI for a specific subtree. It will be removed in v2.

| Prop | Type | Description |
|------|------|-------------|
| `children` | `ReactNode` | Child components to wrap |
| `fallback` | `ReactNode` | UI to render when an error is caught |
| `onError` | `(error, errorInfo) => void` | Optional callback fired before the fallback renders |

### `useTraceway()`

Returns `{ captureException, captureExceptionWithAttributes, captureMessage }`.

Throws if used outside a `TracewayProvider`.

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
| React Native / Expo | Use [`@tracewayapp/react-native`](https://www.npmjs.com/package/@tracewayapp/react-native) | No (intentional) |

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
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)
- [React Native SDK](https://www.npmjs.com/package/@tracewayapp/react-native)

## License

MIT
