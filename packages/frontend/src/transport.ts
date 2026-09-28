import { gzipSync, strToU8 } from "fflate";

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

/**
 * Browsers reject a keepalive request once the bodies of all in-flight
 * keepalive requests of the page would exceed 64 KiB, and the rejection is
 * silent to code that has already returned from its unload handler.
 */
export const KEEPALIVE_BUDGET_BYTES = 64 * 1024;

/**
 * Sends a report that must survive the page going away (pagehide, a hidden
 * tab the OS may freeze or kill). An unload handler cannot await, so the body
 * is gzipped synchronously; rrweb JSON shrinks roughly tenfold, which is what
 * lets a full DOM snapshot fit the keepalive budget at all.
 *
 * `bytes` is the compressed body size dispatched (0 when it does not fit in
 * `budgetBytes` and nothing was sent); `delivered` settles with whether the
 * backend accepted it, for callers whose page is still alive to retry.
 */
export function sendReportKeepalive(
  apiUrl: string,
  token: string,
  body: string,
  budgetBytes: number = KEEPALIVE_BUDGET_BYTES,
): { bytes: number; delivered: Promise<boolean> } {
  const compressed = gzipSync(strToU8(body));
  if (compressed.length > budgetBytes) {
    return { bytes: 0, delivered: Promise.resolve(false) };
  }
  try {
    const delivered = fetch(apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        Authorization: `Bearer ${token}`,
      },
      body: compressed as unknown as BodyInit,
      keepalive: true,
    }).then(
      (resp) => resp.status === 200,
      () => false,
    );
    return { bytes: compressed.length, delivered };
  } catch {
    return { bytes: 0, delivered: Promise.resolve(false) };
  }
}

export async function sendReport(
  apiUrl: string,
  token: string,
  body: string,
): Promise<boolean> {
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
