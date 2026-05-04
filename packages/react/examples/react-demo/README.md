<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

# Traceway React Demo

A throwaway Vite + React app that exercises every capture path of [`@tracewayapp/react`](https://www.npmjs.com/package/@tracewayapp/react): caught throws, render-time errors via `<TracewayErrorBoundary>`, manual `captureMessage`, and the `useTraceway()` hook.

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

To point it at your own Traceway backend, edit the connection string in `src/main.tsx`. If you leave the placeholder DSN in, the buttons still fire so you can verify the UI — they just won't reach a real backend.

## Links

- [React SDK](https://www.npmjs.com/package/@tracewayapp/react)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)
- [Traceway Website](https://tracewayapp.com)
