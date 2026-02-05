<script lang="ts">
  import { onMount } from "svelte";
  import { setupTraceway } from "@tracewayapp/svelte";
  import * as traceway from "@tracewayapp/frontend";

  export let connectionString: string;

  const { captureException, captureExceptionWithAttributes, captureMessage } =
    setupTraceway({
      connectionString,
      options: { debug: true },
    });

  type LogEntry = {
    time: string;
    message: string;
    type: "info" | "error" | "success";
  };

  let logs: LogEntry[] = [];

  function log(message: string, type: LogEntry["type"] = "info") {
    const time = new Date().toLocaleTimeString();
    logs = [{ time, message, type }, ...logs];
  }

  onMount(() => {
    log("SDK initialized via setupTraceway", "success");
  });

  // 1. Event handler error (try/catch)
  function handleEventError() {
    log("Triggering event handler error...", "info");
    try {
      throw new Error("Event handler error: onClick threw an exception");
    } catch (err) {
      captureException(err as Error);
      log("Captured event handler error via getTraceway()", "success");
    }
  }

  // 2. Async event handler error (unhandled)
  async function handleAsyncEventError() {
    log("Triggering async event handler error...", "info");
    throw new Error(
      "Async event handler error: Unhandled promise rejection in onClick"
    );
  }

  // 3. Fetch HTTP error
  async function handleFetchError() {
    log("Triggering fetch error...", "info");
    try {
      const response = await fetch("https://httpstat.us/500");
      if (!response.ok) {
        throw new Error(`Fetch error: HTTP ${response.status} from API`);
      }
    } catch (err) {
      captureException(err as Error);
      log("Captured fetch error via getTraceway()", "success");
    }
  }

  // 4. Network error
  async function handleNetworkError() {
    log("Triggering network error...", "info");
    try {
      await fetch("https://this-domain-does-not-exist-12345.com/api");
    } catch (err) {
      captureException(err as Error);
      log("Captured network error via getTraceway()", "success");
    }
  }

  // 5. Unhandled promise rejection
  function handleUnhandledRejection() {
    log("Triggering unhandled promise rejection...", "info");
    Promise.reject(
      new Error("Unhandled rejection: Promise.reject() without .catch()")
    );
  }

  // 6. setTimeout error (window.onerror)
  function handleTimeoutError() {
    log("Triggering setTimeout error...", "info");
    setTimeout(() => {
      throw new Error("setTimeout error: Uncaught exception in timer callback");
    }, 0);
  }

  // 7. Manual message capture
  function handleCaptureMessage() {
    const msg = `User action logged at ${new Date().toISOString()}`;
    captureMessage(msg);
    log(`Captured message via getTraceway(): ${msg}`, "success");
  }

  // 8. Capture with attributes
  function handleCaptureWithAttributes() {
    log("Capturing error with attributes...", "info");
    try {
      throw new Error("Error with custom attributes");
    } catch (err) {
      captureExceptionWithAttributes(err as Error, {
        userId: "user-123",
        page: "svelte-demo",
        action: "button-click",
      });
      log("Captured error with attributes via getTraceway()", "success");
    }
  }

  // 9. Flush
  async function handleFlush() {
    log("Flushing...", "info");
    try {
      await traceway.flush();
      log("Flush completed", "success");
    } catch (err) {
      log(`Flush failed: ${err}`, "error");
    }
  }

  function clearLogs() {
    logs = [];
  }
</script>

<div>
  <h1>
    Traceway Svelte Demo
    <span class="status status-ready">Initialized</span>
  </h1>
  <p class="subtitle">Test various Svelte error scenarios with @tracewayapp/svelte</p>

  <!-- Error Scenarios -->
  <div class="error-section">
    <h2>Error Scenarios</h2>
    <p>
      Click buttons to trigger different types of errors. Check the log and your
      Traceway dashboard.
    </p>

    <div class="error-grid">
      <!-- Event Handler Errors -->
      <button class="btn-error" on:click={handleEventError}>
        Event Handler Error (try/catch)
      </button>

      <button class="btn-error" on:click={handleAsyncEventError}>
        Async Event Error (unhandled)
      </button>

      <!-- Network Errors -->
      <button class="btn-warning" on:click={handleFetchError}>
        Fetch HTTP 500 Error
      </button>

      <button class="btn-warning" on:click={handleNetworkError}>
        Network Error (bad domain)
      </button>

      <!-- Global Handler Errors -->
      <button class="btn-error" on:click={handleUnhandledRejection}>
        Unhandled Promise Rejection
      </button>

      <button class="btn-error" on:click={handleTimeoutError}>
        setTimeout Error (window.onerror)
      </button>

      <!-- Manual Capture -->
      <button class="btn-success" on:click={handleCaptureMessage}>
        Capture Message
      </button>

      <button class="btn-success" on:click={handleCaptureWithAttributes}>
        Capture with Attributes
      </button>

      <button class="btn-secondary" on:click={handleFlush}>
        Flush to Server
      </button>
    </div>
  </div>

  <!-- Event Log -->
  <div class="log-section">
    <div class="log-header">
      <h2>Event Log</h2>
      <button class="clear-btn" on:click={clearLogs}>Clear</button>
    </div>
    <div class="log-content">
      {#if logs.length === 0}
        <div class="log-entry">
          <span class="log-info">Demo loaded.</span>
        </div>
      {:else}
        {#each logs as entry, i (i)}
          <div class="log-entry">
            <span class="log-time">{entry.time}</span>
            <span class="log-{entry.type}">{entry.message}</span>
          </div>
        {/each}
      {/if}
    </div>
  </div>
</div>
