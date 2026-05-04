<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

# Traceway Browser Demo

A throwaway Vite app that loads [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend) directly (no framework wrapper) and exercises every capture path: caught throws, uncaught throws, unhandled rejections, manual `captureMessage`, custom `recordAction` breadcrumbs, and a forced `flush()`.

## Run it

From the **monorepo root** so the workspace `@tracewayapp/*` packages are built:

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

To point it at your own Traceway backend, edit the connection string in `src/main.ts`. If you leave the placeholder DSN in, the buttons still fire so you can verify the UI — they just won't reach a real backend.

## Links

- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)
- [Traceway Website](https://tracewayapp.com)
