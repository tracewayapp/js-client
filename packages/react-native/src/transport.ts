/**
 * Sends the JSON report to the Traceway backend. Unlike the browser SDK we
 * don't gzip the body — `CompressionStream` isn't available in Hermes/JSC and
 * the backend already accepts uncompressed payloads (the `Content-Encoding:
 * gzip` header is the opt-in signal).
 */
export async function sendReport(
  apiUrl: string,
  token: string,
  body: string,
): Promise<boolean> {
  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
  });

  return resp.status === 200;
}
