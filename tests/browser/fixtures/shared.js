import * as sdk from "@tracewayapp/frontend";
export { sdk };
const params = new URLSearchParams(location.search);
export const token = params.get("token") || "browser";
export const baseUrl =
  params.get("baseUrl") || `${location.origin}/case/${params.get("case")}`;
export const options = {
  exportDelayMs: 60000,
  captureWebVitals: false,
  captureResourceTiming: false,
  ...JSON.parse(params.get("options") || "{}"),
};
export function mountActions(api) {
  return async () => {
    api.recordAction("checkout", "clicked", { framework: document.title });
    console.info("checkout breadcrumb");
    await fetch("/application-request");
    document.querySelector("#result").textContent = "Checkout completed";
    sdk.track("checkout.completed");
    api.captureMessage("checkout message");
  };
}
window.sdk = sdk;
