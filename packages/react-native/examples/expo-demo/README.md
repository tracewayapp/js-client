# Traceway Expo Demo

A throwaway Expo app that exercises every capture path of `@tracewayapp/react-native`:
caught/uncaught throws, render errors via `TracewayErrorBoundary`, unhandled promise
rejections, automatic `fetch` capture, manual `captureMessage` / `recordAction`, and
explicit `flush()`.

Built against **Expo SDK 54** (React 19.1, React Native 0.81, New Architecture on by default).

## Run it

From the **monorepo root** (so the workspace `@tracewayapp/*` packages are built):

```bash
npm install
npm run build --workspace=@tracewayapp/react-native
```

Then in this directory:

```bash
cd packages/react-native/examples/expo-demo
npm install
TRACEWAY_DSN="<your-token>@http://<your-host>:8082/api/report" npx expo start
```

If `TRACEWAY_DSN` is not set, the app falls back to a placeholder DSN that
won't reach a real server — the buttons still fire so you can verify the UI.

Open the QR code in the **Expo Go** app on your phone, or press `i` / `a` to
open the iOS simulator / Android emulator.

## Why a custom `metro.config.js`?

Metro is told about the monorepo root so it can resolve `@tracewayapp/react-native`
and `@tracewayapp/core` to the local workspace packages — no `npm publish` needed
during development.

It also pins `react` and `react-native` to this example's local copies via
`resolveRequest`. Without that, when Metro bundles the SDK source from
`packages/react-native/dist/`, it would walk up and find the workspace root's
older React, ending with two React instances in the bundle.
