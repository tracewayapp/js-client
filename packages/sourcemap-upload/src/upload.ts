import { readFileSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { glob } from "glob";

interface UploadOptions {
  url: string;
  token: string;
  version: string;
  directory: string;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function upload(options: UploadOptions): Promise<void> {
  const dir = resolve(options.directory);

  const files = await glob("**/*.map", { cwd: dir });

  if (files.length === 0) {
    console.log("No .map files found in", dir);
    return;
  }

  console.log(`Found ${files.length} source map file(s)`);

  for (const file of files) {
    const filePath = join(dir, file);
    const stat = statSync(filePath);
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File ${file} exceeds 50MB limit (${Math.round(stat.size / 1024 / 1024)}MB)`,
      );
    }
  }

  const formData = new FormData();
  formData.append("version", options.version);

  for (const file of files) {
    const filePath = join(dir, file);
    const content = readFileSync(filePath);
    const blob = new Blob([content]);
    formData.append("files", blob, file);
  }

  const endpoint = `${options.url.replace(/\/$/, "")}/api/sourcemaps/upload`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.token}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Upload failed (${response.status}): ${body}`);
  }

  const result: { uploaded: number } = await response.json();
  console.log(`Successfully uploaded ${result.uploaded} source map(s)`);
}
