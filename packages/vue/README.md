# @tracewayapp/vue

Vue.js integration for Traceway. Provides a plugin with automatic error handling and a composable hook.

## Setup

```ts
import { createApp } from "vue";
import { createTracewayPlugin } from "@tracewayapp/vue";
import App from "./App.vue";

const app = createApp(App);

app.use(
  createTracewayPlugin({
    connectionString: "your-token@https://your-server.com/api/report",
    options: { debug: true }, // optional
  })
);

app.mount("#app");
```

## Automatic Error Handling

The plugin automatically installs a global error handler (`app.config.errorHandler`) that captures all Vue component errors and reports them to Traceway.

## useTraceway Composable

Access capture methods from any component.

```vue
<script setup lang="ts">
import { useTraceway } from "@tracewayapp/vue";

const { captureException, captureMessage } = useTraceway();

function handleClick() {
  try {
    doSomething();
  } catch (err) {
    captureException(err as Error);
  }
}
</script>

<template>
  <button @click="handleClick">Do Something</button>
</template>
```

## API

### createTracewayPlugin(options)

Creates a Vue plugin that initializes Traceway.

| Option | Type | Description |
|--------|------|-------------|
| `connectionString` | `string` | Traceway connection string (`token@url`) |
| `options` | `TracewayFrontendOptions` | Optional SDK configuration |

### useTraceway()

Returns `{ captureException, captureExceptionWithAttributes, captureMessage }`.

Throws if used outside a Vue app with the Traceway plugin installed.

## Requirements

- Vue >= 3.3
- `@tracewayapp/frontend` (installed automatically as dependency)
