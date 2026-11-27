<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

# Traceway React Demo

A throwaway Vite + React app that exercises the capture paths of [`@tracewayapp/react`](https://www.npmjs.com/package/@tracewayapp/react): caught throws and manual `captureMessage` through the `useTraceway()` hook, uncaught errors and unhandled promise rejections through the SDK's global handlers, render-time and effect errors caught by an error boundary of the app's own with a fallback UI (it reports them with `captureException`), and `flush()`. A second row of buttons shows the 2.1 features: `log()`, `recordNavigation()`, a span of your own from `tracer()`, and `startInteraction()` with `setAttribute` and `end`. The page has a `traceway-mask` line, and the provider starts the SDK with `replay.images: "always"`. Everything comes from `@tracewayapp/react`: the hook and its re-exports of the browser SDK.

## Run it

From the **monorepo root** so the workspace `@tracewayapp/*` packages are built:

```bash
npm install
npm run build
```

Then in this directory:

```bash
cd packages/react/examples/react-demo
npm install
VITE_TRACEWAY_TOKEN=YOUR_TOKEN npm run dev
```

For a self-hosted server, also set `VITE_TRACEWAY_URL` to its address. Without it the demo sends to Traceway Cloud.

Open the URL Vite prints (default `http://localhost:5173`).

With `VITE_TRACEWAY_TOKEN` set, the app mounts `TracewayProvider` with it at once. Otherwise the first screen asks for the project token (and, for a self-hosted server, its address); **Initialize SDK** then mounts the provider with them. Nothing has to be edited in the source. The provider starts the SDK with `debug: true`, so the console shows what it sends, drops and why. The 2.1 buttons record breadcrumbs, which stay on the device until an error: capture one afterwards to see them in the dashboard.

The **Network Error (bad domain)** button captures a `Failed to fetch` error, which the SDK's default `ignoreErrors` patterns drop, so it does not show up as an issue.

## Links

- [React SDK](https://www.npmjs.com/package/@tracewayapp/react)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)
- [React guide](https://docs.tracewayapp.com/client/react)
- [Traceway Website](https://tracewayapp.com)
