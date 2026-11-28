import { Component, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  useTraceway,
  captureException,
  flush,
  getClient,
  log as tracewayLog,
  recordNavigation,
  startInteraction,
  tracer,
} from "@tracewayapp/react";

// Component that throws during render
function BrokenRenderComponent({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error("Component render error: Failed to render BrokenRenderComponent");
  }
  return <div>This component renders normally</div>;
}

// Component that throws in useEffect
function BrokenEffectComponent({ shouldThrow }: { shouldThrow: boolean }) {
  useEffect(() => {
    if (shouldThrow) {
      throw new Error("useEffect error: Side effect failed in BrokenEffectComponent");
    }
  }, [shouldThrow]);

  return <div>Effect component mounted</div>;
}

/**
 * An error boundary of the app's own, for a fallback UI around one part of the page. Errors that reach
 * TracewayProvider are reported by it; one that a boundary like this catches first is reported here.
 */
class Boundary extends Component<
  { fallback: ReactNode; onError: (error: Error) => void; children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    captureException(error);
    this.props.onError(error);
  }

  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}

type LogEntry = {
  time: string;
  message: string;
  type: "info" | "error" | "success";
};

export default function App() {
  const traceway = useTraceway();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [order, setOrder] = useState(41);

  // Error trigger states
  const [triggerRenderError, setTriggerRenderError] = useState(false);
  const [triggerEffectError, setTriggerEffectError] = useState(false);
  const [renderKey, setRenderKey] = useState(0);
  const [effectKey, setEffectKey] = useState(0);

  const show = useCallback((message: string, type: LogEntry["type"] = "info") => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [{ time, message, type }, ...prev]);
  }, []);

  // Log initialization. init() never throws: with options it cannot use it logs one warning and stays off.
  useEffect(() => {
    if (getClient()) show("SDK initialized via TracewayProvider", "success");
    else show("TracewayProvider did not start the SDK: see the console warning", "error");
  }, [show]);

  // 1. Event handler error (onClick)
  const handleEventError = () => {
    show("Triggering event handler error...", "info");
    try {
      throw new Error("Event handler error: onClick threw an exception");
    } catch (err) {
      traceway.captureException(err as Error);
      show("Captured event handler error via useTraceway()", "success");
    }
  };

  // 2. Async event handler error (unhandled in async)
  const handleAsyncEventError = async () => {
    show("Triggering async event handler error...", "info");
    // This will be caught by window.onunhandledrejection
    throw new Error("Async event handler error: Unhandled promise rejection in onClick");
  };

  // 3. Component render error (caught by the Boundary below)
  const handleRenderError = () => {
    show("Triggering component render error...", "info");
    setTriggerRenderError(true);
  };

  // 4. useEffect error (caught by the Boundary below)
  const handleEffectError = () => {
    show("Triggering useEffect error...", "info");
    setTriggerEffectError(true);
  };

  // 5. Fetch error
  const handleFetchError = async () => {
    show("Triggering fetch error...", "info");
    try {
      const response = await fetch("https://httpstat.us/500");
      if (!response.ok) {
        throw new Error(`Fetch error: HTTP ${response.status} from API`);
      }
    } catch (err) {
      traceway.captureException(err as Error);
      show("Captured fetch error via useTraceway()", "success");
    }
  };

  // 6. Fetch network error
  const handleNetworkError = async () => {
    show("Triggering network error...", "info");
    try {
      await fetch("https://this-domain-does-not-exist-12345.com/api");
    } catch (err) {
      traceway.captureException(err as Error);
      show(
        "Passed the network error to captureException(); the default ignoreErrors drop it (\"Failed to fetch\")",
        "info",
      );
    }
  };

  // 7. Promise rejection
  const handleUnhandledRejection = () => {
    show("Triggering unhandled promise rejection...", "info");
    // This will be caught by window.onunhandledrejection (global handler)
    Promise.reject(new Error("Unhandled rejection: Promise.reject() without .catch()"));
  };

  // 8. Thrown error in setTimeout (window.onerror)
  const handleTimeoutError = () => {
    show("Triggering setTimeout error...", "info");
    setTimeout(() => {
      throw new Error("setTimeout error: Uncaught exception in timer callback");
    }, 0);
  };

  // 9. Manual message capture
  const handleCaptureMessage = () => {
    const msg = `User action logged at ${new Date().toISOString()}`;
    traceway.captureMessage(msg);
    show(`Captured message via useTraceway(): ${msg}`, "success");
  };

  // 10. Flush
  const handleFlush = async () => {
    show("Flushing...", "info");
    await flush();
    show("Flush completed", "success");
  };

  // 11. A log line of the app's own: kept on the device like console output and uploaded with the next error
  const handleLog = () => {
    tracewayLog("cart synced", "info", { items: 3 });
    show('log("cart synced", "info", { items: 3 }): kept on the device, uploaded with the next error', "info");
  };

  // 12. A navigation the address does not show (a modal, a wizard step): a new screen and a new page view
  const handleNavigation = () => {
    const next = order + 1;
    recordNavigation(`/orders/${next}`, "push", `/orders/${order}`, "/orders/:id");
    setOrder(next);
    show(`recordNavigation("/orders/${next}", "push", ..., "/orders/:id"): later records name the screen /orders/:id`, "info");
  };

  // 13. A span of the app's own; the request inside it is its child
  const handleSpan = async () => {
    await tracer()?.startActiveSpan("load cart", async (span) => {
      try {
        await fetch(location.href);
      } finally {
        span.end();
      }
    });
    show('tracer() span "load cart" ended, with the request it made as its child', "info");
  };

  // 14. One user action from start to end: its requests join the interaction's trace
  const handleInteraction = async () => {
    const checkout = startInteraction("checkout", { "cart.size": 3 });
    await checkout.run(() => fetch(location.href));
    checkout.setAttribute("payment.method", "card");
    checkout.end(); // end(true) would mark it failed without an exception
    show(`Interaction "checkout" ended, trace ${checkout.traceId}`, "success");
  };

  // Error boundary callback
  const handleBoundaryError = (error: Error) => {
    show(`Boundary caught and reported: ${error.message}`, "error");
  };

  const resetRenderError = () => {
    setTriggerRenderError(false);
    setRenderKey((k) => k + 1);
  };

  const resetEffectError = () => {
    setTriggerEffectError(false);
    setEffectKey((k) => k + 1);
  };

  const ErrorFallback = ({ message, onReset }: { message: string; onReset: () => void }) => (
    <div className="error-boundary-fallback">
      <h3>Component Error Caught by a Boundary</h3>
      <p>{message}</p>
      <button className="btn-warning" onClick={onReset}>
        Reset Component
      </button>
    </div>
  );

  return (
    <div>
      <h1>
        Traceway React Demo
        <span className={getClient() ? "status status-ready" : "status status-not-ready"}>
          {getClient() ? "Initialized" : "Not started"}
        </span>
      </h1>
      <p className="subtitle">Test various React error scenarios with @tracewayapp/react</p>

      {/* Error Scenarios */}
      <div className="error-section">
        <h2>Error Scenarios</h2>
        <p>Click buttons to trigger different types of errors. Check the log and your Traceway dashboard.</p>

        <div className="error-grid">
          {/* Event Handler Errors */}
          <button className="btn-error" onClick={handleEventError}>
            Event Handler Error (try/catch)
          </button>

          <button className="btn-error" onClick={handleAsyncEventError}>
            Async Event Error (unhandled)
          </button>

          {/* Component Errors */}
          <button className="btn-error" onClick={handleRenderError}>
            Component Render Error
          </button>

          <button className="btn-error" onClick={handleEffectError}>
            useEffect Error
          </button>

          {/* Network Errors */}
          <button className="btn-warning" onClick={handleFetchError}>
            Fetch HTTP 500 Error
          </button>

          <button className="btn-warning" onClick={handleNetworkError}>
            Network Error (bad domain)
          </button>

          {/* Global Handler Errors */}
          <button className="btn-error" onClick={handleUnhandledRejection}>
            Unhandled Promise Rejection
          </button>

          <button className="btn-error" onClick={handleTimeoutError}>
            setTimeout Error (window.onerror)
          </button>

          {/* Manual Capture */}
          <button className="btn-success" onClick={handleCaptureMessage}>
            Capture Message
          </button>

          <button className="btn-secondary" onClick={handleFlush}>
            Flush to Server
          </button>
        </div>
      </div>

      {/* 2.1 features */}
      <div className="error-section">
        <h2>Breadcrumbs, screens and traces</h2>
        <p>These are kept on the device and uploaded with the next error: capture one afterwards to see them.</p>

        <div className="error-grid">
          <button className="btn-feature" onClick={handleLog}>
            log()
          </button>

          <button className="btn-feature" onClick={handleNavigation}>
            recordNavigation()
          </button>

          <button className="btn-feature" onClick={handleSpan}>
            tracer() span
          </button>

          <button className="btn-feature" onClick={handleInteraction}>
            startInteraction()
          </button>
        </div>

        <div className="mask-demo">
          <p className="traceway-mask">Card ending 4242, Alice Smith</p>
          <p className="hint">
            The line above has <code>className="traceway-mask"</code>: the replay shows it as <code>****</code>.
          </p>
        </div>
      </div>

      {/* Error Boundary Demo Components */}
      <div className="error-section">
        <h2>Render and effect errors</h2>
        <p>
          These components are wrapped in an error boundary of the app's own, which shows a fallback and reports the
          error with captureException.
        </p>

        <Boundary
          key={`render-${renderKey}`}
          fallback={<ErrorFallback message="Render error caught" onReset={resetRenderError} />}
          onError={handleBoundaryError}
        >
          <BrokenRenderComponent shouldThrow={triggerRenderError} />
        </Boundary>

        <Boundary
          key={`effect-${effectKey}`}
          fallback={<ErrorFallback message="Effect error caught" onReset={resetEffectError} />}
          onError={handleBoundaryError}
        >
          <BrokenEffectComponent shouldThrow={triggerEffectError} />
        </Boundary>
      </div>

      {/* Event Log */}
      <div className="log-section">
        <div className="log-header">
          <h2>Event Log</h2>
          <button className="clear-btn" onClick={() => setLogs([])}>
            Clear
          </button>
        </div>
        <div className="log-content">
          {logs.length === 0 ? (
            <div className="log-entry">
              <span className="log-info">Demo loaded.</span>
            </div>
          ) : (
            logs.map((entry, i) => (
              <div key={i} className="log-entry">
                <span className="log-time">{entry.time}</span>
                <span className={`log-${entry.type}`}>{entry.message}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
