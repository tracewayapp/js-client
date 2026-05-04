<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

# Traceway Expo Demo

A throwaway Expo app that exercises every capture path of [`@tracewayapp/react-native`](https://www.npmjs.com/package/@tracewayapp/react-native): caught/uncaught throws, render errors via `TracewayErrorBoundary`, unhandled promise rejections, automatic `fetch` capture, manual `captureMessage` / `recordAction` / `setDeviceAttributes`, and explicit `flush()`.

Built against **Expo SDK 54** (React 19.1, React Native 0.81, New Architecture on by default).

## Run it

From the **monorepo root** so the workspace `@tracewayapp/*` packages are built:

```bash
npm install
npm run build --workspace=@tracewayapp/react-native
```

Then in this directory:

```bash
cd packages/react-native/examples/expo-demo
npm install
TRACEWAY_DSN="<your-token>@http://<your-host>:8082/api/report" npx expo start --clear
```

If `TRACEWAY_DSN` is not set, the app falls back to a placeholder DSN that won't reach a real server — the buttons still fire so you can verify the UI.

Open the QR code in the **Expo Go** app on your phone, or press `i` / `a` to open the iOS simulator / Android emulator.

The diagnostic panel at the top of the screen shows the parsed API URL, the masked token, and the auto-collected device attributes — so you can confirm the env var was picked up before tapping anything.

## Why a custom `metro.config.js`?

Metro is told about the monorepo root so it can resolve `@tracewayapp/react-native` and `@tracewayapp/core` to the local workspace packages — no `npm publish` needed during development.

It also pins `react` and `react-native` to this example's local copies via `resolveRequest`. Without that, when Metro bundles the SDK source from `packages/react-native/dist/`, it would walk up and find the workspace root's older React, ending with two React instances in the bundle.

## Links

- [React Native SDK](https://www.npmjs.com/package/@tracewayapp/react-native)
- [Traceway Website](https://tracewayapp.com)
