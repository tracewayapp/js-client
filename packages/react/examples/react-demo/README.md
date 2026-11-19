<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

# Traceway React Demo

A throwaway Vite + React app that exercises the capture paths of [`@tracewayapp/react`](https://www.npmjs.com/package/@tracewayapp/react): caught throws and manual `captureMessage` through the `useTraceway()` hook, uncaught errors and unhandled promise rejections through the SDK's global handlers, render-time and effect errors caught by `<TracewayErrorBoundary>` with a fallback UI, and `flush()`.

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
npm run dev
```

Open the URL Vite prints (default `http://localhost:5173`).

The first screen asks for a connection string in the form `token@url` (for example `your-token@https://traceway.example.com/api/report`); **Initialize SDK** then mounts `TracewayProvider` with it. Nothing has to be edited in the source. If the server in the connection string does not exist, the buttons still fire so you can verify the UI — the events just won't reach a backend.

The **Network Error (bad domain)** button captures a `Failed to fetch` error, which the SDK's default `ignoreErrors` patterns drop, so it does not show up as an issue.

## Links

- [React SDK](https://www.npmjs.com/package/@tracewayapp/react)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)
- [React guide](https://docs.tracewayapp.com/client/react)
- [Traceway Website](https://tracewayapp.com)
