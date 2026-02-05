import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { TracewayProvider } from "@tracewayapp/react";
import App from "./App";
import "./index.css";

function Root() {
  const [connectionString, setConnectionString] = useState("");
  const [isInitialized, setIsInitialized] = useState(false);

  if (!isInitialized) {
    return (
      <div>
        <h1>Traceway React Demo</h1>
        <p className="subtitle">Enter your connection string to initialize</p>
        <div className="config-section">
          <label htmlFor="connection-string">Connection String</label>
          <input
            type="text"
            id="connection-string"
            placeholder="your-token@https://your-traceway-server.com/api/report"
            value={connectionString}
            onChange={(e) => setConnectionString(e.target.value)}
          />
          <p className="hint">Format: token@endpoint</p>
          <button
            className="btn-init"
            onClick={() => {
              if (connectionString.trim()) {
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
    <TracewayProvider connectionString={connectionString} options={{ debug: true }}>
      <App />
    </TracewayProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
