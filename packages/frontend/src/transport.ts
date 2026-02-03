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

export async function sendReport(
  apiUrl: string,
  token: string,
  body: string,
): Promise<boolean> {
  const compressed = await compressGzip(body);

  const resp = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Encoding": "gzip",
      Authorization: `Bearer ${token}`,
    },
    body: compressed,
  });

  return resp.status === 200;
}
