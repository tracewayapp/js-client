<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/vue"><img src="https://img.shields.io/npm/v/@tracewayapp/vue.svg" alt="npm"></a>
  <a href="https://github.com/tracewayapp/traceway-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway Vue SDK

Error tracking and session replay for Vue 3 apps. Provides a plugin with a global `errorHandler`, a `useTraceway()` composable, and inherits the full instrumentation pipeline from [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend).

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

## Features

- Vue 3 plugin that registers a global `app.config.errorHandler` and runs `init()` once
- `useTraceway()` composable for capturing exceptions and messages from any component
- Inherits everything from [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend): rrweb session replay, console logs, network/navigation actions, gzip transport
- Vue Router push/replace flows through the History API and is captured automatically
- Simple one-line setup

## Installation

```bash
npm install @tracewayapp/vue
```

## Quick Start

Install the plugin in your Vue application:

```ts
import { createApp } from "vue";
import { createTracewayPlugin } from "@tracewayapp/vue";
import App from "./App.vue";

const app = createApp(App);

app.use(createTracewayPlugin({
  connectionString: "your-token@https://traceway.example.com/api/report",
  options: { version: "1.0.0" },
}));

app.mount("#app");
```

That's it. The plugin runs `init(...)` once, which installs `window.onerror`, `unhandledrejection`, a global Vue `errorHandler`, the `console.*` mirror, the `fetch` / `XHR` instrumentation, the History API instrumentation, and the rrweb recorder.

## Manual Capture

```vue
<script setup>
import { useTraceway } from "@tracewayapp/vue";

const { captureException, captureMessage } = useTraceway();

async function handleSubmit() {
  try {
    await submitForm();
  } catch (error) {
    captureException(error);
  }
}
</script>

<template>
  <button @click="handleSubmit">Submit</button>
</template>
```

To record a custom action breadcrumb, import `recordAction` directly from `@tracewayapp/frontend` (it's not on the composable surface):

```ts
import { recordAction } from "@tracewayapp/frontend";

recordAction("checkout", "payment_submitted", { amount: 42 });
```

## Custom Attributes (global scope)

Attach app-level identifiers (`userId`, `tenant`, feature flags, etc.) once and have them ride along every subsequent session and exception:

```ts
import {
  setAttribute,
  setAttributes,
  removeAttribute,
  clearAttributes,
} from "@tracewayapp/vue";

setAttribute("userId", "u_42");
setAttributes({ tenant: "acme", plan: "pro" });

// ...later, on logout / tenant switch:
clearAttributes();
```

In a Vue component, drive the scope from a `watchEffect` so it tracks reactive state:

```vue
<script setup>
import { watchEffect } from "vue";
import { setAttributes, clearAttributes } from "@tracewayapp/vue";
import { useUser } from "./auth";

const { user, org } = useUser();
watchEffect(() => {
  if (user.value && org.value) {
    setAttributes({ userId: user.value.id, tenant: org.value.id });
  } else {
    clearAttributes();
  }
});
</script>
```

Layering order on each event: `auto-collected defaults < global scope < per-call attributes`. See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#custom-attributes-global-scope) for the full mechanics.

## Always-on Session Recording

Pass `recordAllSessions: true` to upload full sessions continuously (not just exception-bound clips):

```ts
app.use(createTracewayPlugin({
  connectionString: "your-token@https://traceway.example.com/api/report",
  options: { recordAllSessions: true, version: "1.0.0" },
}));
```

See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend#always-on-session-recording) for the full description.

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
| `recordAllSessions` | `false` | Always-on session recording (every ~30 s segment uploaded continuously) |
| `eventsWindowMs` | `10000` | Rolling window kept in the log/action buffers (ms) |
| `eventsMaxCount` | `200` | Hard cap applied independently to logs and actions |

See the [`@tracewayapp/frontend` README](https://www.npmjs.com/package/@tracewayapp/frontend) for the full options reference.

## Logs & Actions

Each captured exception ships with the buffered logs, actions, and replay frames:

- **Logs** — `console.{debug, log, info, warn, error}` mirrored into a rolling buffer.
- **Actions** — `fetch` / `XHR` and History API navigations recorded as breadcrumbs. Vue Router push/replace/pop is captured automatically.
- **Session recordings** — rrweb-based replay of the seconds leading up to each exception.

## API

### `createTracewayPlugin(config)`

Returns a Vue plugin that initializes Traceway and registers a global error handler.

| Field | Type | Description |
|-------|------|-------------|
| `connectionString` | `string` | Traceway connection string (`token@url`) |
| `options` | `TracewayFrontendOptions` | Forwarded to `init()` from `@tracewayapp/frontend` |

### `useTraceway()`

Returns `{ captureException, captureExceptionWithAttributes, captureMessage }`.

Throws if used outside a Vue app where the Traceway plugin has been installed.

## Platform Support

| Environment | Error Tracking | Session Replay |
|---|---|---|
| Vue 3.3+ in any modern browser | Yes | Yes |
| Vite / Nuxt 3 (client) | Yes | Yes |
| Vue 2 | No (use [`@tracewayapp/frontend`](https://www.npmjs.com/package/@tracewayapp/frontend) directly) | No |

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [Browser SDK](https://www.npmjs.com/package/@tracewayapp/frontend)

## License

MIT
