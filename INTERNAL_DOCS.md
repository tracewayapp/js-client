# Traceway JavaScript Client

## Version 2 (branch `v2`, unreleased)

2.x rebuilds the browser SDK (`@tracewayapp/frontend`) on OpenTelemetry and lets the Traceway server decide, per group
of clients, what each one sends. Everything below this section describes 1.x and the packages 2.x leaves unchanged
(`react-native` still speaks the native `/api/report` protocol and builds against the 1.x types `@tracewayapp/core`
keeps exporting).

### Transport

| What | Endpoint | Format |
|------|----------|--------|
| Exceptions, messages, console, navigation, user actions, web vitals, resource timing, custom events, session lifecycle | `POST /api/otel/v1/logs` | OTLP/HTTP JSON log records, told apart by `eventName` |
| fetch / XHR | `POST /api/otel/v1/traces` | OTLP/HTTP JSON CLIENT spans; W3C `traceparent` to same-origin URLs and `propagateTraceHeaderCorsUrls` |
| Session replay | `POST /api/recordings` | `{segments, debugIds?}`, gzipped JSON, not OTLP |
| Remote config | `POST /api/otel/v1/opamp` | OpAMP over plain HTTP (protobuf) |

The connection string is unchanged (`<token>@<server>`, a trailing `/api/report` is stripped); `resolveEndpoints` in
`core` derives every URL. All requests carry `Authorization: Bearer <project token>`.

Event names the backend acts on: `exception` (an issue; `traceway.exception.id` is a client UUID the replay clip uses,
`traceway.debug_ids` a JSON map for source maps), `traceway.message` (a message issue), `session.start`,
`session.end`, `traceway.session.update` (session rows; every one carries `traceway.session.started_at` in Unix ms and
the full attribute snapshot). `session.id` is a UUID on every record and span.

### Pipeline

The SDK builds its own `LoggerProvider` and `TracerProvider` (never the global ones, so an app's own OpenTelemetry is
untouched) and registers the Browser SIG instrumentations from `@opentelemetry/browser-instrumentation` against them.
Only the W3C propagator and the context manager are set globally, and only when the page has none. Versions are pinned
exactly to the line `browser-instrumentation` 0.9.0 uses (api 1.9.1, core/sdk-trace 2.12.0, sdk-logs/exporters
0.223.0); mixing in OTel JS 3.0 would duplicate the API singletons.

Every record passes `TelemetryRouter` (`frontend/src/otel/router.ts`): stamp `session.id`, enrich exceptions (id,
debug ids, default and global attributes, `ignoreErrors` on the `Type: message` line, `beforeCapture`), classify the
signal, then route by the effective mode: **stream** to the OTLP batch exporter, **buffer** into the in-memory
`RingBuffer`, **off** dropped. After routing, the trigger engine sees the record, so a flush it causes includes it.

### Settings, triggers and captures

`ControlState` (`core/src/control`) computes the effective settings: SDK defaults (`defaultSettings`, which reproduce
1.x: errors and messages stream, breadcrumbs and replay are buffered, the `default-exception` trigger uploads the last
30 s with a replay clip, subject to a 5 s cooldown and 20 clips per session; `recordAllSessions` streams breadcrumbs and replay), then the remote overlay,
clamped to the ceilings from `init()` options lowered to the document's plan `limits`, then temporary stream overrides
from triggers and captures.

