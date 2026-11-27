import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_URL, resolveOptions } from "./options";
import { upload } from "./upload";

describe("upload", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "traceway-sourcemaps-"));
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "index-abc.js"), "console.log(1);");
    writeFileSync(join(dir, "assets", "index-abc.js.map"), '{"version":3}');
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    rmSync(dir, { recursive: true, force: true });
  });

  function stubFetch() {
    const fetchMock = vi.fn(
      async (_url: string, _init: RequestInit) =>
        new Response(JSON.stringify({ uploaded: 2 }), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("posts the maps and their bundles to Traceway Cloud when no server is named", async () => {
    const fetchMock = stubFetch();
    const opts = resolveOptions(["--token", "tok", "--directory", dir], {});
    expect(opts.url).toBe(DEFAULT_URL);

    await upload({ url: opts.url, token: opts.token!, directory: opts.directory });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0];
    expect(endpoint).toBe("https://cloud.tracewayapp.com/api/sourcemaps/upload");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    const names = (init.body as FormData).getAll("files").map((f) => (f as File).name).sort();
    expect(names).toEqual(["assets/index-abc.js", "assets/index-abc.js.map"]);
  });

  it("posts to the self-hosted server TRACEWAY_URL names", async () => {
    const fetchMock = stubFetch();
    const opts = resolveOptions(["--directory", dir], {
      TRACEWAY_URL: "https://traceway.example.com/",
      TRACEWAY_SOURCEMAP_TOKEN: "tok",
    });

    await upload({ url: opts.url, token: opts.token!, directory: opts.directory });

    expect(fetchMock.mock.calls[0][0]).toBe("https://traceway.example.com/api/sourcemaps/upload");
  });

  it("throws the status and body of a rejected upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("bad token", { status: 401 })),
    );
    await expect(
      upload({ url: "https://traceway.example.com", token: "tok", directory: dir }),
    ).rejects.toThrow("Upload failed (401): bad token");
  });

  it("uploads nothing when the directory holds no map", async () => {
    const fetchMock = stubFetch();
    const empty = mkdtempSync(join(tmpdir(), "traceway-sourcemaps-empty-"));
    try {
      await upload({ url: DEFAULT_URL, token: "tok", directory: empty });
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
