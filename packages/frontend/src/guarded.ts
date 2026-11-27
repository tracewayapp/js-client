// The SDK's one guard (CONTRACT §13.2) is `guarded` of @tracewayapp/core. Modules import it from here, so the
// ESM bundle carries a single import of it instead of one per module.
export { guarded, debugLog } from "@tracewayapp/core";
