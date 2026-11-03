export interface TracewayEndpoints {
  /** Where the Traceway server is reachable, without a trailing slash. */
  base: string;
  logs: string;
  traces: string;
  opamp: string;
  recordings: string;
}

/**
 * Derives every endpoint the SDK talks to from the URL half of the
 * connection string. Accepts the bare server URL as well as the 1.x form
 * that ended in `/api/report`, so existing connection strings keep working.
 */
export function resolveEndpoints(apiUrl: string): TracewayEndpoints {
  const base = apiUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/api\/report$/, "")
    .replace(/\/api$/, "");
  return {
    base,
    logs: `${base}/api/otel/v1/logs`,
    traces: `${base}/api/otel/v1/traces`,
    opamp: `${base}/api/otel/v1/opamp`,
    recordings: `${base}/api/recordings`,
  };
}
