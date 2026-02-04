import { useState, useEffect, useCallback } from "react";
import { useTraceway, TracewayErrorBoundary } from "@traceway/react";
import * as traceway from "@traceway/frontend";

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

type LogEntry = {
  time: string;
  message: string;
  type: "info" | "error" | "success";
};

export default function App() {
  const { captureException, captureMessage } = useTraceway();
  const [logs, setLogs] = useState<LogEntry[]>([]);

  // Error trigger states
  const [triggerRenderError, setTriggerRenderError] = useState(false);
  const [triggerEffectError, setTriggerEffectError] = useState(false);
  const [renderKey, setRenderKey] = useState(0);
  const [effectKey, setEffectKey] = useState(0);

  const log = useCallback((message: string, type: LogEntry["type"] = "info") => {
    const time = new Date().toLocaleTimeString();
    setLogs((prev) => [{ time, message, type }, ...prev]);
  }, []);

  // Log initialization
  useEffect(() => {
    log("SDK initialized via TracewayProvider", "success");
  }, [log]);

  // 1. Event handler error (onClick)
  const handleEventError = () => {
    log("Triggering event handler error...", "info");
    try {
      throw new Error("Event handler error: onClick threw an exception");
    } catch (err) {
      captureException(err as Error);
      log("Captured event handler error via useTraceway()", "success");
    }
  };

  // 2. Async event handler error (unhandled in async)
  const handleAsyncEventError = async () => {
    log("Triggering async event handler error...", "info");
    // This will be caught by window.onunhandledrejection
    throw new Error("Async event handler error: Unhandled promise rejection in onClick");
  };

  // 3. Component render error (caught by TracewayErrorBoundary)
  const handleRenderError = () => {
    log("Triggering component render error...", "info");
    setTriggerRenderError(true);
  };

  // 4. useEffect error (caught by TracewayErrorBoundary)
  const handleEffectError = () => {
    log("Triggering useEffect error...", "info");
    setTriggerEffectError(true);
  };

  // 5. Fetch error
  const handleFetchError = async () => {
    log("Triggering fetch error...", "info");
    try {
      const response = await fetch("https://httpstat.us/500");
      if (!response.ok) {
        throw new Error(`Fetch error: HTTP ${response.status} from API`);
      }
    } catch (err) {
      captureException(err as Error);
      log("Captured fetch error via useTraceway()", "success");
    }
  };

  // 6. Fetch network error
  const handleNetworkError = async () => {
    log("Triggering network error...", "info");
    try {
      await fetch("https://this-domain-does-not-exist-12345.com/api");
    } catch (err) {
      captureException(err as Error);
      log("Captured network error via useTraceway()", "success");
    }
  };

  // 7. Promise rejection (setTimeout)
  const handleUnhandledRejection = () => {
    log("Triggering unhandled promise rejection...", "info");
    // This will be caught by window.onunhandledrejection (global handler)
    Promise.reject(new Error("Unhandled rejection: Promise.reject() without .catch()"));
  };

  // 8. Thrown error in setTimeout (window.onerror)
  const handleTimeoutError = () => {
    log("Triggering setTimeout error...", "info");
    setTimeout(() => {
      throw new Error("setTimeout error: Uncaught exception in timer callback");
    }, 0);
  };

  // 9. Manual message capture
  const handleCaptureMessage = () => {
    const msg = `User action logged at ${new Date().toISOString()}`;
    captureMessage(msg);
    log(`Captured message via useTraceway(): ${msg}`, "success");
  };

  // 10. Flush
  const handleFlush = async () => {
    log("Flushing...", "info");
    try {
      await traceway.flush();
      log("Flush completed", "success");
    } catch (err) {
      log(`Flush failed: ${err}`, "error");
    }
  };

  // Error boundary callback
  const handleBoundaryError = (error: Error) => {
    log(`TracewayErrorBoundary caught: ${error.message}`, "error");
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
      <h3>Component Error Caught by TracewayErrorBoundary</h3>
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
        <span className="status status-ready">Initialized</span>
      </h1>
      <p className="subtitle">Test various React error scenarios with @traceway/react</p>

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

      {/* Error Boundary Demo Components */}
      <div className="error-section">
        <h2>TracewayErrorBoundary Components</h2>
        <p>These components are wrapped in TracewayErrorBoundary to auto-capture render/effect errors.</p>

        <TracewayErrorBoundary
          key={`render-${renderKey}`}
          fallback={<ErrorFallback message="Render error caught" onReset={resetRenderError} />}
          onError={handleBoundaryError}
        >
          <BrokenRenderComponent shouldThrow={triggerRenderError} />
        </TracewayErrorBoundary>

        <TracewayErrorBoundary
          key={`effect-${effectKey}`}
          fallback={<ErrorFallback message="Effect error caught" onReset={resetEffectError} />}
          onError={handleBoundaryError}
        >
          <BrokenEffectComponent shouldThrow={triggerEffectError} />
        </TracewayErrorBoundary>
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
