import { sdk, connectionString, options, mountActions } from "./shared";
sdk.init(connectionString, options);
document.querySelector("#app").innerHTML =
  '<button id="checkout">Checkout</button><button id="error">Report error</button><input id="private"><div id="result"></div>';
document.querySelector("#checkout").onclick = mountActions(sdk);
document.querySelector("#error").onclick = () =>
  sdk.captureException(new Error("checkout failed"));
window.ready = true;
