# Traceway JavaScript Client

A monorepo containing JavaScript/TypeScript SDKs for Traceway error tracking.

## Packages

| Package | Description |
|---------|-------------|
| [`@traceway/core`](./packages/core) | Core types and utilities |
| [`@traceway/frontend`](./packages/frontend) | Browser SDK with global error handlers |
| [`@traceway/react`](./packages/react) | React integration with Provider and ErrorBoundary |
| [`@traceway/vue`](./packages/vue) | Vue.js integration with plugin and composable |
| [`@traceway/svelte`](./packages/svelte) | Svelte integration with context setup |

## Quick Start

### React

```tsx
import { TracewayProvider, TracewayErrorBoundary, useTraceway } from "@traceway/react";

function App() {
  return (
    <TracewayProvider connectionString="your-token@https://your-server.com/api/report">
      <TracewayErrorBoundary fallback={<div>Something went wrong</div>}>
        <MyApp />
      </TracewayErrorBoundary>
    </TracewayProvider>
  );
}

function MyComponent() {
  const { captureException, captureMessage } = useTraceway();

  async function handleClick() {
    try {
      await doSomething();
    } catch (err) {
      captureException(err as Error);
    }
  }

  return <button onClick={handleClick}>Do Something</button>;
}
```

### Vue

```ts
// main.ts
import { createApp } from "vue";
import { createTracewayPlugin } from "@traceway/vue";
import App from "./App.vue";

const app = createApp(App);

app.use(
  createTracewayPlugin({
    connectionString: "your-token@https://your-server.com/api/report",
  })
);

app.mount("#app");
```

```vue
<!-- Component.vue -->
<script setup lang="ts">
import { useTraceway } from "@traceway/vue";

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

### Svelte

```svelte
<!-- App.svelte (root component) -->
<script>
  import { setupTraceway } from "@traceway/svelte";

  setupTraceway({
    connectionString: "your-token@https://your-server.com/api/report",
  });
</script>

<slot />
```

```svelte
<!-- Component.svelte -->
<script>
  import { getTraceway } from "@traceway/svelte";

  const { captureException, captureMessage } = getTraceway();

  function handleClick() {
    try {
      doSomething();
    } catch (err) {
      captureException(err);
    }
  }
</script>

<button on:click={handleClick}>Do Something</button>
```

### Vanilla JavaScript

```ts
import * as traceway from "@traceway/frontend";

// Initialize once at app startup
traceway.init("your-token@https://your-server.com/api/report", {
  debug: true, // optional: log captured errors to console
});

// Manual capture
try {
  doSomething();
} catch (err) {
  traceway.captureException(err);
}

// Capture with attributes
traceway.captureExceptionWithAttributes(error, {
  userId: "user-123",
  page: "/checkout",
});

// Capture a message
traceway.captureMessage("User completed checkout");

// Force flush (usually automatic)
await traceway.flush();
```

## Package Details

### @traceway/core

Core types and utilities shared across all packages.

```ts
import { nowISO, type ExceptionStackTrace, type ReportRequest } from "@traceway/core";
```

### @traceway/frontend

Browser SDK that provides:
- `init(connectionString, options?)` - Initialize the SDK
- `captureException(error)` - Capture an error
- `captureExceptionWithAttributes(error, attributes)` - Capture with metadata
- `captureMessage(message)` - Capture a message
- `flush()` - Force send buffered events

Automatically installs global handlers for:
- `window.onerror` - Uncaught exceptions
- `window.onunhandledrejection` - Unhandled promise rejections

### @traceway/react

React-specific integration:
- `TracewayProvider` - Context provider that initializes the SDK
- `TracewayErrorBoundary` - Error boundary that auto-captures render errors
- `useTraceway()` - Hook to access capture methods

### @traceway/vue

Vue.js integration:
- `createTracewayPlugin(options)` - Vue plugin for initialization
- `useTraceway()` - Composable to access capture methods
- Automatic `app.config.errorHandler` for Vue component errors

### @traceway/svelte

Svelte integration:
- `setupTraceway(options)` - Initialize and provide context
- `getTraceway()` - Get capture methods from context

## Error Handling Patterns

### React

```tsx
// Automatic via ErrorBoundary (render errors)
<TracewayErrorBoundary fallback={<ErrorUI />}>
  <MyComponent />
</TracewayErrorBoundary>

// Manual in event handlers
const { captureException } = useTraceway();
try {
  await riskyOperation();
} catch (err) {
  captureException(err as Error);
}
```

### Vue

```vue
<script setup>
// Automatic via errorHandler (component errors)
// Manual capture:
const { captureException } = useTraceway();

async function handleClick() {
  try {
    await riskyOperation();
  } catch (err) {
    captureException(err);
  }
}
</script>
```

### Svelte

```svelte
<script>
  // Manual capture:
  const { captureException } = getTraceway();

  function handleClick() {
    try {
      riskyOperation();
    } catch (err) {
      captureException(err);
    }
  }
</script>
```

### Global Errors (All Frameworks)

The SDK automatically captures:
- Uncaught exceptions (`window.onerror`)
- Unhandled promise rejections (`window.onunhandledrejection`)

## Development

### Prerequisites

- Node.js >= 18
- npm >= 9

### Setup

```bash
npm install
```

### Build

```bash
npm run build
```

### Test

```bash
npm test
```

### Run Demo Apps

```bash
# React
cd packages/react/examples/react-demo && npm install && npm run dev

# Vue
cd packages/vue/examples/vue-demo && npm install && npm run dev

# Svelte
cd packages/svelte/examples/svelte-demo && npm install && npm run dev
```

## Connection String Format

```
<token>@<endpoint>
```

Example:
```
abc123@https://traceway.example.com/api/report
```

The connection string is parsed into:
- **Token**: Authentication token for your project
- **Endpoint**: URL where error reports are sent

## License

MIT
