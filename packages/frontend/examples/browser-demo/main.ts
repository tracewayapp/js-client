/// <reference types="vite/client" />
import * as traceway from "@tracewayapp/frontend";

// DOM elements
const tokenInput = document.getElementById("token") as HTMLInputElement;
const baseUrlInput = document.getElementById("base-url") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const logEl = document.getElementById("log") as HTMLDivElement;
const btnInit = document.getElementById("btn-init") as HTMLButtonElement;
const btnException = document.getElementById("btn-exception") as HTMLButtonElement;
const btnMessage = document.getElementById("btn-message") as HTMLButtonElement;
const btnUnhandled = document.getElementById("btn-unhandled") as HTMLButtonElement;
const btnFlush = document.getElementById("btn-flush") as HTMLButtonElement;
const btnLog = document.getElementById("btn-log") as HTMLButtonElement;
const btnNavigation = document.getElementById("btn-navigation") as HTMLButtonElement;
const btnSpan = document.getElementById("btn-span") as HTMLButtonElement;
const btnInteraction = document.getElementById("btn-interaction") as HTMLButtonElement;
const btnClear = document.getElementById("btn-clear") as HTMLButtonElement;

const sdkButtons = [
  btnException,
  btnMessage,
  btnUnhandled,
  btnFlush,
  btnLog,
  btnNavigation,
  btnSpan,
  btnInteraction,
];

// The token and, for a self-hosted server, its address, from the environment Vite started with:
// VITE_TRACEWAY_TOKEN=... VITE_TRACEWAY_URL=... npm run dev
tokenInput.value = import.meta.env.VITE_TRACEWAY_TOKEN ?? "";
baseUrlInput.value = import.meta.env.VITE_TRACEWAY_URL ?? "";

// Logging utility for the page's own event log
function show(message: string, type: "info" | "error" | "success" = "info") {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-${type}">${message}</span>`;
  logEl.insertBefore(entry, logEl.firstChild);
}

// Update UI state
function setInitialized(value: boolean) {
  for (const button of sdkButtons) button.disabled = !value;
  btnInit.disabled = value;

  if (value) {
    statusEl.textContent = "Initialized";
    statusEl.className = "status status-ready";
  } else {
    statusEl.textContent = "Not initialized";
    statusEl.className = "status status-not-ready";
  }
}

// Initialize SDK. init() never throws: with options it cannot use it logs one warning and stays off,
// which getClient() shows.
function start() {
  const token = tokenInput.value.trim();
  if (!token) {
    show("Please enter a project token", "error");
    return;
  }
  traceway.init({
    token,
    // Traceway Cloud unless a self-hosted server is given.
    baseUrl: baseUrlInput.value.trim() || undefined,
    // Logs what the SDK sends, drops and why to the console.
    debug: true,
    // Adds small copies of the page's own pictures to the replay.
    collection: { replay: { images: "always" } },
  });
  if (!traceway.getClient()) {
    show("init() did not start the SDK: see the console warning", "error");
    return;
  }
  setInitialized(true);
  show(`SDK initialized with token ${token.substring(0, 6)}...`, "success");
}

btnInit.addEventListener("click", start);

// Capture exception
btnException.addEventListener("click", () => {
  const error = new Error("Test exception from browser demo");
  traceway.captureException(error);
  show("Captured exception: Test exception from browser demo", "info");
});

// Capture message
btnMessage.addEventListener("click", () => {
  const message = `Test message at ${new Date().toISOString()}`;
  traceway.captureMessage(message);
  show(`Captured message: ${message}`, "info");
});

// Throw unhandled error (tests global handler)
btnUnhandled.addEventListener("click", () => {
  show("Throwing unhandled error (check console)...", "info");
  setTimeout(() => {
    throw new Error("Unhandled error from browser demo");
  }, 0);
});

// Flush
btnFlush.addEventListener("click", async () => {
  show("Flushing...", "info");
  await traceway.flush();
  show("Flush completed", "success");
});

// A log line of the app's own: kept on the device like console output and uploaded with the next error
btnLog.addEventListener("click", () => {
  traceway.log("cart synced", "info", { items: 3 });
  show('log("cart synced", "info", { items: 3 }): kept on the device, uploaded with the next error', "info");
});

// A navigation the address does not show (a modal, a wizard step): a new screen and a new page view
let order = 41;
btnNavigation.addEventListener("click", () => {
  order += 1;
  const path = `/orders/${order}`;
  traceway.recordNavigation(path, "push", `/orders/${order - 1}`, "/orders/:id");
  show(`recordNavigation("${path}", "push", ..., "/orders/:id"): later records name the screen /orders/:id`, "info");
});

// A span of the app's own; the request inside it is its child
btnSpan.addEventListener("click", async () => {
  await traceway.tracer()?.startActiveSpan("load cart", async (span) => {
    try {
      await fetch(location.href);
    } finally {
      span.end();
    }
  });
  show('tracer() span "load cart" ended, with the request it made as its child', "info");
});

// One user action from start to end: its requests join the interaction's trace
btnInteraction.addEventListener("click", async () => {
  const checkout = traceway.startInteraction("checkout", { "cart.size": 3 });
  await checkout.run(() => fetch(location.href));
  checkout.setAttribute("payment.method", "card");
  checkout.end(); // end(true) would mark it failed without an exception
  show(`Interaction "checkout" ended, trace ${checkout.traceId}`, "success");
});

// Clear log
btnClear.addEventListener("click", () => {
  logEl.innerHTML = "";
});

setInitialized(false);
if (tokenInput.value) {
  start();
} else {
  show("Demo loaded. Enter your project token and click Initialize, or start Vite with VITE_TRACEWAY_TOKEN.", "info");
}
