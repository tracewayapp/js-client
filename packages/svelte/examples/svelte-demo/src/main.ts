import App from "./App.svelte";
import "./app.css";

// Connection string state
let connectionString = "";

function initializeApp() {
  if (!connectionString.trim()) return;

  const target = document.getElementById("app")!;
  target.innerHTML = "";

  new App({
    target,
    props: {
      connectionString,
    },
  });
}

// Initial setup UI
const setupHtml = `
  <div>
    <h1>Traceway Svelte Demo</h1>
    <p class="subtitle">Enter your connection string to initialize</p>
    <div class="config-section">
      <label for="connection-string">Connection String</label>
      <input
        type="text"
        id="connection-string"
        placeholder="your-token@https://your-traceway-server.com/api/report"
      />
      <p class="hint">Format: token@endpoint</p>
      <button class="btn-init" id="init-btn" style="margin-top: 1rem">
        Initialize SDK
      </button>
    </div>
  </div>
`;

document.getElementById("app")!.innerHTML = setupHtml;

const input = document.getElementById("connection-string") as HTMLInputElement;
const button = document.getElementById("init-btn") as HTMLButtonElement;

input.addEventListener("input", (e) => {
  connectionString = (e.target as HTMLInputElement).value;
});

button.addEventListener("click", initializeApp);
