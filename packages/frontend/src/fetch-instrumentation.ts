import { generateUUID } from "@tracewayapp/core";

let activeDistributedTraceId: string | null = null;

export function getActiveDistributedTraceId(): string | null {
  return activeDistributedTraceId;
}

function isSameOrigin(input: RequestInfo | URL): boolean {
  try {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof Request
          ? input.url
          : input.href,
      window.location.origin,
    );
    return url.origin === window.location.origin;
  } catch {
    return true;
  }
}

export function installFetchInstrumentation(): void {
  const originalFetch = window.fetch;

  window.fetch = function (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (!isSameOrigin(input)) {
      return originalFetch.call(this, input, init);
    }

    const traceId = generateUUID();
    activeDistributedTraceId = traceId;

    const headers = new Headers(init?.headers);
    headers.set("traceway-trace-id", traceId);

    return originalFetch
      .call(this, input, { ...init, headers })
      .finally(() => {
        if (activeDistributedTraceId === traceId) {
          activeDistributedTraceId = null;
        }
      });
  };
}
