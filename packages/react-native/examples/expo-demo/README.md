<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

# Traceway Expo Demo

A throwaway Expo app that exercises every capture path of [`@tracewayapp/react-native`](https://www.npmjs.com/package/@tracewayapp/react-native): caught/uncaught throws, render errors inside a `TracewayErrorBoundary` (deprecated, still exported), automatic `fetch` capture, manual `captureMessage` / `recordAction` / `setDeviceAttributes`, and explicit `flush()`. It also has a button for the one path the SDK does not cover, an unhandled promise rejection.

Built against **Expo SDK 54** (React 19.1, React Native 0.81, New Architecture on by default). The app depends on the workspace copy of the SDK (`file:../..`), which is `@tracewayapp/react-native` 2.0.0: the same API, options and native `/api/report` transport as 1.x.

## Run it

From the **monorepo root**, build the two workspace packages the app loads. `@tracewayapp/core` goes first because the React Native package imports it:

```bash
npm install
npm run build --workspace=@tracewayapp/core
npm run build --workspace=@tracewayapp/react-native
```

Then in this directory:

```bash
cd packages/react-native/examples/expo-demo
npm install
TRACEWAY_DSN="<your-token>@https://cloud.tracewayapp.com/api/report" npx expo start --clear
```

`TRACEWAY_DSN` is the connection string from your project's **Connection** page, used as it is: the SDK posts to that exact URL, so keep the `/api/report` path. `app.config.ts` reads the variable when Expo starts and passes it to the app through `extra.tracewayDsn`, so restart `expo start` after changing it.

For a self-hosted server, use its address instead of `https://cloud.tracewayapp.com`. If `TRACEWAY_DSN` is not set, the app falls back to a placeholder token that the server rejects — the buttons still fire so you can verify the UI.

Open the QR code in the **Expo Go** app on your phone, or press `i` / `a` to open the iOS simulator / Android emulator.

The diagnostic panel at the top of the screen shows the parsed API URL, the masked token, and the auto-collected device attributes — so you can confirm the env var was picked up before tapping anything. Expect two device attributes, `device.locale` and `runtime.engine`; the other keys `collectSyncDeviceInfo()` knows about stay empty under Metro (see the [SDK README](../../README.md#1-device-info--auto-collected)).

## What the buttons do

The provider is mounted with `debug: true`, so the SDK logs what it drops and any failed upload to the Metro console.

| Button | What happens |
|--------|--------------|
| Send raw POST to apiUrl (bypasses SDK) | Posts a minimal gzipped report with plain `fetch` and shows the HTTP status. Use it to tell a connectivity or token problem from an SDK problem |
| Caught exception (auto-flush) | `captureException` in a `catch`, then `flush()` |
| Uncaught throw (ErrorUtils) | Throws from a timer; the SDK's `ErrorUtils` global handler reports it |
| Unhandled rejection (ErrorUtils) | Rejects a promise without a `.catch()`. Despite the label, the SDK does **not** report this: it installs only the `ErrorUtils` handler and React Native does not route unhandled rejections through it. Nothing reaches the dashboard |
| Render-time throw (boundary) | Throws while rendering inside the `TracewayErrorBoundary` at the bottom of the screen, which reports it and shows its fallback |
| fetch HTTP 500 | Requests `https://httpstat.us/500` and reports the app's own `Fetch error: HTTP 500` with `captureException`. The request itself is recorded as a network action |
| fetch bad host | Calls `captureException` with the network error, but React Native's `Network request failed` is on the SDK's default `ignoreErrors` list, so the report is dropped (the console shows `Traceway: exception suppressed by filter`). The request still appears as a network action on the next report |
| captureMessage | Sends a message |
| recordAction | Records a custom action that rides along with the next report |
| setDeviceAttributes (+tenant/build/session) & ship | Replaces the device attribute map, sends a message and flushes, so you can check the attributes on the dashboard |
| flush | Sends whatever is pending now |

## Why a custom `metro.config.js`?

Metro is told about the monorepo root so it can resolve `@tracewayapp/react-native` and `@tracewayapp/core` to the local workspace packages — no `npm publish` needed during development.

It also pins `react` and `react-native` to this example's local copies via `resolveRequest`. Without that, when Metro bundles the SDK source from `packages/react-native/dist/`, it would walk up and find the workspace root's older React, ending with two React instances in the bundle.

## Links

- [React Native SDK](https://www.npmjs.com/package/@tracewayapp/react-native)
- [React Native guide](https://docs.tracewayapp.com/client/react-native)
- [Traceway Website](https://tracewayapp.com)
