# @tracewayapp/vue

Vue 3 integration for Traceway. Provides a plugin with automatic error handling and a composable.

## Installation

```bash
npm install @tracewayapp/vue
```

## Setup

Install the Traceway plugin in your Vue application:

```typescript
import { createApp } from "vue";
import { createTracewayPlugin } from "@tracewayapp/vue";
import App from "./App.vue";

const app = createApp(App);

app.use(createTracewayPlugin({
  connectionString: "your-token@https://traceway.example.com/api/report",
}));

app.mount("#app");
```

The plugin automatically installs a global error handler that captures uncaught errors.

## useTraceway Composable

Use the `useTraceway` composable to capture errors in components:

```vue
<script setup>
import { useTraceway } from "@tracewayapp/vue";

const { captureException } = useTraceway();

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

## Logs, Actions, and Session Recordings

`createTracewayPlugin` calls `init()` from `@tracewayapp/frontend`, so the underlying timeline instrumentation is set up automatically:

- **Logs** — `console.{debug, log, info, warn, error}` mirrored into a rolling buffer (toggle with `captureLogs`).
- **Actions** — `fetch` / `XHR` and History API navigations recorded as breadcrumbs (toggle with `captureNetwork`, `captureNavigation`). Vue Router push/replace flows through the History API and is captured automatically.
- **Session recordings** — rrweb-based replay of the seconds leading up to each exception (toggle with `sessionRecording`).

Each captured exception ships with the buffered logs, actions, and replay frames.

To record a custom action breadcrumb, import `recordAction` directly from `@tracewayapp/frontend` (it's not on the composable surface):

```ts
import { recordAction } from "@tracewayapp/frontend";

recordAction("checkout", "payment_submitted", { amount: 42 });
```

## With Options

```typescript
app.use(createTracewayPlugin({
  connectionString: "your-token@https://traceway.example.com/api/report",
  options: {
    debug: true,
    version: "1.0.0",
    captureLogs: true,
    captureNetwork: true,
    captureNavigation: true,
    sessionRecording: true,
    eventsWindowMs: 10_000,
    eventsMaxCount: 200,
  },
}));
```

See [`@tracewayapp/frontend`](../frontend/README.md) for the full options reference.

## API

### createTracewayPlugin(options)

Creates a Vue plugin that initializes Traceway.

| Option | Type | Description |
|--------|------|-------------|
| `connectionString` | `string` | Traceway connection string (`token@url`) |
| `options` | `TracewayFrontendOptions` | Optional SDK configuration (logs / actions / recording toggles, sampling, etc.) |

### useTraceway()

Returns `{ captureException, captureExceptionWithAttributes, captureMessage }`.

Throws if used outside a Vue app with the Traceway plugin installed.

## Requirements

- Vue >= 3.3
- `@tracewayapp/frontend` (installed automatically as dependency)
