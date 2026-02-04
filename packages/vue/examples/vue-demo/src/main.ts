import { createApp, ref } from "vue";
import { createTracewayPlugin } from "@traceway/vue";
import App from "./App.vue";
import "./style.css";

const connectionString = ref("");
const isInitialized = ref(false);

function initializeApp() {
  if (!connectionString.value.trim()) return;

  const app = createApp(App);

  app.use(
    createTracewayPlugin({
      connectionString: connectionString.value,
      options: { debug: true },
    })
  );

  app.mount("#app");
  isInitialized.value = true;
}

// Initial setup UI
const setupHtml = `
  <div>
    <h1>Traceway Vue Demo</h1>
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
  connectionString.value = (e.target as HTMLInputElement).value;
});

button.addEventListener("click", initializeApp);
