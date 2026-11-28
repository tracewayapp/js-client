<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://opensource.org/license/mit"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
  <a href="https://www.npmjs.com/org/tracewayapp"><img src="https://img.shields.io/badge/npm-%40tracewayapp-cb3837.svg" alt="npm org"></a>
</p>

# Traceway JavaScript SDKs

Official JavaScript / TypeScript client SDKs for [Traceway](https://tracewayapp.com) — an open-source error tracking and observability platform. This monorepo holds every Traceway package on npm under the `@tracewayapp/*` scope.

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

## Changes in 2.1.0

The browser SDK starts with `init({ token: "YOUR_TOKEN" })`. It sends to Traceway Cloud unless `baseUrl` names a self-hosted server, every other option goes in the same object, and the React, Vue, Svelte and jQuery packages take the same `token` and `baseUrl`. Upgrading from 2.0: the connection string still works, with one deprecation warning that names the new form. `token@https://host/api/report` becomes `{ token, baseUrl: "https://host" }`, and for Traceway Cloud just `{ token }`; every variation of the old string (with or without `/api` or `/api/report`, a trailing slash, no scheme) keeps working.

Exceptions, messages, log lines and actions now say which screen the page showed, with the keys of the mobile SDKs (`app.screen.name`, `app.screen.route`, …), and `recordNavigation` reports navigation the address does not show. `tracer()` returns the SDK's OpenTelemetry tracer for spans of your own. `replay.images` decides what the replay shows of pictures, and the `traceway-mask` and `traceway-blank` classes hide parts of the page from it. The SDK never takes the page down: a failure of its own code is contained, and `debug: true` logs it, along with every dropped event and why. `startInteraction` returns a `TracewayInteraction` and `beforeCapture` gets a `TracewayCapturedError`, with the names the mobile SDKs use. The legacy `/api/report` transport and its auto-probe are removed: the SDK always sends OTLP, and the `transport` option is ignored. All packages are released together as 2.1.0. See the [CHANGELOG](CHANGELOG.md) for every change.

## Changes in 2.0.1

Browser metrics now use route templates from supported routers automatically. React data routers can be passed to `TracewayProvider` with `router={router}`; apps using React Router's declarative mode or the Next.js App Router can use `useTracewayRoute(pathname, params)`. See [route setup by framework](packages/frontend/README.md#route-names).

Page-load metrics wait until export to pick up the landing route's name. Path normalization also groups percent-encoded ASCII segments, preserves optional parameters before another segment, and replacement navigation counts distinct paths even when they normalize to the same route. All ten active packages are released together as 2.0.1.

## Migration guide from v1 to v2

The v2 browser SDK uses OpenTelemetry for logs, request spans, and real user monitoring (RUM) metrics. Traceway can manage collection remotely over OpAMP and store session replay separately. These changes apply to the browser SDK and its React, Vue, Svelte, and jQuery wrappers. `@tracewayapp/react-native` shares the version number but keeps its own API and its native `/api/report` transport, so a React Native app has nothing to migrate.

Upgrade the Traceway packages your application installs directly to the same version. A vanilla browser app needs only the frontend package. A React app can install the React wrapper, which pulls in the matching frontend SDK.

```sh
npm install @tracewayapp/frontend@2
# or @tracewayapp/react@2, @tracewayapp/vue@2, @tracewayapp/svelte@2, @tracewayapp/jquery@2
```

With a CDN script, change the pinned major from `@1` to `@2`: `https://cdn.jsdelivr.net/npm/@tracewayapp/frontend@2/dist/traceway.iife.global.js`.

| If your v1 app uses… | What to do in v2 |
| --- | --- |
| `init(connectionString, options)` or a framework provider | Start with `init({ token, ...options })`, or the `token` prop or field of the provider or plugin, with the project token you already have. Add `baseUrl` only for a self-hosted server (see [Changes in 2.1.0](#changes-in-210) for how the old string maps). Initialize once per page: a second `init()` is ignored. To reinitialize with different options, call `await shutdown()` first. |
| `captureException`, `captureMessage`, `recordAction`, or session attributes (`setAttribute`, `setAttributes`, `removeAttribute`, `clearAttributes`) | Keep these calls. Pass per-error string attributes as the second argument to `captureException(error, attributes)` or `captureExceptionWithAttributes(error, attributes)`. Remove the old `distributedTraceId` option from both calls. For explicit correlation across a user action, use `startInteraction(name)` and its `run`, `captureException`, and `end` methods. |
| `traceway-trace-id`, `DISTRIBUTED_TRACE_HEADER`, `getActiveDistributedTraceId()`, or `createAxiosInterceptor()` | Remove the custom header and interceptor. The SDK instruments browser fetch and XHR (including Axios) and propagates W3C `traceparent` on same-origin requests. For a cross-origin API, add the start of its URLs (a string such as `"https://api.example.com/"`) or a `RegExp` to `propagateTraceHeaderCorsUrls` and allow `traceparent` in the API's CORS policy. |
| `installGlobalHandlers`, `installConsoleInstrumentation`, `installNavigationInstrumentation`, or `formatBrowserStackTrace` | Let `init()` install the handlers and pass the original error to `captureException()`. Import legacy report types such as `CollectionFrame` from `@tracewayapp/core` if you still consume that format. |
| A `beforeCapture` callback that reads `stackTrace` | Read `error`, `type`, `message`, `isMessage`, `stack`, and `attributes` from the callback argument (`TracewayCapturedError`). Return `false` to drop the event. `ignoreErrors` matches the error type and message. |
| `eventsWindowMs`, `eventsMaxCount`, `debounceMs`, or `retryDelayMs` | Set retention with `collection.buffer.maxAgeSeconds` (seconds) and `collection.buffer.maxBytes` (bytes). Use `exportDelayMs` for log and span batching. The SDK manages retries for failed exports. |
| `recordAllSessions` or error-triggered replay | Keep `recordAllSessions: true` to stream every session's replay and breadcrumbs. Without it, errors and messages stream, most breadcrumbs and replay are buffered, and the built-in exception trigger can upload up to ten minutes of breadcrumbs and a 30-second clip. |
| `flush()` before a redirect or after an error | Keep it. In v2 `flush()` only sends what is queued. It no longer stops the recorder or ends the session, and it does not release buffered breadcrumbs. |
| A self-hosted server that only accepts v1 reports | Upgrade the server first: the SDK sends OTLP only, so a server without the OTLP endpoints receives nothing. A server without OpAMP (it answers 404, 405 or 501) still receives everything; remote config is then off and the local settings apply. |

**Collection and metrics.** Each signal can stream, stay buffered on the device, or be switched off. `flush()` sends queued exports and pending metrics. A trigger or capture can release buffered history. Performance metrics aggregate on the device and export every five minutes by default, even when individual performance events are buffered. Use `track()` for a named event, `count()` for a counter, and `metric()` for a distribution.

**Sessions.** v1 reported a session only with `recordAllSessions`. v2 reports the start and end of every session unless you set `sessions: false`. The replay still stays on the device until an error, a trigger, or a capture asks for it.

**Issues regroup once.** v2 sends the browser's raw stack, which Traceway normalizes differently from the text v1 formatted on the device. Existing issues of a v1 app start new groups after the upgrade.

**Staying on v1.** v1 keeps working against current Traceway servers. `latest` on npm is now 2.x, so pin the major: `npm install @tracewayapp/frontend@1`. The docs keep a [v1 reference](https://docs.tracewayapp.com/client/js-sdk/v1), and the [migration page](https://docs.tracewayapp.com/client/js-sdk/migration) repeats this guide.

## Browser setups

Choose one initialization below. For the first two, use the token of your Traceway browser project, here from the `VITE_TRACEWAY_TOKEN` environment variable (`NEXT_PUBLIC_TRACEWAY_TOKEN` in Next.js, `PUBLIC_TRACEWAY_TOKEN` in SvelteKit). The SDK sends to Traceway Cloud; for a self-hosted server, add `baseUrl: import.meta.env.VITE_TRACEWAY_URL`. The collector hosts are examples: replace them with your own. In a framework wrapper, pass `token` (and `baseUrl`) to its provider or plugin and the other options in `options`. For standalone mode, leave out the token.

### 1. OpAMP, RUM, and telemetry on one Traceway server

```ts
import { init } from '@tracewayapp/frontend';

init({
  token: import.meta.env.VITE_TRACEWAY_TOKEN,
  serviceName: 'shop-web',
  environment: 'production',
});
```

The browser polls `/api/otel/v1/opamp` for collection rules, exports to `/api/otel/v1/logs`, `/api/otel/v1/traces`, and `/api/otel/v1/metrics`, and uploads rrweb replay clips to `/api/recordings` on Traceway Cloud (`https://cloud.tracewayapp.com`), or on the `baseUrl` server. To change what browsers collect, open the **Data Collection** page in the project's sidebar in Traceway. To check the installation in a test project, capture an exception after interacting with the page and open its replay from the issue.

### 2. OpAMP, issues, and session replay on Traceway, telemetry on Grafana

This uses the `telemetry` option, which sends logs, traces and metrics to any OTLP/HTTP endpoint; see [Send telemetry to another OpenTelemetry provider](packages/frontend/README.md#send-telemetry-to-another-opentelemetry-provider).

```ts
import { init } from '@tracewayapp/frontend';

init({
  token: import.meta.env.VITE_TRACEWAY_TOKEN,
  serviceName: 'shop-web',
  environment: 'production',
  telemetry: { url: 'https://collector.example.com' },
  collection: {
    signals: {
      console: { mode: 'stream', minSeverity: 'warn' },
      custom: { mode: 'stream' },
      network: { mode: 'stream' },
    },
  },
});
```

Point `telemetry.url` at the browser-facing HTTPS endpoint of Grafana Alloy or an OpenTelemetry Collector. Enable an OTLP/HTTP receiver there and allow your app's origin, POST, and the request headers through CORS. Forward the receiver's logs, traces, and metrics to the OTLP endpoint from your Grafana Cloud stack's **OpenTelemetry** tile. Configure the Grafana credentials on the collector. The SDK appends `/v1/logs`, `/v1/traces`, and `/v1/metrics` to the browser-facing URL. Configure your metrics pipeline to accept delta counters and exponential histograms or convert them for your backend. [Grafana Cloud OTLP setup](https://grafana.com/docs/grafana-cloud/send-data/otlp/send-data-otlp/)

For example, run this OpenTelemetry Collector configuration (tested with `otelcol` 0.165.0) behind the HTTPS endpoint above. Forward requests to the collector on port 4318, preserving the path. Replace the allowed origin with your app's origin. On the collector, set `GRAFANA_OTLP_ENDPOINT` to the stack's OTLP base URL (including `/otlp` where supplied) and `GRAFANA_AUTHORIZATION` to the complete `Basic …` header value from Grafana.

```yaml
receivers:
  otlp:
    protocols:
      http:
        endpoint: 127.0.0.1:4318
        cors:
          allowed_origins: ["https://shop.example.com"]

exporters:
  otlp_http/grafana:
    endpoint: ${env:GRAFANA_OTLP_ENDPOINT}
    headers:
      Authorization: ${env:GRAFANA_AUTHORIZATION}

service:
  pipelines:
    logs:    { receivers: [otlp], exporters: [otlp_http/grafana] }
    traces:  { receivers: [otlp], exporters: [otlp_http/grafana] }
    metrics: { receivers: [otlp], exporters: [otlp_http/grafana] }
```

Traceway receives OpAMP requests, exceptions, `captureMessage` issues, session and SDK control events, and replay clips. Grafana receives ordinary logs and app events, request spans, and aggregate browser performance metrics. Redirected breadcrumbs appear in Grafana. Use `session.id` on logs and spans to find telemetry for a Traceway replay. To check both destinations, call `track('checkout.started')` and `captureMessage('checkout test issue')` in a test session. Look for the first in Grafana Logs and the second in Traceway Issues.

To route just one signal, supply a complete URL such as `telemetry.metrics.url` and omit the shared base. Other signals then use Traceway. Use HTTP(S) URLs without embedded credentials, query strings, or fragments. Per-signal `headers` override shared `telemetry.headers`. External destinations receive only the credentials configured for them. Retries and restored buffers follow the same routing as live exports.

### 3. Local collection without OpAMP

```ts
import { init, count, metric } from '@tracewayapp/frontend';

init({
  serviceName: 'shop-web',
  telemetry: { url: 'https://collector.example.com' },
  collection: {
    signals: {
      console: { mode: 'stream', minSeverity: 'warn' },
      custom: { mode: 'stream' },
      network: { mode: 'stream', sampleRate: 0.25 },
    },
    metrics: { flushSeconds: 30 },
  },
});

count('checkout.completed');
metric('checkout.duration', 840, { plan: 'pro' });
```

Leaving out the `token` selects standalone mode. Errors go to the collector as OTLP logs. A local session ID supports correlation. All SDK exports go to the configured telemetry receivers and the browser skips OpAMP, Traceway session reporting, and replay uploads. Supply a shared OTLP base URL or complete URLs for all three signals. To check this setup, run the two metric calls above and look for a POST to `/v1/metrics` after the configured interval.

To keep Traceway issues and replay with a **local** policy, pass the token and turn off OpAMP explicitly. This configuration streams custom events and skips both the OpAMP poll and the cached remote policy.

```ts
import { init } from '@tracewayapp/frontend';

init({
  token: import.meta.env.VITE_TRACEWAY_TOKEN,
  serviceName: 'shop-web',
  remoteConfig: false,
  collection: { signals: { custom: { mode: 'stream' } } },
});
```

Local `collection` settings override SDK defaults. To disable automatic exception lookback uploads, set `collection.triggers` to `[{ id: 'default-exception', enabled: false }]`. In managed setups, cached or live remote rules overlay the local policy. Options such as `captureLogs: false` and `sessionRecording: false` take precedence over both. [Browser SDK options and collection defaults](packages/frontend/README.md#options)

## Finding a user's sessions

v2 reports every session by default, so finding a user's sessions needs no recording option. Attach the user's identity as a global attribute, at initialization when it is already known or later:

```ts
import { init, setAttribute, setAttributes, clearAttributes } from "@tracewayapp/frontend";

init({
  token: import.meta.env.VITE_TRACEWAY_TOKEN,
  attributes: { "user.id": "u_42" },
});

// When identity becomes available after initialization:
setAttribute("user.id", "u_42");
setAttributes({ tenant: "acme", plan: "pro" });

// On logout, remove app-defined context:
clearAttributes();
```

Attribute values are strings. `setAttribute`, `setAttributes`, `removeAttribute`,
and `clearAttributes` update the open session at once and apply to later exceptions and messages.
The React, Vue, Svelte, and jQuery integrations accept the same initialization options.
In Traceway's Sessions page, search for the user ID, or add an attribute filter
such as `user.id` = `u_42`. Filters appear as editable chips and can be combined.

A session's replay is uploaded only when something asks for it: an error clip, a trigger, a capture, or
`recordAllSessions: true`. Use the key `user.id` so that a capture or a rule on the **Data Collection** page can
target the user. The SDK asks for its settings again shortly after a global attribute changes; call
`refreshConfig()` to do it at once, for example right after login.

## Packages

Every package below lives in `packages/<name>/` and is published as `@tracewayapp/<name>` on npm. All non-deprecated packages move in lockstep — one version, one release.

### Browser & framework SDKs

| Package | Version | Description |
|---------|---------|-------------|
| [`@tracewayapp/frontend`](packages/frontend) | <a href="https://www.npmjs.com/package/@tracewayapp/frontend"><img src="https://img.shields.io/npm/v/@tracewayapp/frontend.svg" alt="npm"></a> | Browser SDK — built on OpenTelemetry (2.x): errors, console, navigation, clicks, web vitals, `fetch` / XHR spans with `traceparent`, performance metrics aggregated on the device, rrweb session replay; local collection configuration or remote control over OpAMP |
| [`@tracewayapp/react`](packages/react) | <a href="https://www.npmjs.com/package/@tracewayapp/react"><img src="https://img.shields.io/npm/v/@tracewayapp/react.svg" alt="npm"></a> | React wrapper — `<TracewayProvider>` (also an error boundary), `useTraceway()` and `useTracewayRoute()` hooks |
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
| [`@tracewayapp/core`](packages/core) | <a href="https://www.npmjs.com/package/@tracewayapp/core"><img src="https://img.shields.io/npm/v/@tracewayapp/core.svg" alt="npm"></a> | Shared types and utilities for the browser and React Native SDKs, plus the 2.x control plane (settings, triggers, buffer, metric aggregation). Zero runtime dependencies. You probably don't need to install this directly |
| [`@tracewayapp/opamp`](packages/opamp) | <a href="https://www.npmjs.com/package/@tracewayapp/opamp"><img src="https://img.shields.io/npm/v/@tracewayapp/opamp.svg" alt="npm"></a> | Minimal OpAMP client over plain HTTP (fetch), used by the browser SDK for remote config. Zero runtime dependencies |

### Tooling

| Package | Version | Description |
|---------|---------|-------------|
| [`@tracewayapp/sourcemap-upload`](packages/sourcemap-upload) | <a href="https://www.npmjs.com/package/@tracewayapp/sourcemap-upload"><img src="https://img.shields.io/npm/v/@tracewayapp/sourcemap-upload.svg" alt="npm"></a> | CLI for uploading `.map` files so the dashboard can resolve minified production stack traces |
| [`@tracewayapp/bundler-plugin`](packages/bundler-plugin) | <a href="https://www.npmjs.com/package/@tracewayapp/bundler-plugin"><img src="https://img.shields.io/npm/v/@tracewayapp/bundler-plugin.svg" alt="npm"></a> | Embeds debug IDs for exact source-map matching in Vite, Rollup, and webpack builds |

### Deprecated

These packages are no longer actively developed. New backend integrations should use [OpenTelemetry](https://opentelemetry.io/) instead — see the [OTel guide](https://docs.tracewayapp.com/client/otel). The packages are frozen at version `1.0.3` and get no further version bumps.

| Package | Replacement |
|---------|-------------|
| [`@tracewayapp/backend`](packages/backend) | [Node.js + OTel](https://docs.tracewayapp.com/client/otel/nodejs) |
| [`@tracewayapp/nestjs`](packages/nestjs) | [NestJS + OTel](https://docs.tracewayapp.com/client/otel/nestjs) |

## Architecture

```
┌──────────────────────────────┐      ┌──────────────────────────────┐
│ @tracewayapp/core            │      │ @tracewayapp/opamp           │
│ (zero deps)                  │      │ (zero deps)                  │
└───────┬──────────────┬───────┘      └──────────────┬───────────────┘
        │              │                             │
        │              └────────┬────────────────────┘
        ▼                       ▼
 ┌──────────────┐     ┌────────────────────┐
 │ /react-native│     │ @tracewayapp/      │
 │  (RN, Expo)  │     │   frontend         │
 └──────────────┘     │ (browser, rrweb)   │
                      └─────────┬──────────┘
                                │
          ┌──────────┬──────────┼──────────┬──────────┐
          ▼          ▼          ▼          ▼          ▼
      ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
      │ /react │ │ /vue   │ │/svelte │ │/jquery │ │ direct │
      │        │ │        │ │        │ │        │ │ usage  │
      └────────┘ └────────┘ └────────┘ └────────┘ └────────┘
```

In 2.x, `frontend` exports OpenTelemetry (OTLP/HTTP JSON) with local collection settings or optional Traceway OpAMP control (`@tracewayapp/opamp`); replay goes to a separate recordings endpoint. See `INTERNAL_DOCS.md` for the design.

`@tracewayapp/core` is platform-agnostic: the native report types, `EventBuffer`, `parseConnectionString` and `generateUUID`, plus the 2.x settings, triggers, ring buffer and metric aggregation. `frontend` is the browser SDK with rrweb; the framework wrappers (`react`, `vue`, `svelte`, `jquery`) are thin layers on top. `react-native` does **not** depend on `frontend` — it builds directly on `core` so the bundle stays free of `rrweb` and other browser-only APIs that don't exist on Hermes / JSC. `sourcemap-upload` and `bundler-plugin` are build-time tools that depend on none of the packages above.

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

These commands install 2.x. Append `@2` to pin the major, or `@1` to stay on the previous browser SDK. For browser apps, follow one of the [three browser setups](#browser-setups). For React Native and Expo, use the [native setup guide](packages/react-native).

## Repo layout

```
js-client/
├── packages/
│   ├── core/              # Foundation — types, utilities, 2.x control plane, zero deps
│   ├── opamp/             # OpAMP client over HTTP, used by frontend for remote config
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
│   ├── bundler-plugin/    # Debug IDs for Vite, Rollup, and webpack builds
│   ├── backend/           # DEPRECATED — use OTel
│   └── nestjs/            # DEPRECATED — use OTel
├── docs/releases.md       # Release setup and operations
├── scripts/               # Release, bundle-size, and browser test runners
├── tests/                 # Playwright browser tests and release-tool tests
├── INTERNAL_DOCS.md       # Design notes for the 2.x browser SDK
├── package.json           # npm workspaces root
├── .github/workflows/publish.yml  # Stable and beta npm releases
├── deprecate.sh           # One-shot deprecate + final-version publish for backend/nestjs
├── tsconfig.base.json     # Shared TS config inherited by every package
└── vitest.config.ts       # Test discovery — globs packages/*/vitest.config.ts
```

## Development

The release workflow uses Node.js 24 and npm 11.20.0.

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

Use [Actions → Release npm packages](https://github.com/tracewayapp/js-client/actions/workflows/publish.yml)
for stable and beta releases. See [release setup and operations](docs/releases.md) for the npm Trusted
Publisher configuration and how to run or resume a release. No npm token is required.

The workflow publishes all ten active workspace packages in dependency order, including OpAMP.
Stable releases such as `2.0.0` use the npm tag `latest`. Prereleases use `beta`.
The workflow sets package versions and internal dependencies in its release checkout.
After publishing, it pushes a `vVERSION` Git tag at the source commit. Dry runs never create tags.
The run retains the versioned tarballs and their source commit in an artifact.

The older `publish.sh` and fixed-version `release-beta-2.0.0` scripts are retained for historical use;
use the GitHub workflow for new releases. Run release-tool tests with
`node --test tests/release/*.test.*`.

For the deprecated `backend` and `nestjs` packages, `deprecate.sh` is a separate one-shot that publishes the final pinned `1.0.3` version with a deprecation notice and `npm deprecate`'s every prior version.

## Lockstep versioning

Why every active package shares a single version: the framework wrappers (`react`, `vue`, `svelte`, `jquery`) all depend on a specific `@tracewayapp/frontend` version, and `react-native` depends on a specific `@tracewayapp/core` version. Bumping any one package without rebuilding the others would create a window where `npm install @tracewayapp/react` pulls in an incompatible `frontend`. Lockstep avoids that.

The deprecated `backend` and `nestjs` packages are excluded from this rule — they're frozen at `1.0.3` and won't get version bumps anymore.

## Links

- [Traceway Website](https://tracewayapp.com)
- [Documentation](https://docs.tracewayapp.com)
- [Main Traceway repo](https://github.com/tracewayapp/traceway) — backend, dashboard, deployment guides
- [Flutter SDK](https://github.com/tracewayapp/traceway-flutter) — sister repo
- [Android SDK](https://github.com/tracewayapp/traceway-android) — sister repo

## License

[MIT License](https://opensource.org/license/mit).
