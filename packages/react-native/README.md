<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/react-native"><img src="https://img.shields.io/npm/v/@tracewayapp/react-native.svg" alt="npm"></a>
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway React Native SDK

Error tracking for React Native and Expo apps. Capture exceptions with full stack traces, plus the last ~10 seconds of console logs, HTTP calls, navigation transitions, and custom breadcrumbs — automatically.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

This is the React Native counterpart to [`@tracewayapp/react`](https://www.npmjs.com/package/@tracewayapp/react) (web) and [`com.tracewayapp:traceway`](https://github.com/tracewayapp/traceway-android) (native Android). It sends its reports over Traceway's native report protocol, the same wire format the Android and Flutter SDKs use.

> **Version 2.1.0.** `@tracewayapp/react-native` is versioned in lockstep with the browser packages, but it is not the OpenTelemetry browser SDK: its API, options and transport are the same as in 1.x (the source is unchanged), so upgrading from 1.x needs no code changes. Remote collection settings, OTLP export, performance metrics, `track()` / `metric()` / `count()` and session replay belong to the [browser SDK](https://docs.tracewayapp.com/client/js-sdk) and are not part of this package.

> **No screen recording.** Unlike the browser SDK (`@tracewayapp/frontend`), this package does not record the screen. The `rrweb` recorder is intentionally absent — nothing in the bundle reaches into a DOM that doesn't exist.

## Features

- Automatic capture of every uncaught throw via React Native's `ErrorUtils` global handler
- Full Hermes / JavaScriptCore stack traces, normalized to Traceway's wire format
- **Logs** — every `console.{debug,log,info,warn,error}` line from the last ~10 seconds
- **Actions** — every `fetch` and `XMLHttpRequest` call, plus navigation transitions you wire in, plus custom breadcrumbs
- React surface: `<TracewayProvider>` (also acts as an error boundary), `useTraceway()` hook
- Debounced, retrying, gzip-compressed batch transport over plain `fetch` (no native modules, works in Expo Go)
- Simple one-line setup

Unhandled promise rejections are **not** captured automatically; see [What Gets Captured Automatically](#what-gets-captured-automatically).

## Installation

```bash
npm install @tracewayapp/react-native
```

This installs 2.x; `@tracewayapp/react-native@2` pins the major, `@1` stays on 1.x (same API).

The package is plain JavaScript — no native modules, no `pod install`, no Gradle changes. It works in Expo Go, in bare React Native CLI projects, and in EAS builds.

## Quick Start

Wrap your app in `TracewayProvider` from your entry component (typically `App.tsx`). Mounting the provider runs `init(...)` once, which installs the `ErrorUtils` global handler, the `fetch` / XHR wrappers, and the console mirror. The provider also acts as an error boundary — render-time exceptions are captured and re-thrown automatically.

```tsx
import { TracewayProvider } from "@tracewayapp/react-native";

export default function App() {
  return (
    <TracewayProvider connectionString="your-token@https://cloud.tracewayapp.com/api/report">
      <RootNavigator />
    </TracewayProvider>
  );
}
```

Copy the connection string from your project's **Connection** page in the dashboard as it is, including the `/api/report` path after the host: this package posts its reports to that exact URL.

That's it. Every uncaught throw, render-time exception, and `fetch` call is captured automatically. If you want to replace a crashed subtree with a custom `fallback` UI, `TracewayErrorBoundary` is still exported in 2.1.0 for that purpose, but it has been deprecated since v1.1.0. Do not build new code around it.

## Manual Capture

```tsx
import { useTraceway } from "@tracewayapp/react-native";
import { captureException, captureMessage, flush } from "@tracewayapp/react-native";

// Inside a component — get scoped helpers from the hook:
function CheckoutButton() {
  const { captureException, recordAction } = useTraceway();
  // ...
}

// Or import directly anywhere (after init has run):
try {
  riskyOperation();
} catch (e) {
  captureException(e as Error);
}

captureMessage("User completed checkout");

// Force send pending events (e.g. before app goes to background):
await flush();
```

`useTraceway()` returns `captureException`, `captureExceptionWithAttributes`, `captureMessage`, `recordAction`, `recordNavigation` and `setDeviceAttributes`, and throws when called outside a `TracewayProvider`. The same functions, plus `init`, `flush(timeoutMs?)`, `setAttribute`, `setAttributes`, `removeAttribute` and `clearAttributes`, can be imported directly; before `init()` has run they do nothing.

`captureMessage(message)` takes the message only. To attach attributes to a single report use `captureExceptionWithAttributes(error, attributes)`; `captureException(error)` takes none.

## Options

Pass options as the `options` prop of `TracewayProvider`, or as the second argument of `init(connectionString, options)`.

Field names mirror the Android and Flutter SDKs and the 1.x browser SDK, so existing config can be ported as-is. The 2.x browser SDK has a different set of options (see [Initialization](https://docs.tracewayapp.com/client/js-sdk/initialization)); a config written for it does not carry over.

| Option | Default | Description |
|--------|---------|-------------|
| `version` | `""` | App version string, attached to every report |
| `debug` | `false` | Log SDK diagnostics to the console: the device attributes, reports dropped by a filter, failed uploads, a `beforeCapture` that throws |
| `debounceMs` | `1500` | Milliseconds before flushing batched events |
| `retryDelayMs` | `10000` | Retry delay on failed uploads |
| `ignoreErrors` | `DEFAULT_IGNORE_PATTERNS` | Array of `string \| RegExp` patterns; a report whose text matches any of them is dropped. Passing a list replaces the defaults |
| `beforeCapture` | none | `(exception) => boolean` — return `false` to drop |
| `captureLogs` | `true` | Mirror `console.{debug,log,info,warn,error}` calls into the rolling log buffer |
| `captureNetwork` | `true` | Record `fetch` and `XMLHttpRequest` calls as network actions |
| `captureNavigation` | `true` | Record manual `recordNavigation()` calls |
| `captureDeviceInfo` | `true` | Auto-collect `device.locale` and `runtime.engine` and attach them to every report (see [Attributes](#1-device-info--auto-collected)) |
| `eventsWindowMs` | `10000` | Rolling window kept in the log/action buffers (ms) |
| `eventsMaxCount` | `200` | Hard cap applied independently to logs and actions |
| `distributedTraceHosts` | `[]` | Hosts whose `fetch` calls get an outgoing `traceway-trace-id` header. Traceway no longer uses that id, so it links nothing; see [Distributed Tracing](#distributed-tracing). Each entry is an exact host string or a `RegExp` tested against the URL host |
| `captureHttpServerErrors` | `false` | Report every `fetch` response with `status >= 500` as an issue (sent as a message, `isMessage: true`). Applies to `fetch` only: a 5xx from a direct `XMLHttpRequest` call is recorded as a network action but not reported |

`distributedTraceHosts` and `captureHttpServerErrors` live in the `fetch` wrapper, so neither does anything with `captureNetwork: false`.

The `DEFAULT_IGNORE_PATTERNS` export contains the built-in `ignoreErrors` list (`Network request failed`, `Failed to fetch`, timeouts, generic 4xx, etc.) — you can extend it rather than replace it:

```tsx
import { TracewayProvider, DEFAULT_IGNORE_PATTERNS } from "@tracewayapp/react-native";

<TracewayProvider
  connectionString={DSN}
  options={{ ignoreErrors: [...DEFAULT_IGNORE_PATTERNS, "Session expired"] }}
>
```

Patterns are tested against the whole report text (the `Type: message` line and the stack frames). Messages sent with `captureMessage` and the 5xx reports of `captureHttpServerErrors` go through the same filter and through `beforeCapture`.

## Distributed Tracing

With `distributedTraceHosts` set, the SDK adds a `traceway-trace-id` header (a fresh UUID per request, exported as `DISTRIBUTED_TRACE_HEADER`) to the app's `fetch` calls to those hosts, and `getActiveDistributedTraceId()` returns the id of the instrumented `fetch` currently in flight. Traceway no longer uses that id to link traces, so a mobile exception is not linked to the backend request that failed; it still carries its attributes and the logs and actions recorded before it. Leave `distributedTraceHosts` empty. The W3C `traceparent` propagation of the 2.x browser SDK is not part of this package.

## Logs & Actions

Every captured exception ships with the last ~10 seconds of session context, attached to a `sessionRecordings[]` entry on the wire, the same shape the Android and Flutter SDKs use:

- **Logs** — every `console.{debug,log,info,warn,error}` call. The original `console` output is preserved; we only piggyback on the call.
- **Actions** are split into three channels:
  - **Network** — every `fetch` and `XMLHttpRequest` call (method, URL, status, duration, byte counts). Calls to the Traceway host itself are skipped to avoid recursion.
  - **Navigation** — push transitions you record manually (see below).
  - **Custom** — anything you call `recordAction(...)` with.

Logs and actions are kept in two separate in-memory rolling buffers, each capped at 200 entries / 10 seconds by default (`eventsMaxCount` / `eventsWindowMs`). They ship inside `sessionRecordings[].logs` and `sessionRecordings[].actions` on the wire, with `startedAt` / `endedAt` ISO 8601 timestamps spanning the captured window.

### Navigation capture

React Native has no `window.history` to auto-instrument. Wire `recordNavigation` into whatever navigation library you use:

```tsx
import { useNavigationContainerRef } from "@react-navigation/native";
import { recordNavigation } from "@tracewayapp/react-native";

const navigationRef = useNavigationContainerRef();
const prevRoute = useRef<string | null>(null);

return (
  <NavigationContainer
    ref={navigationRef}
    onStateChange={() => {
      const next = navigationRef.getCurrentRoute()?.name ?? "unknown";
      recordNavigation(prevRoute.current ?? "(initial)", next);
      prevRoute.current = next;
    }}
  >
    {/* ... */}
  </NavigationContainer>
);
```

For [Expo Router](https://docs.expo.dev/router/) drop the same call into a `useEffect` keyed on `usePathname()`.

### Record a custom action

```tsx
import { recordAction } from "@tracewayapp/react-native";

recordAction("cart", "add_item", { sku: "SKU-123", qty: 2 });
```

### Disable a channel

Each channel can be turned off individually via `TracewayProvider`'s `options`:

```tsx
<TracewayProvider
  connectionString={DSN}
  options={{
    captureLogs: false,
    captureNetwork: false,
    captureNavigation: false,
  }}
>
```

Custom actions recorded with `recordAction(...)` have no switch; they are always kept.

## Attributes

Every captured exception ships with an `attributes` map composed of three layers (per-call wins, then global scope, then device info):

### 1. Device info — auto-collected

`init()` stamps these two keys on every report. They need no native module and work in Expo Go:

| Key | Source |
|---|---|
| `device.locale` | `Intl.DateTimeFormat().resolvedOptions().locale` |
| `runtime.engine` | `hermes` when `HermesInternal` is defined, otherwise `javascriptcore` |

`collectSyncDeviceInfo()` also knows how to read `os.name` (`Platform.OS`), `os.version` (`Platform.Version`), `screen.resolution` (`Dimensions.get("screen")`, whole pixels) and `screen.density` (`PixelRatio.get()`), but it reaches `react-native` through a global `require`. Metro does not define one (it registers modules on `global.__r`), so in a real app those four keys come back empty. Pass them in yourself if you want them on the dashboard. The key names mirror what the [Flutter](https://github.com/tracewayapp/traceway-flutter) and [Android](https://github.com/tracewayapp/traceway-android) SDKs emit, so the dashboard renders them consistently across platforms:

```ts
import { setDeviceAttributes, collectSyncDeviceInfo } from "@tracewayapp/react-native";
import { Dimensions, PixelRatio, Platform } from "react-native";

const screen = Dimensions.get("screen");

setDeviceAttributes({
  ...collectSyncDeviceInfo(),  // keep the auto-collected ones
  "os.name": Platform.OS,
  "os.version": String(Platform.Version),
  "screen.resolution": `${Math.round(screen.width)}x${Math.round(screen.height)}`,
  "screen.density": PixelRatio.get().toFixed(1),
});
```

`setDeviceAttributes` replaces the whole device map, so spread `collectSyncDeviceInfo()` to keep the auto-collected keys. Call it after the provider has mounted (before `init()` it does nothing). Use the same call to add info from `expo-device` / `react-native-device-info` you've installed yourself:

```ts
import { setDeviceAttributes, collectSyncDeviceInfo } from "@tracewayapp/react-native";
import * as Device from "expo-device";

setDeviceAttributes({
  ...collectSyncDeviceInfo(),
  "device.model": Device.modelName ?? "",
  "device.manufacturer": Device.manufacturer ?? "",
});
```

To opt out of device info collection entirely, pass `captureDeviceInfo: false` in `options`.

### 2. Global scope — app-level identifiers

Use the global scope for things tied to the **user / tenant / app state**, not the device: user id, organization id, build channel, feature flags, A/B bucket. Two ways to set it.

**Declarative — `<TracewayAttributes>` or the `useTracewayAttributes` hook.** Pass a map; the SDK diffs against the previous map and pushes only the deltas. On unmount, every key the component owned is removed.

```tsx
import { TracewayAttributes, useTracewayAttributes } from "@tracewayapp/react-native";

// As a component — drop in wherever you have user/tenant context:
<TracewayAttributes attributes={user ? { userId: user.id, tenant: org.id } : null} />

// Or as a hook:
function App() {
  useTracewayAttributes({ build_channel: "canary" });
  return <RootNavigator />;
}
```

The hook accepts `null` / `undefined` as "empty map" — useful while user data loads or after logout.

**Imperative — `setAttribute` / `setAttributes` / `removeAttribute` / `clearAttributes`.** Use these outside React component trees (auth listeners, background tasks):

```ts
import {
  setAttribute,
  setAttributes,
  clearAttributes,
} from "@tracewayapp/react-native";

setAttribute("userId", "u_42");
setAttributes({ tenant: "acme", plan: "pro" });
// ...on logout:
clearAttributes();
```

### 3. Per-call attributes

`captureExceptionWithAttributes(error, attrs)` — wins on key collision over both layers above.

### Layering

For each captured exception or message: `device info < global scope < per-call`.

## What Gets Captured Automatically

- **Uncaught throws** on the JS thread via `ErrorUtils.setGlobalHandler` — this is RN's equivalent of `window.onerror`. RN's red-box dev overlay still appears; we forward to the previous handler.
- **Unhandled promise rejections are not captured.** The SDK installs only the `ErrorUtils` global handler, and React Native does not route unhandled rejections through it (it hands them to its own rejection tracking), so the SDK never sees them. Catch them yourself and call `captureException`.
- **`fetch` calls** — wrapped at install time. Method, URL, status, duration, byte counts.
- **`XMLHttpRequest` calls** — RN polyfills XHR (and `fetch` is implemented on top of it on some platforms); both paths are covered.
- **Render errors** — `<TracewayProvider>` itself acts as an error boundary: exceptions thrown during render or in lifecycle methods are captured and re-thrown so the app behaves exactly as without Traceway.
- **Console output** — `console.{debug,log,info,warn,error}` is mirrored into the log buffer that rides along the next exception.

## Release Builds and Source Maps

A release build ships one minified bundle (`index.android.bundle`, `main.jsbundle`), so its stack frames point into that bundle instead of your source files. Traceway resolves a frame against an uploaded source map by the frame's file name: frames in `index.android.bundle` are looked up in an upload named `index.android.bundle.map`. Upload the map of every release build, keeping the file name the build produced.

Uploads use a dedicated **upload token**, not the token in your connection string. Open the project's **Connection** page, find the **Source Map Upload** card and click **Generate Upload Token**.

The [`traceway-sourcemaps`](https://www.npmjs.com/package/@tracewayapp/sourcemap-upload) CLI uploads every `.map` file under a directory:

```bash
npm install -D @tracewayapp/sourcemap-upload

export TRACEWAY_URL="https://cloud.tracewayapp.com"
export TRACEWAY_SOURCEMAP_TOKEN="your-upload-token"

npx traceway-sourcemaps --directory android/app/build/generated/sourcemaps/react/release
```

`TRACEWAY_URL` is the origin of your Traceway instance, without `/api/report`. `--url` and `--token` can be passed as flags instead of the two variables. See the [React Native guide](https://docs.tracewayapp.com/client/react-native) for how to make Android and iOS release builds emit the map and where they write it, and the [source map upload reference](https://docs.tracewayapp.com/client/js-sdk/sourcemap-upload) for the CLI and the HTTP endpoint behind it.

## Platform Support

| Platform | Error Tracking | Screen Recording |
|----------|----------------|------------------|
| iOS (RN ≥ 0.72) | Yes | No |
| Android (RN ≥ 0.72) | Yes | No |
| Expo (SDK 49+) | Yes — works in Expo Go | No |
| Web (via React Native Web) | Yes | No |

For native Android-only apps without React Native, use the [`com.tracewayapp:traceway`](https://github.com/tracewayapp/traceway-android) library. For browser apps, use [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend) or [`@tracewayapp/react`](https://www.npmjs.com/package/@tracewayapp/react).

## Running the example app

The `examples/expo-demo` directory is a tiny throwaway Expo app with buttons that exercise every capture path (caught throw, uncaught throw, render error, fetch error, custom action).

The demo resolves `@tracewayapp/react-native` and `@tracewayapp/core` to the workspace packages, so build them first. From the repo root:

```bash
npm install
npm run build --workspace=@tracewayapp/core
npm run build --workspace=@tracewayapp/react-native
```

Then point it at your own Traceway backend:

```bash
cd packages/react-native/examples/expo-demo
npm install
TRACEWAY_DSN="YOUR_TOKEN@https://cloud.tracewayapp.com/api/report" npx expo start
```

Then open it in **Expo Go** (scan the QR code), or press `i` / `a` for iOS simulator / Android emulator.

If `TRACEWAY_DSN` is missing, the app falls back to a placeholder DSN that won't reach any real server — the buttons still fire so you can verify the UI. See the [example's README](examples/expo-demo/README.md) for what each button does.

## Running the tests

Vitest unit tests cover the wire-format, the rolling event buffer, ignore-pattern handling, transport, retry logic, and stack-trace formatting against fake Hermes / JavaScriptCore stacks.

```bash
npm test --workspace=@tracewayapp/react-native
```

## Publishing

This package is released together with every other active `@tracewayapp/*` package, at one shared version, by the monorepo's [Release npm packages](https://github.com/tracewayapp/js-client/actions/workflows/publish.yml) GitHub Actions workflow. See the [repository README](https://github.com/tracewayapp/js-client#publishing) for how a release is run.

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [React Native guide](https://docs.tracewayapp.com/client/react-native)
- [Source repository](https://github.com/tracewayapp/js-client)
- [Web SDK](https://www.npmjs.com/package/@tracewayapp/react)
- [Android SDK](https://github.com/tracewayapp/traceway-android)

## License

MIT
