<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

# Traceway Browser Demo

A throwaway Vite app that loads [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend) directly (no framework wrapper) and exercises the basic capture paths: `init()`, a manual `captureException`, a manual `captureMessage`, an uncaught throw picked up by the global handler, and `flush()`.

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
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`).

Paste your project's connection string (`token@https://your-traceway-server`, with or without a trailing `/api/report`) into the field and click **Initialize SDK**; the other buttons stay disabled until then. `init()` runs once per page, so reload to try a different connection string.

With the 2.x defaults, the exception and the message are sent right away, and an exception also uploads the breadcrumbs and the replay clip buffered before it. **Flush** sends whatever is still queued; it does not upload buffered breadcrumbs by itself. The page code is in `main.ts`.

## Links

- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)
- [Browser SDK documentation](https://docs.tracewayapp.com/client/js-sdk)
- [Traceway Website](https://tracewayapp.com)
