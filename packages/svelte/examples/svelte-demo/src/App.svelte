<script lang="ts">
  import { onMount } from "svelte";
  import {
    setupTraceway,
    flush,
    getClient,
    log as tracewayLog,
    recordNavigation,
    startInteraction,
    tracer,
  } from "@tracewayapp/svelte";

  let { token, baseUrl }: { token: string; baseUrl?: string } = $props();

  // Read once: the SDK starts once per page.
  const { captureException, captureExceptionWithAttributes, captureMessage } =
    setupTraceway({
      token,
      baseUrl,
      options: {
        // Logs what the SDK sends, drops and why to the console.
        debug: true,
        // Adds small copies of the page's own pictures to the replay.
        collection: { replay: { images: "always" } },
      },
    });

  // init() never throws: with options it cannot use it logs one warning and stays off.
  const started = getClient() !== null;

  type LogEntry = {
    time: string;
    message: string;
    type: "info" | "error" | "success";
  };

  let logs = $state<LogEntry[]>([]);

  function log(message: string, type: LogEntry["type"] = "info") {
    const time = new Date().toLocaleTimeString();
    logs = [{ time, message, type }, ...logs];
  }

  onMount(() => {
    if (started) log("SDK initialized via setupTraceway", "success");
    else log("setupTraceway did not start the SDK: see the console warning", "error");
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
    await flush();
    log("Flush completed", "success");
  }

  // 10. A log line of the app's own: kept on the device like console output and uploaded with the next error
  function handleLog() {
    tracewayLog("cart synced", "info", { items: 3 });
    log('log("cart synced", "info", { items: 3 }): kept on the device, uploaded with the next error', "info");
  }

  // 11. A navigation the address does not show (a modal, a wizard step): a new screen and a new page view
  let order = 41;
  function handleNavigation() {
    order += 1;
    recordNavigation(`/orders/${order}`, "push", `/orders/${order - 1}`, "/orders/:id");
    log(`recordNavigation("/orders/${order}", "push", ..., "/orders/:id"): later records name the screen /orders/:id`, "info");
  }

  // 12. A span of the app's own; the request inside it is its child
  async function handleSpan() {
    await tracer()?.startActiveSpan("load cart", async (span) => {
      try {
        await fetch(location.href);
      } finally {
        span.end();
      }
    });
    log('tracer() span "load cart" ended, with the request it made as its child', "info");
  }

  // 13. One user action from start to end: its requests join the interaction's trace
  async function handleInteraction() {
    const checkout = startInteraction("checkout", { "cart.size": 3 });
    await checkout.run(() => fetch(location.href));
    checkout.setAttribute("payment.method", "card");
    checkout.end(); // end(true) would mark it failed without an exception
    log(`Interaction "checkout" ended, trace ${checkout.traceId}`, "success");
  }

  function clearLogs() {
    logs = [];
  }
</script>

<div>
  <h1>
    Traceway Svelte Demo
    <span class={started ? "status status-ready" : "status status-not-ready"}>
      {started ? "Initialized" : "Not started"}
    </span>
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
      <button class="btn-error" onclick={handleEventError}>
        Event Handler Error (try/catch)
      </button>

      <button class="btn-error" onclick={handleAsyncEventError}>
        Async Event Error (unhandled)
      </button>

      <!-- Network Errors -->
      <button class="btn-warning" onclick={handleFetchError}>
        Fetch HTTP 500 Error
      </button>

      <button class="btn-warning" onclick={handleNetworkError}>
        Network Error (bad domain)
      </button>

      <!-- Global Handler Errors -->
      <button class="btn-error" onclick={handleUnhandledRejection}>
        Unhandled Promise Rejection
      </button>

      <button class="btn-error" onclick={handleTimeoutError}>
        setTimeout Error (window.onerror)
      </button>

      <!-- Manual Capture -->
      <button class="btn-success" onclick={handleCaptureMessage}>
        Capture Message
      </button>

      <button class="btn-success" onclick={handleCaptureWithAttributes}>
        Capture with Attributes
      </button>

      <button class="btn-secondary" onclick={handleFlush}>
        Flush to Server
      </button>
    </div>
  </div>

  <!-- 2.1 features -->
  <div class="error-section">
    <h2>Breadcrumbs, screens and traces</h2>
    <p>
      These are kept on the device and uploaded with the next error: capture one
      afterwards to see them.
    </p>

    <div class="error-grid">
      <button class="btn-feature" onclick={handleLog}>log()</button>
      <button class="btn-feature" onclick={handleNavigation}>recordNavigation()</button>
      <button class="btn-feature" onclick={handleSpan}>tracer() span</button>
      <button class="btn-feature" onclick={handleInteraction}>startInteraction()</button>
    </div>

    <div class="mask-demo">
      <p class="traceway-mask">Card ending 4242, Alice Smith</p>
      <p class="hint">
        The line above has <code>class="traceway-mask"</code>: the replay shows it as
        <code>****</code>.
      </p>
    </div>
  </div>

  <!-- Event Log -->
  <div class="log-section">
    <div class="log-header">
      <h2>Event Log</h2>
      <button class="clear-btn" onclick={clearLogs}>Clear</button>
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
