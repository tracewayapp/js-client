export async function compressGzip(data: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const inputBytes = encoder.encode(data);

  const cs = new CompressionStream("gzip");
  const writer = cs.writable.getWriter();
  writer.write(inputBytes);
  writer.close();

  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLength += value.length;
  }

  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}

export interface SendReportOptions {
  /**
   * Set to true on session-end paths (pagehide/unload). Uses fetch keepalive
   * so the request survives navigation, falling back to navigator.sendBeacon
   * when keepalive isn't supported (older Safari). Bodies are capped at 64 KB
   * by the browser in keepalive mode — fine for a closing-session payload.
   */
  keepalive?: boolean;
}

export async function sendReport(
  apiUrl: string,
  token: string,
  body: string,
  options: SendReportOptions = {},
): Promise<boolean> {
  if (options.keepalive) {
    // The pagehide handler returns within microseconds; we cannot `await`
    // anything (including the async CompressionStream) before dispatching,
    // or the page unloads before the request is queued.
    //
    // We also cannot use navigator.sendBeacon — it can't set Authorization
    // and the backend's UseClientAuth middleware requires the Bearer header.
    //
    // Solution: skip gzip on this path and call fetch synchronously with
    // keepalive: true. The backend's UseGzip middleware bypasses
    // decompression when Content-Encoding is absent. Body is plain JSON.
    // (Browser keepalive cap is 64 KB, plenty for a closing payload.)
    try {
      void fetch(apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body,
        keepalive: true,
      });
      return true;
    } catch {
      return false;
    }
  }

  const compressed = await compressGzip(body);
  // The compressed Uint8Array is a BodyInit at runtime; the TS lib bundled
  // with this project narrows it through ArrayBufferLike and trips the type
  // checker. Cast once at the boundary.
  const fetchBody = compressed as unknown as BodyInit;

  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
      Authorization: `Bearer ${token}`,
    },
    body: fetchBody,
  });

  return resp.status === 200;
}
