<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

# Traceway Browser Demo

A throwaway Vite app that loads [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend) directly (no framework wrapper) and exercises the basic capture paths: `init({ token })`, a manual `captureException`, a manual `captureMessage`, an uncaught throw picked up by the global handler, and `flush()`. A second row of buttons shows the 2.1 features: `log()`, `recordNavigation()`, a span of your own from `tracer()`, and `startInteraction()` with `setAttribute` and `end`. The page also has a `traceway-mask` line, and the SDK starts with `replay.images: "always"`.

## Run it

From the **monorepo root**, so the SDK's dependencies are installed and the workspace `@tracewayapp/*` packages are built (the demo's Vite config loads `@tracewayapp/frontend` and `@tracewayapp/core` from source, and `@tracewayapp/opamp` from its build):

```bash
npm install
npm run build
```

Then in this directory:

```bash
cd packages/frontend/examples/browser-demo
npm install
VITE_TRACEWAY_TOKEN=YOUR_TOKEN npm run dev
```

For a self-hosted server, also set `VITE_TRACEWAY_URL` to its address. Without it the demo sends to Traceway Cloud.

Open the URL Vite prints (default `http://localhost:5173`).

With `VITE_TRACEWAY_TOKEN` set, the page starts the SDK at once. Otherwise paste the project token (and, for a self-hosted server, its address) into the fields and click **Initialize SDK**; the other buttons stay disabled until then. `init()` runs once per page, so reload to try a different token. The SDK starts with `debug: true`, so the console shows what it sends, drops and why.

With the 2.x defaults, the exception and the message are sent right away, and an exception also uploads the breadcrumbs and the replay clip buffered before it: the `log()` line, the navigation, the spans and the interaction are breadcrumbs, so capture an exception after them to see them in the dashboard. **Flush** sends whatever is still queued; it does not upload buffered breadcrumbs by itself. The page code is in `main.ts`.

## Links

- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)
- [Browser SDK documentation](https://docs.tracewayapp.com/client/js-sdk)
- [Traceway Website](https://tracewayapp.com)
