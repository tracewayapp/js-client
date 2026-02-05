import * as traceway from "@tracewayapp/frontend";

// DOM elements
const connectionStringInput = document.getElementById("connection-string") as HTMLInputElement;
const statusEl = document.getElementById("status") as HTMLSpanElement;
const logEl = document.getElementById("log") as HTMLDivElement;
const btnInit = document.getElementById("btn-init") as HTMLButtonElement;
const btnException = document.getElementById("btn-exception") as HTMLButtonElement;
const btnMessage = document.getElementById("btn-message") as HTMLButtonElement;
const btnUnhandled = document.getElementById("btn-unhandled") as HTMLButtonElement;
const btnFlush = document.getElementById("btn-flush") as HTMLButtonElement;
const btnClear = document.getElementById("btn-clear") as HTMLButtonElement;

let isInitialized = false;

// Logging utility
function log(message: string, type: "info" | "error" | "success" = "info") {
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement("div");
  entry.className = "log-entry";
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-${type}">${message}</span>`;
  logEl.insertBefore(entry, logEl.firstChild);
}

// Update UI state
function setInitialized(value: boolean) {
  isInitialized = value;
  btnException.disabled = !value;
  btnMessage.disabled = !value;
  btnUnhandled.disabled = !value;
  btnFlush.disabled = !value;

  if (value) {
    statusEl.textContent = "Initialized";
    statusEl.className = "status status-ready";
  } else {
    statusEl.textContent = "Not initialized";
    statusEl.className = "status status-not-ready";
  }
}

// Initialize SDK
btnInit.addEventListener("click", () => {
  const connectionString = connectionStringInput.value.trim();

  if (!connectionString) {
    log("Please enter a connection string", "error");
    return;
  }

  try {
    traceway.init(connectionString);
    setInitialized(true);
    log(`SDK initialized with connection string: ${connectionString.substring(0, 20)}...`, "success");
  } catch (err) {
    log(`Failed to initialize: ${err}`, "error");
  }
});

// Capture exception
btnException.addEventListener("click", () => {
  const error = new Error("Test exception from browser demo");
  traceway.captureException(error);
  log("Captured exception: Test exception from browser demo", "info");
});

// Capture message
btnMessage.addEventListener("click", () => {
  const message = `Test message at ${new Date().toISOString()}`;
  traceway.captureMessage(message);
  log(`Captured message: ${message}`, "info");
});

// Throw unhandled error (tests global handler)
btnUnhandled.addEventListener("click", () => {
  log("Throwing unhandled error (check console)...", "info");
  setTimeout(() => {
    throw new Error("Unhandled error from browser demo");
  }, 0);
});

// Flush
btnFlush.addEventListener("click", async () => {
  log("Flushing...", "info");
  try {
    await traceway.flush();
    log("Flush completed", "success");
  } catch (err) {
    log(`Flush failed: ${err}`, "error");
  }
});

// Clear log
btnClear.addEventListener("click", () => {
  logEl.innerHTML = "";
});

// Initial log
log("Demo loaded. Enter your connection string and click Initialize.", "info");
