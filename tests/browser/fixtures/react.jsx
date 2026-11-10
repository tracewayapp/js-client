import React from "react";
import { createRoot } from "react-dom/client";
import { TracewayProvider, useTraceway } from "@tracewayapp/react";
import { connectionString, options, mountActions } from "./shared";
function App() {
  const api = useTraceway();
  React.useEffect(() => {
    window.ready = true;
  }, []);
  return (
    <>
      <button id="checkout" onClick={mountActions(api)}>
        Checkout
      </button>
      <button
        id="error"
        onClick={() => api.captureException(new Error("checkout failed"))}
      >
        Report error
      </button>
      <input id="private" />
      <div id="result" />
    </>
  );
}
createRoot(document.querySelector("#app")).render(
  <TracewayProvider connectionString={connectionString} options={options}>
    <App />
  </TracewayProvider>,
);