Triggers (`core/src/triggers`) are sequences of matcher steps with `withinSeconds` gaps, per-session state, sample
rate, cooldown and per-session cap. Before routing errors, the frontend ErrorLimiter suppresses identical type/message/stack within 1 s and accepts at most 60 errors per rolling minute per running client. The next accepted error carries the aggregate suppressed count. Healthy lifecycle metadata and web vitals remain on. Optional sessions.baselineSampleRate (default 0) uses a session-ID hash to stream buffered breadcrumbs and request spans consistently across reloads; it never streams replay or overrides an off signal. A step can need `count` matching records within a sliding `periodSeconds` ("5 error
lines in a minute"). Actions: `flush` (lookback upload, optionally replay), `stream` (send the listed signals for N
seconds, this page only), `startReplay`, `emit`, and `capture` (lookback upload, then stream for `durationSeconds`;
kept in localStorage under `traceway:local-captures:<token>` so later pages keep streaming; while it runs the same
trigger only extends it). Every fire emits `traceway.trigger.fired`; a capture also emits `traceway.capture.started`
with `traceway.capture.source: trigger`.

Log lines are matched with `body` and the operators `icontains`, `starts_with` and `glob` (`*`/`?`, case-insensitive,
linear-time, at most 4 KB of the value looked at). There is no regex operator on purpose: a pattern from the server
would run with backtracking on the page's main thread. Matching sees every record, including those of a signal that
is off.

A capture, whether from the dashboard or the `capture` action, also brings back what rules switched off: its `"*"` is
every signal the defaults collect (resource timing, off by default, has to be named), so `includeOff` on the override.
The record that fired a capture trigger is sent too when its signal was off (`TelemetryRouter.sendIfStreaming`), so the
log line that started a capture is in it. Nothing passes the `init()` ceilings, the `enabled` kill switch, or the plan
`limits` the server adds to the document (`applyLimits`: what the organization's plan drops at ingest). The `stream`
action keeps the narrower rule: `"*"` there covers only signals that are not off.

Captures arrive in the settings document from the dashboard. The lookback flush runs once per capture id (remembered
in sessionStorage per tab), streaming lasts until `until` on every page; `traceway.capture.started` marks the start.

### External telemetry destination

Browser options accept `telemetry: { url, headers? }`. The URL is a standard OTLP/HTTP base; logs and spans append `/v1/logs` and `/v1/traces`. All HTTP telemetry paths, including restored buffers and outbox retries, share those endpoints and headers. External requests never inherit the Traceway token. OpAMP and replay remain on the connection-string server. Session lifecycle logs are copied there through a separate batched exporter and durable retry queue, so replay can be opened even when application telemetry goes elsewhere. Instrumentation excludes both destinations, and persistence is scoped by project token plus destination URLs so changing collectors cannot forward old queued telemetry to a new platform. Legacy `/api/report` ingestion remains supported; the dashboard merges legacy recording breadcrumbs with the OTLP timeline.

### Breadcrumbs

Breadcrumbs are telemetry and nothing else: console lines, navigation, clicks, `recordAction` and `track` are log
records, fetch/XHR are CLIENT spans, all with `session.id`. Replay segments carry rrweb events only, so a breadcrumb is
stored once and its mode decides whether it is sent at all (1.x copied the last seconds of them into every segment).
The dashboard reads them back per session with `GET /api/sessions/:id/timeline`. `recordAllSessions` streams them by
default along with replay, so a fully recorded session also has its whole timeline.

### OpAMP

`@tracewayapp/opamp` is a spec-generic plain-HTTP OpAMP client with a hand-written protobuf codec for the ~15 fields
used (`messages.test.ts` checks it byte for byte against opamp-go). It sends full state on every poll, so the stateless
server never needs `ReportFullState` round trips; follows the server's heartbeat (min 30 s); reports
`RemoteConfigStatus` right after applying; backs off on errors and honours Retry-After; does not retry 413; stops on
401/403. The browser SDK polls at start, every heartbeat, when a tab becomes visible after an interval, and two seconds
after a global attribute or the session changes (`refreshConfig()` polls now). The last applied document is cached in
localStorage and applied synchronously at the next `init()`.

### Persistence

`TelemetryPersistence` owns restore/checkpoint/durable delivery. Restored OTLP requests enter the same `RingBuffer`
as live SDK records, so byte and age limits apply to the combined history. Whole serialized records are counted,
including log bodies. `BufferStore` updates IndexedDB snapshots atomically; a sessionStorage checkpoint covers
navigation because the browser may abandon asynchronous IndexedDB writes on pagehide. Replay is not persisted.

`Outbox` retries with backoff while the page is open and drains on `online`, visibility recovery, and startup. Web
Locks serialize drains between tabs. Pruning on drain retains at most 200 batches, at most 24 hours old, below 8
attempts. Export policy is rechecked for live batches and persisted JSON requests. Turning persistence off stops
its timers and clears stored telemetry; the remote-config cache is separate.

### Replay

rrweb (2.2) is imported lazily, so it loads only when replay is not off. `ReplayController` streams completed
segments, or keeps them in a byte- and age-bounded buffer; a flush uploads the buffered segments in the lookback window
plus the in-progress segment as the clip of the triggering exception (it keeps its segment index, so the full segment
later overwrites it on the server).

### Tests

`npm run test:browser` builds the browser bundle and runs Chromium against a disposable local HTTP fixture. Install
the browser once with `npx playwright install chromium`. It covers remote cancellation, hard limits, real rrweb
masking changes, navigation across three pages, final replay on pagehide, and outbox recovery. No cloud service is used.

`npm test` covers the units. `packages/frontend/src/e2e.live.test.ts` runs against a live server when
`TRACEWAY_E2E_CONNECTION`, `TRACEWAY_E2E_JWT` and `TRACEWAY_E2E_PROJECT` are set (the project needs a rule streaming
custom events for `user.id = e2e-user`).

---

# 1.x reference


A monorepo containing JavaScript/TypeScript SDKs for Traceway error tracking.

## Packages

| Package | Description |
|---------|-------------|
| [`@tracewayapp/core`](./packages/core) | Core types and utilities |
| [`@tracewayapp/backend`](./packages/backend) | Node.js backend SDK with AsyncLocalStorage context |
| [`@tracewayapp/nestjs`](./packages/nestjs) | NestJS integration with module, middleware, and decorators |
| [`@tracewayapp/frontend`](./packages/frontend) | Browser SDK with global error handlers |
| [`@tracewayapp/react`](./packages/react) | React integration with Provider and ErrorBoundary |
| [`@tracewayapp/vue`](./packages/vue) | Vue.js integration with plugin and composable |
| [`@tracewayapp/svelte`](./packages/svelte) | Svelte integration with context setup |
| [`@tracewayapp/jquery`](./packages/jquery) | jQuery integration with automatic AJAX error capture |
| [`@tracewayapp/sourcemap-upload`](./packages/sourcemap-upload) | CLI tool for uploading source maps |

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
} from "@tracewayapp/nestjs";

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
import { TracewayService, Span } from "@tracewayapp/nestjs";

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
import { TracewayProvider, TracewayErrorBoundary, useTraceway } from "@tracewayapp/react";

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
import { createTracewayPlugin } from "@tracewayapp/vue";
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

