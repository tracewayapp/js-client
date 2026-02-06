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

## With Options

```tsx
<TracewayProvider
  connectionString="your-token@https://traceway.example.com/api/report"
  options={{
    debug: true,
    version: "1.0.0",
  }}
>
  <YourApp />
</TracewayProvider>
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
