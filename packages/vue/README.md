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

## With Options

```typescript
app.use(createTracewayPlugin({
  connectionString: "your-token@https://traceway.example.com/api/report",
  options: {
    debug: true,
    version: "1.0.0",
  },
}));
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
