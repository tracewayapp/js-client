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

## With Options

```svelte
<script>
  import { setupTraceway } from "@tracewayapp/svelte";

  setupTraceway({
    connectionString: "your-token@https://traceway.example.com/api/report",
    options: {
      debug: true,
      version: "1.0.0",
    },
  });
</script>

<slot />
```

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
| `options` | `TracewayFrontendOptions` | Optional SDK configuration |

Returns `{ captureException, captureExceptionWithAttributes, captureMessage }`.

### getTraceway()

Returns `{ captureException, captureExceptionWithAttributes, captureMessage }`.

Throws if used outside a component tree where `setupTraceway` has been called.

## Requirements

- Svelte >= 4.0
- `@tracewayapp/frontend` (installed automatically as dependency)
