import { readFileSync, statSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { glob } from "glob";

interface UploadOptions {
  url: string;
  token: string;
  directory: string;
}

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB

export async function upload(options: UploadOptions): Promise<void> {
  const dir = resolve(options.directory);

  const maps = await glob("**/*.map", { cwd: dir });

  if (maps.length === 0) {
    console.log("No .map files found in", dir);
    return;
  }

  // Upload each .map together with its sibling minified bundle when present.
  // The bundle lets the backend resolve the enclosing function name; without
  // it, symbolication is location-only.
  const files: string[] = [];
  let bundleCount = 0;
  for (const mapFile of maps) {
    files.push(mapFile);
    const bundleFile = mapFile.replace(/\.map$/, "");
    if (/\.(js|cjs|mjs)$/.test(bundleFile) && existsSync(join(dir, bundleFile))) {
      files.push(bundleFile);
      bundleCount++;
    }
  }

  console.log(
    `Found ${maps.length} source map(s) and ${bundleCount} bundle(s)`,
  );

  for (const file of files) {
    const stat = statSync(join(dir, file));
    if (stat.size > MAX_FILE_SIZE) {
      throw new Error(
        `File ${file} exceeds 50MB limit (${Math.round(stat.size / 1024 / 1024)}MB)`,
      );
    }
  }

  const formData = new FormData();

  for (const file of files) {
    const content = readFileSync(join(dir, file));
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

  const result = (await response.json()) as { uploaded: number };
  console.log(`Successfully uploaded ${result.uploaded} file(s)`);
}
