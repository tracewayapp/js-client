# Traceway JavaScript Client

A monorepo containing JavaScript/TypeScript SDKs for Traceway error tracking.

## Packages

| Package | Description |
|---------|-------------|
| [`@traceway/core`](./packages/core) | Core types and utilities |
| [`@traceway/backend`](./packages/backend) | Node.js backend SDK with AsyncLocalStorage context |
| [`@traceway/nestjs`](./packages/nestjs) | NestJS integration with module, middleware, and decorators |
| [`@traceway/frontend`](./packages/frontend) | Browser SDK with global error handlers |
| [`@traceway/react`](./packages/react) | React integration with Provider and ErrorBoundary |
| [`@traceway/vue`](./packages/vue) | Vue.js integration with plugin and composable |
| [`@traceway/svelte`](./packages/svelte) | Svelte integration with context setup |

## Quick Start

### NestJS

```ts
// app.module.ts
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import {
  TracewayModule,
  TracewayMiddleware,
  TracewayExceptionFilter,
} from "@traceway/nestjs";

@Module({
  imports: [
    TracewayModule.forRoot({
      connectionString: "your-token@https://your-server.com/api/report",
      debug: true,
      onErrorRecording: ["url", "query", "body", "headers"],
    }),
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: TracewayExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TracewayMiddleware).forRoutes("*");
  }
}
```

```ts
// Using TracewayService and @Span decorator
import { Injectable } from "@nestjs/common";
import { TracewayService, Span } from "@traceway/nestjs";

@Injectable()
export class UsersService {
  constructor(private readonly traceway: TracewayService) {}

  @Span("db.users.findAll")
  async findAll() {
    // Automatically creates a span for this method
    return this.userRepository.find();
  }

  async doSomething() {
    // Manual span creation
    const span = this.traceway.startSpan("custom.operation");
    try {
      await someOperation();
    } finally {
      this.traceway.endSpan(span);
    }

    // Manual exception capture
    this.traceway.captureException(new Error("Something went wrong"));

    // Set trace attributes
    this.traceway.setTraceAttribute("userId", "123");
  }
}
```

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

### @traceway/backend

Node.js backend SDK with AsyncLocalStorage-based context propagation:

```ts
import {
  init,
  shutdown,
  captureException,
  captureMessage,
  startSpan,
  endSpan,
  measureTask,
  withTraceContext,
  setTraceAttribute,
  setTraceResponseInfo,
  captureCurrentTrace,
} from "@traceway/backend";

// Initialize once at app startup
init("your-token@https://your-server.com/api/report", {
  debug: true,
  version: "1.0.0",
  serverName: "api-server-1",
  sampleRate: 1.0,
  errorSampleRate: 1.0,
});

// Wrap HTTP requests with trace context
withTraceContext({ endpoint: "GET /api/users", clientIP: "127.0.0.1" }, async () => {
  // Create spans for operations
  const span = startSpan("db.query");
  await db.query("SELECT * FROM users");
  endSpan(span);

  // Set response info and capture trace
  setTraceResponseInfo(200, 1024);
  captureCurrentTrace();
});

// Measure background tasks
measureTask("process-emails", async () => {
  await processEmails();
});

// Graceful shutdown
await shutdown();
```

### @traceway/nestjs

NestJS integration with module, middleware, exception filter, and decorators:

- `TracewayModule.forRoot(options)` - Initialize with static configuration
- `TracewayModule.forRootAsync(options)` - Initialize with async configuration
- `TracewayMiddleware` - Request tracing middleware
- `TracewayExceptionFilter` - Global exception filter with error recording
- `TracewayService` - Injectable service for manual operations
- `@Span(name?)` - Decorator for automatic span creation

**Configuration Options:**

```ts
interface TracewayModuleOptions {
  connectionString: string;        // Required: token@endpoint
  debug?: boolean;                 // Log debug info
  version?: string;                // App version
  serverName?: string;             // Server identifier
  sampleRate?: number;             // Trace sampling rate (0-1)
  errorSampleRate?: number;        // Error trace sampling rate (0-1)
  ignoredRoutes?: string[];        // Routes to skip tracing
  onErrorRecording?: Array<"url" | "query" | "body" | "headers">;
}
```

**Async Configuration:**

```ts
@Module({
  imports: [
    TracewayModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connectionString: config.get("TRACEWAY_CONNECTION_STRING"),
        debug: config.get("NODE_ENV") !== "production",
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
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
