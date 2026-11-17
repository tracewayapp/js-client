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
| [`@tracewayapp/frontend`](packages/frontend) | <a href="https://www.npmjs.com/package/@tracewayapp/frontend"><img src="https://img.shields.io/npm/v/@tracewayapp/frontend.svg" alt="npm"></a> | Browser SDK — built on OpenTelemetry (2.x): errors, console, navigation, clicks, web vitals, `fetch` / XHR spans with `traceparent`, rrweb session replay; local collection configuration or remote control over OpAMP |
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
| [`@tracewayapp/core`](packages/core) | <a href="https://www.npmjs.com/package/@tracewayapp/core"><img src="https://img.shields.io/npm/v/@tracewayapp/core.svg" alt="npm"></a> | Shared types and utilities consumed by every other SDK, plus the 2.x control plane (settings, triggers, buffer). Zero runtime dependencies. You probably don't need to install this directly |
| [`@tracewayapp/opamp`](packages/opamp) | — | Minimal OpAMP client over plain HTTP (fetch), used by the browser SDK for remote config. Zero runtime dependencies |

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

In 2.x, `frontend` exports OpenTelemetry (OTLP/HTTP JSON) with local collection settings or optional Traceway OpAMP control (`@tracewayapp/opamp`); replay goes to a separate recordings endpoint. See `INTERNAL_DOCS.md` for the design.

`@tracewayapp/core` is platform-agnostic. `frontend` is the browser SDK with rrweb; the framework wrappers (`react`, `vue`, `svelte`, `jquery`) are thin layers on top. `react-native` does **not** depend on `frontend` — it builds directly on `core` so the bundle stays free of `rrweb` and other browser-only APIs that don't exist on Hermes / JSC.

## Local configuration without OpAMP

The browser SDK supports both static collection policies and Traceway-managed policies. To use only OpenTelemetry, pass an options object to `init` instead of a Traceway connection string:

```ts
import { init, metric, count } from '@tracewayapp/frontend';

init({
  serviceName: 'shop-web',
  telemetry: { url: 'https://collector.example.com/otlp' },
  exportDelayMs: 2000,
  collection: {
    signals: {
      errors: { mode: 'stream' },
      console: { mode: 'stream', minSeverity: 'warn' },
      network: { mode: 'stream', sampleRate: 0.25 },
      custom: { mode: 'stream' },
      resourceTiming: { mode: 'off' },
    },
    metrics: { enabled: true, sampleRate: 1, flushSeconds: 30 },
    buffer: { persist: false, maxAgeSeconds: 60 },
    triggers: [{ id: 'default-exception', enabled: false }],
  },
});

metric('checkout.duration', 840, { plan: 'pro' });
count('checkout.completed');
```

No Traceway server, account, or token is required. Standalone mode disables OpAMP, legacy fallback, Traceway session metadata, and replay uploads, even if those options are enabled. A local session ID still supports sampling and telemetry correlation. Exceptions are ordinary OTLP logs sent to your collector. The SDK retains its error filters and collection defaults; set `ignoreErrors: []` to remove the built-in error filters.

`collection` is a typed partial settings document (`CollectionSettings`). It controls signal modes (`off`, `buffer`, `stream`), sampling, console severity, metrics, buffer retention, replay, and local triggers. Omitted fields retain SDK defaults: most breadcrumbs are buffered, errors stream, and metrics flush every 300 seconds. Triggers merge by ID; disable `default-exception` explicitly to stop automatic lookback uploads. `exportDelayMs` controls log/span batching; `collection.metrics.flushSeconds` controls metric uploads (clamped to 30–3600 seconds). `flush()` sends queued exports and metrics, but does not release buffered events; a trigger's `flush` action releases those.

With a Traceway connection string, use `remoteConfig: false` and `collection` for static configuration while retaining Traceway exceptions and replay. No cached remote policy is read and no OpAMP request is sent. With remote config enabled, precedence is built-in defaults → local `collection` → cached/live remote overlay → `capture*`, `sessions`, and `sessionRecording` ceilings. Triggers and captures also respect those ceilings.

## Traceway exceptions and replay, external logs and metrics

Keep Traceway's control plane and replay storage while exporting ordinary logs, spans, and metrics to another OTLP backend:

