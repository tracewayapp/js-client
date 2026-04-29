# @tracewayapp/react

React integration for Traceway. Provides a context provider, error boundary, and hook.

## Installation

```bash
npm install @tracewayapp/react
```

## Setup

Wrap your application with `TracewayProvider`:

```tsx
import { TracewayProvider } from "@tracewayapp/react";

function App() {
  return (
    <TracewayProvider connectionString="your-token@https://traceway.example.com/api/report">
      <YourApp />
    </TracewayProvider>
  );
}

export default App;
```

## Error Boundary

Wrap components that might throw errors:

```tsx
import { TracewayProvider, TracewayErrorBoundary } from "@tracewayapp/react";

function App() {
  return (
    <TracewayProvider connectionString="your-token@https://traceway.example.com/api/report">
      <TracewayErrorBoundary fallback={<ErrorPage />}>
        <YourApp />
      </TracewayErrorBoundary>
    </TracewayProvider>
  );
}
```

## useTraceway Hook

Use the `useTraceway` hook to capture errors manually:

```tsx
import { useTraceway } from "@tracewayapp/react";

function MyComponent() {
  const { captureException } = useTraceway();

  async function handleSubmit() {
    try {
      await submitForm();
    } catch (error) {
      captureException(error);
    }
  }

  return <button onClick={handleSubmit}>Submit</button>;
}
```

## Logs, Actions, and Session Recordings

`TracewayProvider` calls `init()` from `@tracewayapp/frontend`, so the underlying timeline instrumentation is set up automatically:

- **Logs** — `console.{debug, log, info, warn, error}` mirrored into a rolling buffer (toggle with `captureLogs`).
- **Actions** — `fetch` / `XHR` and History API navigations recorded as breadcrumbs (toggle with `captureNetwork`, `captureNavigation`).
- **Session recordings** — rrweb-based replay of the seconds leading up to each exception (toggle with `sessionRecording`).

Each captured exception ships with the buffered logs, actions, and replay frames — so the dashboard shows you what the user saw and did right before the error.

To record a custom action breadcrumb, import `recordAction` directly from `@tracewayapp/frontend` (it's not on the hook surface):

```tsx
import { recordAction } from "@tracewayapp/frontend";

recordAction("checkout", "payment_submitted", { amount: 42 });
```

## With Options

```tsx
<TracewayProvider
  connectionString="your-token@https://traceway.example.com/api/report"
  options={{
    debug: true,
    version: "1.0.0",
    captureLogs: true,
    captureNetwork: true,
    captureNavigation: true,
    sessionRecording: true,
    eventsWindowMs: 10_000,
    eventsMaxCount: 200,
  }}
>
  <YourApp />
</TracewayProvider>
```

See [`@tracewayapp/frontend`](../frontend/README.md) for the full options reference.

## API

### TracewayProvider

| Prop | Type | Description |
|------|------|-------------|
| `connectionString` | `string` | Traceway connection string (`token@url`) |
| `options` | `TracewayFrontendOptions` | Optional SDK configuration (logs / actions / recording toggles, sampling, etc.) |
| `children` | `ReactNode` | Child components |

### TracewayErrorBoundary

| Prop | Type | Description |
|------|------|-------------|
| `children` | `ReactNode` | Child components to wrap |
| `fallback` | `ReactNode` | UI to render when an error is caught |
| `onError` | `(error, errorInfo) => void` | Optional callback on error |

### useTraceway()

Returns `{ captureException, captureExceptionWithAttributes, captureMessage }`.

Throws if used outside a `TracewayProvider`.

## Requirements

- React >= 18
- `@tracewayapp/frontend` (installed automatically as dependency)
