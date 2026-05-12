export const DISTRIBUTED_TRACE_HEADER = "traceway-trace-id";

let activeDistributedTraceId: string | null = null;

export function getActiveDistributedTraceId(): string | null {
  return activeDistributedTraceId;
}

export function setActiveDistributedTraceId(id: string | null): void {
  activeDistributedTraceId = id;
}

export function clearActiveDistributedTraceId(traceId: string): void {
  if (activeDistributedTraceId === traceId) {
    activeDistributedTraceId = null;
  }
}

/**
 * Returns true when the URL's host matches any of the configured trace hosts
 * (exact string match or RegExp test against the host portion).
 */
export function shouldInjectTraceHeader(
  url: string,
  hosts: Array<string | RegExp>,
): boolean {
  if (hosts.length === 0) return false;
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return false;
  }
  for (const pattern of hosts) {
    if (typeof pattern === "string") {
      if (host === pattern) return true;
    } else if (pattern.test(host)) {
      return true;
    }
  }
  return false;
}