### Svelte

```svelte
<!-- App.svelte (root component) -->
<script>
  import { setupTraceway } from "@tracewayapp/svelte";

  setupTraceway({
    connectionString: "your-token@https://your-server.com/api/report",
  });
</script>

<slot />
```

```svelte
<!-- Component.svelte -->
<script>
  import { getTraceway } from "@tracewayapp/svelte";

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
import * as traceway from "@tracewayapp/frontend";

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

### @tracewayapp/core

Core types and utilities shared across all packages.

```ts
import { nowISO, type ExceptionStackTrace, type ReportRequest } from "@tracewayapp/core";
```

### @tracewayapp/backend

Node.js backend SDK with AsyncLocalStorage-based context propagation:

```ts
import {
  init,
  shutdown,
  captureException,
  captureMessage,
  captureMetric,
  captureMetricWithTags,
  startSpan,
  endSpan,
  measureTask,
  withTraceContext,
  setTraceAttribute,
  setTraceResponseInfo,
  captureCurrentTrace,
} from "@tracewayapp/backend";

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

### @tracewayapp/nestjs

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

### @tracewayapp/frontend

Browser SDK that provides:
- `init(connectionString, options?)` - Initialize the SDK
- `captureException(error)` - Capture an error
- `captureExceptionWithAttributes(error, attributes)` - Capture with metadata
- `captureMessage(message)` - Capture a message
- `flush()` - Force send buffered events
- `createAxiosInterceptor()` - Returns an Axios request interceptor for distributed tracing
- `getActiveDistributedTraceId()` - Returns the active distributed trace ID (if a fetch is in-flight)
- `DISTRIBUTED_TRACE_HEADER` - The header name used for distributed tracing (`traceway-trace-id`)

