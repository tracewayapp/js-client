# @tracewayapp/react

React integration for Traceway. Provides a context provider, error boundary, and hook.

## Setup

```tsx
import { TracewayProvider } from "@tracewayapp/react";

function App() {
  return (
    <TracewayProvider connectionString="your-token@https://your-server.com/api/report">
      <MyApp />
    </TracewayProvider>
  );
}
```

## Error Boundary

Catches React render errors and reports them to Traceway.

```tsx
import { TracewayErrorBoundary } from "@tracewayapp/react";

function App() {
  return (
    <TracewayErrorBoundary
      fallback={<div>Something went wrong</div>}
      onError={(error, errorInfo) => {
        console.log("Caught:", error.message);
      }}
    >
      <MyPage />
    </TracewayErrorBoundary>
  );
}
```

## useTraceway Hook

Access capture methods from any component inside the provider.

```tsx
import { useTraceway } from "@tracewayapp/react";

function MyComponent() {
  const { captureException, captureMessage } = useTraceway();

  function handleClick() {
    try {
      doSomething();
    } catch (err) {
      captureException(err as Error);
    }
  }

  return <button onClick={handleClick}>Do Something</button>;
}
```

## API

### TracewayProvider

| Prop | Type | Description |
|------|------|-------------|
| `connectionString` | `string` | Traceway connection string (`token@url`) |
| `options` | `TracewayFrontendOptions` | Optional SDK configuration |
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
