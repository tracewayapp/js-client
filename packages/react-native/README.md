<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/react-native"><img src="https://img.shields.io/npm/v/@tracewayapp/react-native.svg" alt="npm"></a>
  <a href="https://github.com/tracewayapp/traceway-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway React Native SDK

Error tracking for React Native and Expo apps. Capture exceptions with full stack traces, plus the last ~10 seconds of console logs, HTTP calls, navigation transitions, and custom breadcrumbs — automatically.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

This is the React Native counterpart to [`@tracewayapp/react`](https://www.npmjs.com/package/@tracewayapp/react) (web) and [`com.tracewayapp:traceway`](https://github.com/tracewayapp/traceway-android) (native Android). The wire format is identical, so the same Traceway backend ingests reports from all three.

> **No screen recording.** Unlike the browser SDK (`@tracewayapp/frontend`), this package does not record the screen. The `rrweb` recorder is intentionally absent — nothing in the bundle reaches into a DOM that doesn't exist.

## Features

- Automatic capture of every uncaught throw via React Native's `ErrorUtils` global handler
- Automatic capture of unhandled promise rejections
- Full Hermes / JavaScriptCore stack traces, normalized to Traceway's wire format
- **Logs** — every `console.{debug,log,info,warn,error}` line from the last ~10 seconds
- **Actions** — every `fetch` and `XMLHttpRequest` call, plus navigation transitions you wire in, plus custom breadcrumbs
- React surface: `<TracewayProvider>`, `<TracewayErrorBoundary>`, `useTraceway()` hook
- Debounced, retrying batch transport over plain `fetch` (no native modules, works in Expo Go)
- Simple one-line setup

## Installation

```bash
npm install @tracewayapp/react-native
```

The package is plain JavaScript — no native modules, no `pod install`, no Gradle changes. It works in Expo Go, in bare React Native CLI projects, and in EAS builds.

## Quick Start

Wrap your app in `TracewayProvider` from your entry component (typically `App.tsx`). Mounting the provider runs `init(...)` once, which installs the `ErrorUtils` global handler, the `fetch` / XHR wrappers, and the console mirror.

```tsx
import { TracewayProvider, TracewayErrorBoundary } from "@tracewayapp/react-native";

export default function App() {
  return (
    <TracewayProvider
      connectionString="your-token@https://your-traceway-instance.com/api/report"
      options={{ version: "1.0.0" }}
    >
      <TracewayErrorBoundary fallback={<CrashScreen />}>
        <RootNavigator />
      </TracewayErrorBoundary>
    </TracewayProvider>
  );
}
```

That's it. Every uncaught throw, unhandled promise rejection, and `fetch` call is captured automatically.

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

## Options

All field names mirror the browser and Android SDKs so existing config can be ported as-is.

| Option | Default | Description |
|--------|---------|-------------|
| `version` | `""` | App version string, attached to every report |
| `debug` | `false` | Print debug info to the console |
| `debounceMs` | `1500` | Milliseconds before flushing batched events |
| `retryDelayMs` | `10000` | Retry delay on failed uploads |
| `ignoreErrors` | sensible defaults | Array of `string \| RegExp` patterns; matching exceptions are dropped |
| `beforeCapture` | none | `(exception) => boolean` — return `false` to drop |
| `captureLogs` | `true` | Mirror every `console.*` call into the rolling log buffer |
| `captureNetwork` | `true` | Record `fetch` and `XMLHttpRequest` calls as network actions |
| `captureNavigation` | `true` | Record manual `recordNavigation()` calls |
| `eventsWindowMs` | `10000` | Rolling window kept in the log/action buffers (ms) |
| `eventsMaxCount` | `200` | Hard cap applied independently to logs and actions |

The `DEFAULT_IGNORE_PATTERNS` export contains the built-in `ignoreErrors` list (`Network request failed`, `Failed to fetch`, generic 4xx, etc.) — you can extend it rather than replace it.

## Logs & Actions

Every captured exception ships with the last ~10 seconds of session context, attached to the same `sessionRecordings[]` entry the other Traceway SDKs use:

- **Logs** — every `console.{debug,log,info,warn,error}` call. The original `console` output is preserved; we only piggyback on the call.
- **Actions** are split into three channels:
  - **Network** — every `fetch` and `XMLHttpRequest` call (method, URL, status, duration, byte counts). Calls to the Traceway endpoint itself are skipped to avoid recursion.
  - **Navigation** — push transitions you record manually (see below).
  - **Custom** — anything you call `recordAction(...)` with.

Logs and actions are kept in two separate rolling buffers, each capped at 200 entries / 10 seconds. They ship inside `sessionRecordings[].logs` and `sessionRecordings[].actions` on the wire, with `startedAt` / `endedAt` ISO 8601 timestamps spanning the captured window.

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

## What Gets Captured Automatically

- **Uncaught throws** on the JS thread via `ErrorUtils.setGlobalHandler` — this is RN's equivalent of `window.onerror`. RN's red-box dev overlay still appears; we forward to the previous handler.
- **Unhandled promise rejections** — `Promise.reject(...)` without a `.catch()` reaches the same `ErrorUtils` handler.
- **`fetch` calls** — wrapped at install time. Method, URL, status, duration, byte counts.
- **`XMLHttpRequest` calls** — RN polyfills XHR (and `fetch` is implemented on top of it on some platforms); both paths are covered.
- **Render errors** — when wrapped in `<TracewayErrorBoundary>`, exceptions thrown during render or in lifecycle methods are captured.
- **Console output** — `console.{debug,log,info,warn,error}` is mirrored into the log buffer that rides along the next exception.

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

To point it at your own Traceway backend:

```bash
cd packages/react-native/examples/expo-demo
npm install
TRACEWAY_DSN="YOUR_TOKEN@https://your-traceway-instance.com/api/report" npx expo start
```

Then open it in **Expo Go** (scan the QR code), or press `i` / `a` for iOS simulator / Android emulator.

If `TRACEWAY_DSN` is missing, the app falls back to a placeholder DSN that won't reach any real server — the buttons still fire so you can verify the UI.

## Running the tests

JVM-fast Vitest unit tests cover the wire-format, the rolling event buffer, ignore-pattern handling, transport, retry logic, and stack-trace formatting against fake Hermes / JavaScriptCore stacks.

```bash
npm test --workspace=@tracewayapp/react-native
```

## Publishing

Releases are cut through the monorepo's `publish.sh` — it bumps every `@tracewayapp/*` package in lockstep, syncs cross-package dependency references, builds, and publishes. From the repo root:

```bash
./publish.sh
```

The script prompts for a new semver and confirms before pushing to npm. If publish fails, no commit or tag is created — fix the issue and re-run.

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [Web SDK](https://www.npmjs.com/package/@tracewayapp/react)
- [Android SDK](https://github.com/tracewayapp/traceway-android)

## License

MIT
