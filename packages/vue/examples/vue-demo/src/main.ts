import { createApp } from "vue";
import { createTracewayPlugin } from "@tracewayapp/vue";
import App from "./App.vue";
import "./style.css";

// The token and, for a self-hosted server, its address, from the environment Vite started with:
// VITE_TRACEWAY_TOKEN=... VITE_TRACEWAY_URL=... npm run dev
const ENV_TOKEN: string = import.meta.env.VITE_TRACEWAY_TOKEN ?? "";
const ENV_URL: string = import.meta.env.VITE_TRACEWAY_URL ?? "";

function initializeApp(token: string, baseUrl: string) {
  if (!token.trim()) return;

  const app = createApp(App);

  app.use(
    createTracewayPlugin({
      token: token.trim(),
      // Traceway Cloud unless a self-hosted server is given.
      baseUrl: baseUrl.trim() || undefined,
      options: {
        // Logs what the SDK sends, drops and why to the console.
        debug: true,
        // Adds small copies of the page's own pictures to the replay.
        collection: { replay: { images: "always" } },
      },
    })
  );

  app.mount("#app");
}

if (ENV_TOKEN) {
  initializeApp(ENV_TOKEN, ENV_URL);
} else {
  // Initial setup UI
  document.getElementById("app")!.innerHTML = `
    <div>
      <h1>Traceway Vue Demo</h1>
      <p class="subtitle">Enter your project token to initialize, or start Vite with VITE_TRACEWAY_TOKEN</p>
      <div class="config-section">
        <label for="token">Project token</label>
        <input type="text" id="token" placeholder="YOUR_TOKEN" />
        <label for="base-url" style="margin-top: 1rem">Server (only for a self-hosted one)</label>
        <input type="text" id="base-url" placeholder="https://cloud.tracewayapp.com" />
        <p class="hint">Leave the server empty for Traceway Cloud.</p>
        <button class="btn-init" id="init-btn" style="margin-top: 1rem">
          Initialize SDK
        </button>
      </div>
    </div>
  `;

  const tokenInput = document.getElementById("token") as HTMLInputElement;
  const baseUrlInput = document.getElementById("base-url") as HTMLInputElement;
  const button = document.getElementById("init-btn") as HTMLButtonElement;

  button.addEventListener("click", () =>
    initializeApp(tokenInput.value, baseUrlInput.value)
  );
}
