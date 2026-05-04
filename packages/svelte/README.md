<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/svelte"><img src="https://img.shields.io/npm/v/@tracewayapp/svelte.svg" alt="npm"></a>
  <a href="https://github.com/tracewayapp/traceway-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway Svelte SDK

Error tracking and session replay for Svelte and SvelteKit apps. Provides `setupTraceway()` / `getTraceway()` context helpers on top of [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend).

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

## Features

- Context-based setup that initializes Traceway exactly once during component init
- `getTraceway()` helper for capturing exceptions and messages from any descendant component
- Inherits everything from [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend): rrweb session replay, console logs, network/navigation actions, gzip transport
- SvelteKit's client-side routing flows through the History API and is captured automatically
- Simple one-line setup

## Installation

```bash
npm install @tracewayapp/svelte
```

## Quick Start

Call `setupTraceway` in your root component:

```svelte
<script>
  import { setupTraceway } from "@tracewayapp/svelte";

  setupTraceway({
    connectionString: "your-token@https://traceway.example.com/api/report",
    options: { version: "1.0.0" },
  });
</script>

<slot />
```

That's it. `setupTraceway` runs `init(...)` once, which installs `window.onerror`, `unhandledrejection`, the `console.*` mirror, the `fetch` / `XHR` instrumentation, the History API instrumentation, and the rrweb recorder.

### SvelteKit

In SvelteKit, set up Traceway in the root layout — and gate it on the `browser` import so it doesn't run during SSR:

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { setupTraceway } from "@tracewayapp/svelte";
  import { browser } from "$app/environment";

  if (browser) {
    setupTraceway({
      connectionString: "your-token@https://traceway.example.com/api/report",
    });
  }
</script>

<slot />
```

## Manual Capture

Use `getTraceway` in child components:

```svelte
<script>
  import { getTraceway } from "@tracewayapp/svelte";

  const { captureException } = getTraceway();

  async function handleSubmit() {
    try {
      await submitForm();
    } catch (error) {
      captureException(error);
    }
  }
</script>

<button on:click={handleSubmit}>Submit</button>
```

To record a custom action breadcrumb, import `recordAction` directly from `@tracewayapp/frontend` (it's not on the context surface):

```ts
import { recordAction } from "@tracewayapp/frontend";

recordAction("checkout", "payment_submitted", { amount: 42 });
```

## Options

The `options` field forwards directly to [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend). The most-used flags:

| Option | Default | Description |
|--------|---------|-------------|
| `version` | `""` | App version string, attached to every report |
| `debug` | `false` | Print debug info to the console |
| `captureLogs` | `true` | Mirror `console.*` into the rolling log buffer |
| `captureNetwork` | `true` | Record `fetch` / `XHR` as network actions |
| `captureNavigation` | `true` | Record History API push / replace / pop as navigation actions |
| `sessionRecording` | `true` | Enable the rrweb session recorder |
| `eventsWindowMs` | `10000` | Rolling window kept in the log/action buffers (ms) |
| `eventsMaxCount` | `200` | Hard cap applied independently to logs and actions |

See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend) for the full options reference.

## Logs & Actions

Each captured exception ships with the buffered logs, actions, and replay frames:

- **Logs** — `console.{debug, log, info, warn, error}` mirrored into a rolling buffer.
- **Actions** — `fetch` / `XHR` and History API navigations recorded as breadcrumbs. SvelteKit's client-side routing is captured automatically.
- **Session recordings** — rrweb-based replay of the seconds leading up to each exception.

## API

### `setupTraceway(config)`

Initializes Traceway and stores the API in Svelte context. Must be called during component initialization.

| Field | Type | Description |
|-------|------|-------------|
| `connectionString` | `string` | Traceway connection string (`token@url`) |
| `options` | `TracewayFrontendOptions` | Forwarded to `init()` from `@tracewayapp/frontend` |

Returns `{ captureException, captureExceptionWithAttributes, captureMessage }`.

### `getTraceway()`

Returns `{ captureException, captureExceptionWithAttributes, captureMessage }`.

Throws if used outside a component tree where `setupTraceway` has been called.

## Platform Support

| Environment | Error Tracking | Session Replay |
|---|---|---|
| Svelte 4+ in any modern browser | Yes | Yes |
| SvelteKit (browser) | Yes | Yes |
| SvelteKit SSR | Skip — gate on `$app/environment.browser` | No |

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)

## License

MIT
