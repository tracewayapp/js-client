import { gzipSync, strToU8 } from "fflate";

/**
 * Sends the JSON report to the Traceway backend, gzip-compressed. The
 * `/api/report` ingestion endpoint requires `Content-Encoding: gzip` and
 * rejects uncompressed bodies with HTTP 400. Hermes / JSC / RN don't ship
 * `CompressionStream`, so we use `fflate` — a tiny zero-dependency pure-JS
 * gzip implementation that works everywhere RN runs (including Expo Go).
 */
export async function sendReport(
  apiUrl: string,
  token: string,
  body: string,
): Promise<boolean> {
  const compressed = gzipSync(strToU8(body));
  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
      Authorization: `Bearer ${token}`,
    },
    // RN's fetch polyfill accepts Uint8Array at runtime; the TS lib types
    // (which target browser DOM) are stricter about BodyInit, so we route
    // around them with an unknown-cast.
    body: compressed as unknown as BodyInit,
  });

  return resp.status === 200;
}
