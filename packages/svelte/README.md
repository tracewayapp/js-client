# @tracewayapp/svelte

Svelte integration for Traceway. Provides context-based setup and a helper to capture errors.

## Installation

```bash
npm install @tracewayapp/svelte
```

## Setup

Call `setupTraceway` in your root component:

```svelte
<script>
  import { setupTraceway } from "@tracewayapp/svelte";

  setupTraceway({
    connectionString: "your-token@https://traceway.example.com/api/report",
  });
</script>

<slot />
```

## Capture Errors in Components

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

## Logs, Actions, and Session Recordings

`setupTraceway` calls `init()` from `@tracewayapp/frontend` on mount, so the underlying timeline instrumentation is set up automatically:

- **Logs** — `console.{debug, log, info, warn, error}` mirrored into a rolling buffer (toggle with `captureLogs`).
- **Actions** — `fetch` / `XHR` and History API navigations recorded as breadcrumbs (toggle with `captureNetwork`, `captureNavigation`). SvelteKit's client-side routing flows through the History API and is captured automatically.
- **Session recordings** — rrweb-based replay of the seconds leading up to each exception (toggle with `sessionRecording`).

Each captured exception ships with the buffered logs, actions, and replay frames.

To record a custom action breadcrumb, import `recordAction` directly from `@tracewayapp/frontend` (it's not on the context surface):

```ts
import { recordAction } from "@tracewayapp/frontend";

recordAction("checkout", "payment_submitted", { amount: 42 });
```

## With Options

```svelte
<script>
  import { setupTraceway } from "@tracewayapp/svelte";

  setupTraceway({
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
  });
</script>

<slot />
```

See [`@tracewayapp/frontend`](../frontend/README.md) for the full options reference.

## SvelteKit Setup

For SvelteKit, set up Traceway in your root layout:

```svelte
<!-- src/routes/+layout.svelte -->
<script>
  import { setupTraceway } from "@tracewayapp/svelte";
  import { browser } from "$app/environment";

  // Only initialize on client
  if (browser) {
    setupTraceway({
      connectionString: "your-token@https://traceway.example.com/api/report",
    });
  }
</script>

<slot />
```

## API

### setupTraceway(options)

Initializes Traceway and provides context to the component tree. Must be called during component initialization.

| Option | Type | Description |
|--------|------|-------------|
| `connectionString` | `string` | Traceway connection string (`token@url`) |
| `options` | `TracewayFrontendOptions` | Optional SDK configuration (logs / actions / recording toggles, sampling, etc.) |

Returns `{ captureException, captureExceptionWithAttributes, captureMessage }`.

### getTraceway()

Returns `{ captureException, captureExceptionWithAttributes, captureMessage }`.

Throws if used outside a component tree where `setupTraceway` has been called.

## Requirements

- Svelte >= 4.0
- `@tracewayapp/frontend` (installed automatically as dependency)