```ts
import { init } from '@tracewayapp/frontend';

init('PROJECT_TOKEN@https://traceway.example.com', {
  serviceName: 'shop-web',
  telemetry: {
    url: 'https://collector.example.com/otlp',
    // Optional overrides use complete signal URLs, with no path appended.
    metrics: { url: 'https://metrics.example.com/v1/metrics' },
    logs: { url: 'https://logs.example.com/v1/logs' },
  },
  collection: {
    signals: { console: { mode: 'stream' }, network: { mode: 'stream' } },
    metrics: { flushSeconds: 30 },
  },
});
```

A shared `telemetry.url` appends `/v1/logs`, `/v1/traces`, and `/v1/metrics`. Each signal can override it with `{ url, headers }`. Without a shared base, unspecified signals keep their Traceway destination; standalone mode requires a base or all three signal URLs. URLs must use HTTP(S), without embedded credentials, a query, or a fragment. Signal headers override shared `telemetry.headers`; Traceway's token is never added to external requests.

When logs are redirected, exception events, `captureMessage` issues, and SDK control/session metadata go only to Traceway. Ordinary console/custom/performance logs go to the logs receiver; network spans and metrics use their own destinations. OpAMP and rrweb recordings keep using the Traceway connection string. This lets an OTLP Collector forward telemetry to a Grafana stack while Traceway stores issues and replays. External breadcrumbs are not copied into Traceway's session timeline. Both destinations retain `session.id` for correlation. Replay is Traceway-specific, outside OTLP.

Live exports, restored buffers, and retries use the configured signal destinations and credentials. Persistent telemetry queues and pending metric batches are isolated by destination. Custom `logExporter`/`spanExporter` overrides replace the corresponding live telemetry exporter; Traceway's issue/session routing still applies, and persisted records use the configured HTTP destinations.

The receiver must support OTLP/HTTP JSON, allow your application's origin, POST, and configured headers through CORS. See the [OpenTelemetry browser exporter guide](https://opentelemetry.io/docs/languages/js/exporters/). Use browser-safe ingestion credentials or your own ingestion proxy; keep backend credentials on the collector. Metrics use delta counters and exponential histograms, so configure the downstream pipeline to accept or convert those types.

These options apply to the 2.x browser SDK and its React, Vue, Svelte, and jQuery wrappers. Their `connectionString` argument/prop also accepts the standalone options object. React Native still uses the separate native reporting transport.

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
│   ├── frontend/          # Browser SDK (rrweb, browser instrumentation)
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

Use [Actions → Release npm packages](https://github.com/tracewayapp/js-client/actions/workflows/release.yml)
for stable and beta releases. See [release setup and operations](docs/releases.md) for the npm Trusted
Publisher configuration and how to run or resume a release. No npm token is required.

The workflow publishes all ten active workspace packages in dependency order, including OpAMP.
Stable versions (`2.1.0`) use `latest`; beta versions (`2.1.0-beta.1`) use `beta` without changing `latest`.
Version and internal dependency updates happen in the release checkout; main's manifests stay unchanged.
The run retains the versioned tarballs and their source commit in an artifact.

The older `publish.sh` and fixed-version `release-beta-2.0.0` scripts are retained for historical use;
use the GitHub workflow for new releases. Run release-tool tests with
`node --test tests/release/*.test.*`.

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

## Finding a user's sessions

Enable always-on recording and optionally supply identity attributes at initialization:

```ts
import { init, setAttributes, clearAttributes } from "@tracewayapp/frontend";

init("your-token@https://traceway.example.com/api/report", {
  recordAllSessions: true,
  attributes: { userId: "u_42", email: "alice@example.com" },
});

// When identity becomes available after initialization:
setAttributes({ userId: "u_42", tenant: "acme" });

// On logout, remove app-defined context:
clearAttributes();
```

Attribute values are strings. `setAttribute`, `setAttributes`, `removeAttribute`,
and `clearAttributes` refresh the current session and affect subsequent exceptions.
The React, Vue, Svelte, and jQuery integrations accept the same initialization options.
In Traceway's Sessions page, search for a user ID or email, or add an attribute filter
such as `userId=u_42`. Filters appear as editable chips and can be combined.

The `attributes` initialization option is optional. Existing initialization calls
and `/api/report` payloads without session attributes remain supported.