Automatically installs global handlers for:
- `window.onerror` - Uncaught exceptions
- `window.onunhandledrejection` - Unhandled promise rejections

Automatically instruments:
- `window.fetch` - Injects `traceway-trace-id` header on same-origin requests for distributed tracing
- `XMLHttpRequest` - Injects `traceway-trace-id` header on same-origin XHR requests (covers `$.ajax()` and other XHR-based libraries)

#### Distributed Tracing (Frontend ↔ Backend)

The frontend SDK can correlate browser errors with the backend requests that caused them by propagating a `traceway-trace-id` header.

##### With fetch (automatic)

When you call `init()`, the SDK monkey-patches `window.fetch` to automatically inject a `traceway-trace-id` header on **same-origin** requests. Cross-origin requests are left untouched.

If an error occurs during the lifecycle of a fetch call (in a `.then()` handler or anywhere synchronously after), the SDK automatically tags the captured exception with the distributed trace ID.

```ts
import * as traceway from "@tracewayapp/frontend";

traceway.init("token@https://traceway.example.com/api/report");

// fetch calls are automatically instrumented — no extra code needed
const res = await fetch("/api/orders", { method: "POST", body: JSON.stringify(order) });
```

##### With Axios (manual interceptor)

For Axios, add the interceptor to your instance:

```ts
import axios from "axios";
import { createAxiosInterceptor } from "@tracewayapp/frontend";

const api = axios.create({ baseURL: "/api" });
api.interceptors.request.use(createAxiosInterceptor());

// All requests through this instance will include the traceway-trace-id header
const res = await api.post("/orders", order);
```

**Note:** The Axios interceptor injects the header but does not set the module-level active trace ID. Automatic exception correlation (for global error handlers) only works with `fetch`. For Axios, pass the distributed trace ID explicitly if needed:

```ts
try {
  await api.post("/orders", order);
} catch (err) {
  traceway.captureException(err, {
    distributedTraceId: err.config?.headers?.["traceway-trace-id"],
  });
}
```

##### Backend Setup

On the backend, the NestJS middleware (and any middleware using `@tracewayapp/backend`) automatically:
1. Reads the `traceway-trace-id` header from incoming requests
2. Echoes it back in the response header
3. Stores it in the trace context — all traces and exceptions captured during that request are tagged with the distributed trace ID

This lets you click on an error in the Traceway dashboard and see the corresponding backend request, or vice versa.

#### Session Replay

