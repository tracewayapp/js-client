<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://github.com/tracewayapp/traceway-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://www.npmjs.com/org/tracewayapp"><img src="https://img.shields.io/badge/npm-%40tracewayapp-cb3837.svg" alt="npm org"></a>
</p>

# Traceway JavaScript SDKs

Official JavaScript / TypeScript client SDKs for [Traceway](https://tracewayapp.com) — an open-source error tracking and observability platform. This monorepo holds every Traceway package on npm under the `@tracewayapp/*` scope.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

## Packages

Every package below lives in `packages/<name>/` and is published as `@tracewayapp/<name>` on npm. All non-deprecated packages move in lockstep — one version, one release.

### Browser & framework SDKs

| Package | Version | Description |
|---------|---------|-------------|
| [`@tracewayapp/frontend`](packages/frontend) | <a href="https://www.npmjs.com/package/@tracewayapp/frontend"><img src="https://img.shields.io/npm/v/@tracewayapp/frontend.svg" alt="npm"></a> | Browser SDK — `window.onerror`, `unhandledrejection`, console logs, `fetch` / XHR actions, History API navigation, rrweb session replay, gzip transport |
| [`@tracewayapp/react`](packages/react) | <a href="https://www.npmjs.com/package/@tracewayapp/react"><img src="https://img.shields.io/npm/v/@tracewayapp/react.svg" alt="npm"></a> | React wrapper — `<TracewayProvider>`, `<TracewayErrorBoundary>`, `useTraceway()` hook |
| [`@tracewayapp/vue`](packages/vue) | <a href="https://www.npmjs.com/package/@tracewayapp/vue"><img src="https://img.shields.io/npm/v/@tracewayapp/vue.svg" alt="npm"></a> | Vue 3 plugin + `useTraceway()` composable |
| [`@tracewayapp/svelte`](packages/svelte) | <a href="https://www.npmjs.com/package/@tracewayapp/svelte"><img src="https://img.shields.io/npm/v/@tracewayapp/svelte.svg" alt="npm"></a> | Svelte / SvelteKit context-based setup |
| [`@tracewayapp/jquery`](packages/jquery) | <a href="https://www.npmjs.com/package/@tracewayapp/jquery"><img src="https://img.shields.io/npm/v/@tracewayapp/jquery.svg" alt="npm"></a> | jQuery integration — auto-captures `$.ajax` errors |

### Mobile

| Package | Version | Description |
|---------|---------|-------------|
| [`@tracewayapp/react-native`](packages/react-native) | <a href="https://www.npmjs.com/package/@tracewayapp/react-native"><img src="https://img.shields.io/npm/v/@tracewayapp/react-native.svg" alt="npm"></a> | React Native + Expo — `ErrorUtils` global handler, `fetch` / XHR actions, console logs, device info attributes. Pure JS, works in Expo Go |

### Foundation

| Package | Version | Description |
|---------|---------|-------------|
| [`@tracewayapp/core`](packages/core) | <a href="https://www.npmjs.com/package/@tracewayapp/core"><img src="https://img.shields.io/npm/v/@tracewayapp/core.svg" alt="npm"></a> | Shared types and utilities consumed by every other SDK. Zero runtime dependencies. You probably don't need to install this directly |

### Tooling

| Package | Version | Description |
|---------|---------|-------------|
| [`@tracewayapp/sourcemap-upload`](packages/sourcemap-upload) | <a href="https://www.npmjs.com/package/@tracewayapp/sourcemap-upload"><img src="https://img.shields.io/npm/v/@tracewayapp/sourcemap-upload.svg" alt="npm"></a> | CLI for uploading `.map` files so the dashboard can resolve minified production stack traces |

### Deprecated

These packages are no longer actively developed. New backend integrations should use [OpenTelemetry](https://opentelemetry.io/) instead — see the [OTel guide](https://docs.tracewayapp.com/client/otel). The packages still receive security fixes but are frozen at version `1.0.3`.

| Package | Replacement |
|---------|-------------|
| [`@tracewayapp/backend`](packages/backend) | [Node.js + OTel](https://docs.tracewayapp.com/client/node-sdk) |
| [`@tracewayapp/nestjs`](packages/nestjs) | [NestJS + OTel](https://docs.tracewayapp.com/client/nestjs) |

## Architecture

```
                  ┌──────────────────────────────┐
                  │ @tracewayapp/core            │  Types, EventBuffer, parseConnectionString,
                  │ (zero deps)                  │  generateUUID, nowISO, wire-format definitions
                  └──────────────┬───────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                  │
              ▼                  ▼                  ▼
   ┌────────────────────┐ ┌──────────────┐ ┌──────────────────────┐
   │ @tracewayapp/      │ │ /react-native│ │ /sourcemap-upload    │
   │   frontend         │ │  (RN, Expo)  │ │  (CLI tool)          │
   │ (browser, rrweb)   │ │              │ │                      │
   └─────────┬──────────┘ └──────────────┘ └──────────────────────┘
             │
   ┌─────────┴──────────┬─────────┬─────────┬──────────┐
   ▼                    ▼         ▼         ▼          ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│ /react │ │ /vue   │ │/svelte │ │/jquery │ │ direct │
│        │ │        │ │        │ │        │ │ usage  │
└────────┘ └────────┘ └────────┘ └────────┘ └────────┘
```

`@tracewayapp/core` is platform-agnostic. `frontend` is the browser SDK with rrweb; the framework wrappers (`react`, `vue`, `svelte`, `jquery`) are thin layers on top. `react-native` does **not** depend on `frontend` — it builds directly on `core` so the bundle stays free of `rrweb`, `CompressionStream`, and other browser-only APIs that don't exist on Hermes / JSC.

## Getting started as a user

Pick the package that matches your stack and follow its README:

```bash
# Browser
npm install @tracewayapp/frontend

# React (browser)
npm install @tracewayapp/react

# Vue 3
npm install @tracewayapp/vue

# Svelte / SvelteKit
npm install @tracewayapp/svelte

# jQuery
npm install @tracewayapp/jquery

# React Native / Expo
npm install @tracewayapp/react-native
```

Then [generate a connection string](https://docs.tracewayapp.com) on your Traceway dashboard and pass it to `init(...)` (or the framework's provider equivalent).

## Repo layout

```
js-client/
├── packages/
│   ├── core/              # Foundation — types, utilities, zero deps
│   ├── frontend/          # Browser SDK (rrweb, CompressionStream)
│   │   └── examples/
│   │       └── browser-demo/
│   ├── react/
│   │   └── examples/
│   │       └── react-demo/
│   ├── vue/
│   │   └── examples/
│   │       └── vue-demo/
│   ├── svelte/
│   │   └── examples/
│   │       └── svelte-demo/
│   ├── jquery/
│   ├── react-native/      # RN + Expo — built on @tracewayapp/core only
│   │   └── examples/
│   │       └── expo-demo/
│   ├── sourcemap-upload/  # CLI for uploading .map files
│   ├── backend/           # DEPRECATED — use OTel
│   └── nestjs/            # DEPRECATED — use OTel
├── package.json           # npm workspaces root
├── publish.sh             # Lockstep release of every active @tracewayapp/* package
├── deprecate.sh           # One-shot deprecate + final-version publish for backend/nestjs
├── tsconfig.base.json     # Shared TS config inherited by every package
└── vitest.workspace.ts    # Test discovery — globs packages/*/vitest.config.ts
```

## Development

Requires Node.js ≥ 18 and npm ≥ 9.

### Install

```bash
npm install
```

The root `package.json` declares an npm-workspaces array, so a single install at the repo root provisions every package's dependencies and links them to each other (`@tracewayapp/react` resolves to `packages/react/` automatically).

### Build

Build every package via the workspace `build` script (each runs `tsup` to emit ESM + CJS + `.d.ts`):

```bash
npm run build
```

Or build a single package:

```bash
npm run build --workspace=@tracewayapp/react-native
```

Build artifacts land in `packages/<name>/dist/`. The root has no build output of its own.

### Test

Vitest runs across every package via the workspace config. Each package has its own `vitest.config.ts` that defines a project name (`react-native`, `frontend`, etc.):

```bash
# Whole repo
npm test

# Watch mode
npm run test:watch

# One package
npm test --workspace=@tracewayapp/react-native

# One project (works from the repo root)
npx vitest run --project frontend
```

### Run an example

Each example is a standalone app with its own `package.json` (so it can install its own framework deps without polluting the root). Build the workspace first, then run the example:

```bash
npm install
npm run build
cd packages/react/examples/react-demo
npm install
npm run dev
```

The Expo example for React Native has a slightly different invocation — see [`packages/react-native/examples/expo-demo/README.md`](packages/react-native/examples/expo-demo/README.md).

## Publishing

`publish.sh` is the only sanctioned release path. It bumps every active `@tracewayapp/*` package to the same version, syncs cross-package dependency references (so `@tracewayapp/react`'s `dependencies."@tracewayapp/frontend"` always matches the new version), runs the build, and publishes each package to npm in topological order:

```bash
./publish.sh
# Prompts for the new semver, confirms, then runs:
#   - bumps every packages/<name>/package.json
#   - rewrites cross-package version references
#   - runs `npm run build`
#   - publishes each package to npm
```

The script is idempotent — it checks `npm whoami` first, only re-publishes packages that don't already have the target version, and aborts cleanly if any single package fails (no commit or tag is created on failure; fix the issue and re-run).

For the deprecated `backend` and `nestjs` packages, `deprecate.sh` is a separate one-shot that publishes the final pinned `1.0.3` version with a deprecation notice and `npm deprecate`'s every prior version.

## Lockstep versioning

Why every active package shares a single version: the framework wrappers (`react`, `vue`, `svelte`, `jquery`) all peer-depend on a specific `@tracewayapp/frontend` version, and `react-native` peer-depends on a specific `@tracewayapp/core` version. Bumping any one package without rebuilding the others would create a window where `npm install @tracewayapp/react` pulls in an incompatible `frontend`. Lockstep avoids that.

The deprecated `backend` and `nestjs` packages are excluded from this rule — they're frozen at `1.0.3` and won't get version bumps anymore.

## Links

- [Traceway Website](https://tracewayapp.com)
- [Documentation](https://docs.tracewayapp.com)
- [Main Traceway repo](https://github.com/tracewayapp/traceway) — backend, dashboard, deployment guides
- [Flutter SDK](https://github.com/tracewayapp/traceway-flutter) — sister repo
- [Android SDK](https://github.com/tracewayapp/traceway-android) — sister repo

## License

MIT — see [LICENSE](LICENSE).
