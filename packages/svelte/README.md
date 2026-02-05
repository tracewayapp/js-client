# @tracewayapp/svelte

Svelte integration for Traceway. Provides context setup and a helper function to capture errors.

## Setup

Call `setupTraceway` in your root component (e.g., `App.svelte`) to initialize Traceway and provide context to child components.

```svelte
<script>
  import { setupTraceway } from "@tracewayapp/svelte";

  setupTraceway({
    connectionString: "your-token@https://your-server.com/api/report",
    options: { debug: true }, // optional
  });
</script>

<slot />
```

## getTraceway Helper

Access capture methods from any child component.

```svelte
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

## Global Error Handling

Traceway automatically installs global error handlers (`window.onerror` and `onunhandledrejection`) when initialized. These capture uncaught errors and unhandled promise rejections.

For Svelte-specific error handling, you can use Svelte's `onError` lifecycle function or wrap error-prone code in try/catch blocks using `captureException`.

## Requirements

- Svelte >= 4.0
- `@tracewayapp/frontend` (installed automatically as dependency)