The frontend SDK includes built-in session replay powered by [rrweb](https://github.com/rrweb-io/rrweb) (`^2.0.0-alpha.18`).

- **Enabled by default** — controlled by the `sessionRecording` option (defaults to `true`). Only activates when `window` is available.
- **Segment rotation** — DOM events are recorded into segments that rotate every 30 seconds (configurable via `sessionRecordingSegmentDuration` in ms).
- **Always-on sessions** (`recordAllSessions: true`) — see the package README for the lifecycle. The session lives in `sessionStorage` (`src/session-store.ts`) so page loads of the same tab continue it; hidden-page and unload flushes go through `sendReportKeepalive` (`src/transport.ts`), which gzips synchronously with `fflate` and keeps every request within the browser's 64 KiB keepalive budget.
- **Buffering** — The recorder keeps at most 2 segments in memory (the current segment and the previous one).
- **Exception attachment** — When an exception is captured, the recorder's segments are automatically attached to it via a `sessionRecordingId` field, so the replay can be viewed alongside the error in the Traceway dashboard.
- **Flush behavior** — On sync, pending recordings are sent with the exception batch. Calling `flush()` stops the recorder and sends all remaining data.

```ts
traceway.init("token@https://traceway.example.com/api/report", {
  sessionRecording: true,               // default
  sessionRecordingSegmentDuration: 30000, // default: 30s
});
```

### @tracewayapp/react

React-specific integration:
- `TracewayProvider` - Context provider that initializes the SDK
- `TracewayErrorBoundary` - Error boundary that auto-captures render errors
- `useTraceway()` - Hook to access capture methods

### @tracewayapp/vue

Vue.js integration:
- `createTracewayPlugin(options)` - Vue plugin for initialization
- `useTraceway()` - Composable to access capture methods
- Automatic `app.config.errorHandler` for Vue component errors

### @tracewayapp/svelte

Svelte integration:
- `setupTraceway(options)` - Initialize and provide context
- `getTraceway()` - Get capture methods from context

### @tracewayapp/jquery

jQuery integration with automatic AJAX error capture and distributed tracing:
- `init(connectionString, options?)` - Initialize the SDK and install jQuery error handlers
- `captureException(error)` - Capture an error
- `captureExceptionWithAttributes(error, attributes)` - Capture with metadata
- `captureMessage(message)` - Capture a message
- `flush()` - Force send buffered events

Calling `init()` automatically:
1. Initializes `@tracewayapp/frontend` (global handlers, fetch/XHR instrumentation, session recording)
2. Installs a global `$(document).ajaxError()` handler that captures AJAX failures with URL, method, status code, and distributed trace ID

```js
import { init } from "@tracewayapp/jquery";

init("your-token@https://your-server.com/api/report");

// AJAX errors are captured automatically — no extra code needed
$.ajax({ url: "/api/users", method: "GET" });
```

### @tracewayapp/sourcemap-upload

CLI tool for uploading JavaScript source maps to the Traceway backend so that stack traces can be deobfuscated.

**CLI command:** `traceway-sourcemaps`

**Flags:**

| Flag | Description | Required |
|------|-------------|----------|
| `--url <url>` | Traceway backend URL | Yes (or `TRACEWAY_URL` env var) |
| `--token <token>` | Source map upload token | Yes (or `TRACEWAY_SOURCEMAP_TOKEN` env var) |
| `--version <version>` | App version to associate with the maps | Yes |
| `--directory <dir>` | Directory to search for `.map` files (default: `.`) | No |

**How it works:**
- Recursively finds all `.map` files in the target directory using glob (`**/*.map`)
- Validates each file is under the **50 MB** size limit
- Uploads all files in a single multipart `POST` request to `{url}/api/sourcemaps/upload` with a `Bearer` token header
- The `version` field is included in the form data so the backend can associate maps with a release

**Usage example:**

```bash
# Using flags
traceway-sourcemaps \
  --url https://traceway.example.com \
  --token sm_abc123 \
  --version 1.2.0 \
  --directory ./dist

# Using environment variables
TRACEWAY_URL=https://traceway.example.com \
TRACEWAY_SOURCEMAP_TOKEN=sm_abc123 \
traceway-sourcemaps --version 1.2.0 --directory ./dist
```

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

## Flush & Shutdown Timeout

Both the frontend and backend SDKs expose a graceful-shutdown method that drains pending data before returning. Each accepts an optional `timeoutMs` parameter — when provided, the method races the upload against a `setTimeout` and resolves as soon as either completes (via `Promise.race`).

### Frontend — `flush(timeoutMs?)`

1. Clears the debounce timer and retry timer so no further delayed syncs fire.
2. Stops the session recorder (if active).
3. Sends all pending exceptions and session recordings in a single sync call.

**Default timers:**

| Option | Default | Description |
|--------|---------|-------------|
| `debounceMs` | `1500` | Delay before batching and sending exceptions |
| `retryDelayMs` | `10000` | Delay before retrying a failed sync |

```ts
// Wait for flush to complete (no timeout)
await traceway.flush();

// Wait at most 3 seconds, then give up
await traceway.flush(3000);
```

### Backend — `shutdown(timeoutMs?)`

1. Clears the collection interval and metrics interval timers.
2. Rotates the current collection frame into the send queue.
3. Gzips and uploads all remaining frames.

All background timers use `.unref()` so they do not prevent the Node.js process from exiting naturally.

**Default timers:**

| Option | Default | Description |
|--------|---------|-------------|
| `collectionInterval` | `5000` | How often frames are rotated and queued for upload |
| `uploadThrottle` | `2000` | Minimum interval between upload attempts |
| `metricsInterval` | `30000` | How often system metrics are collected |

```ts
// Wait for shutdown to complete (no timeout)
await shutdown();

// Wait at most 5 seconds, then give up
await shutdown(5000);
```

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

## CDN Usage

The `frontend` and `jquery` packages include IIFE builds that work in plain `<script>` tags — no bundler required. These are served automatically by jsdelivr and unpkg after publishing to npm.

### Available CDN Bundles

| Package | Global Variable | CDN URL |
|---------|----------------|---------|
| `@tracewayapp/frontend` | `window.Traceway` | `https://cdn.jsdelivr.net/npm/@tracewayapp/frontend@2/dist/traceway.iife.global.js` |
| `@tracewayapp/jquery` | `window.TracewayJQuery` | `https://cdn.jsdelivr.net/npm/@tracewayapp/jquery@2/dist/traceway-jquery.iife.global.js` |

### Usage

```html
<!-- Framework-agnostic -->
<script src="https://cdn.jsdelivr.net/npm/@tracewayapp/frontend@2/dist/traceway.iife.global.js"></script>
<script>
  Traceway.init("your-token@https://your-server.com/api/report");
</script>
```

```html
<!-- jQuery -->
<script src="https://code.jquery.com/jquery-3.7.1.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/@tracewayapp/jquery@2/dist/traceway-jquery.iife.global.js"></script>
<script>
  TracewayJQuery.init("your-token@https://your-server.com/api/report");
</script>
```

### How It Works

The IIFE builds are produced by tsup alongside the regular ESM/CJS builds. Each package's `package.json` has `unpkg` and `jsdelivr` fields pointing to the IIFE file, so the CDNs auto-serve them at the default URL. No separate CDN deployment step is needed — publishing to npm makes the files available on CDN within minutes.

## Publishing

### publish.sh

The `publish.sh` script handles the full release process for all `@tracewayapp/*` packages:

```bash
./publish.sh
```

**What it does:**

1. Reads the current version from `packages/core/package.json`
2. Prompts for the new version (validates semver format)
3. Checks npm authentication (prompts `npm login` if needed)
4. Shows a summary and asks for confirmation
5. Bumps the version in all workspace `package.json` files
6. Updates cross-package dependency references (e.g. `@tracewayapp/core` version in `@tracewayapp/frontend`)
7. Runs `npm install` to sync `package-lock.json`
8. Builds all packages (`npm run build`) — this produces ESM, CJS, and IIFE bundles
9. Publishes all packages to npm (`npm publish --workspaces`)
10. Creates a git commit (`v<version>`) and tag (`v<version>`)
11. Prints a reminder to `git push && git push --tags`

**After publish completes:**
- All packages are live on npm
- IIFE bundles are available on jsdelivr/unpkg CDN (within minutes)
- The git tag marks the release point

**Requirements:**
- Must be logged in to npm with publish access to the `@tracewayapp` scope
- Working directory should be clean (no uncommitted changes)

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
