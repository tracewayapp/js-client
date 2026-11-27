/// <reference types="vite/client" />
import { mount } from "svelte";
import App from "./App.svelte";
import "./app.css";

// The token and, for a self-hosted server, its address, from the environment Vite started with:
// VITE_TRACEWAY_TOKEN=... VITE_TRACEWAY_URL=... npm run dev
const ENV_TOKEN: string = import.meta.env.VITE_TRACEWAY_TOKEN ?? "";
const ENV_URL: string = import.meta.env.VITE_TRACEWAY_URL ?? "";

function initializeApp(token: string, baseUrl: string) {
  if (!token.trim()) return;

  const target = document.getElementById("app")!;
  target.innerHTML = "";

  mount(App, {
    target,
    props: {
      token: token.trim(),
      // Traceway Cloud unless a self-hosted server is given.
      baseUrl: baseUrl.trim() || undefined,
    },
  });
}

if (ENV_TOKEN) {
  initializeApp(ENV_TOKEN, ENV_URL);
} else {
  // Initial setup UI
  document.getElementById("app")!.innerHTML = `
    <div>
      <h1>Traceway Svelte Demo</h1>
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
