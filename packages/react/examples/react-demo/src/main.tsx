import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { TracewayProvider } from "@tracewayapp/react";
import App from "./App";
import "./index.css";

// The token and, for a self-hosted server, its address, from the environment Vite started with:
// VITE_TRACEWAY_TOKEN=... VITE_TRACEWAY_URL=... npm run dev
const ENV_TOKEN = import.meta.env.VITE_TRACEWAY_TOKEN ?? "";
const ENV_URL = import.meta.env.VITE_TRACEWAY_URL ?? "";

function Root() {
  const [token, setToken] = useState(ENV_TOKEN);
  const [baseUrl, setBaseUrl] = useState(ENV_URL);
  const [isInitialized, setIsInitialized] = useState(Boolean(ENV_TOKEN));

  if (!isInitialized) {
    return (
      <div>
        <h1>Traceway React Demo</h1>
        <p className="subtitle">Enter your project token to initialize, or start Vite with VITE_TRACEWAY_TOKEN</p>
        <div className="config-section">
          <label htmlFor="token">Project token</label>
          <input
            type="text"
            id="token"
            placeholder="YOUR_TOKEN"
            value={token}
            onChange={(e) => setToken(e.target.value)}
          />
          <label htmlFor="base-url" style={{ marginTop: "1rem" }}>
            Server (only for a self-hosted one)
          </label>
          <input
            type="text"
            id="base-url"
            placeholder="https://cloud.tracewayapp.com"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
          />
          <p className="hint">Leave the server empty for Traceway Cloud.</p>
          <button
            className="btn-init"
            onClick={() => {
              if (token.trim()) {
                setIsInitialized(true);
              }
            }}
            style={{ marginTop: "1rem" }}
          >
            Initialize SDK
          </button>
        </div>
      </div>
    );
  }

  return (
    <TracewayProvider
      token={token.trim()}
      // Traceway Cloud unless a self-hosted server is given.
      baseUrl={baseUrl.trim() || undefined}
      options={{
        // Logs what the SDK sends, drops and why to the console.
        debug: true,
        // Adds small copies of the page's own pictures to the replay.
        collection: { replay: { images: "always" } },
      }}
    >
      <App />
    </TracewayProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
