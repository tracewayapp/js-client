/** Traceway Cloud: where the maps go when neither `--url` nor `TRACEWAY_URL` names a server. */
export const DEFAULT_URL = "https://cloud.tracewayapp.com";

export interface CliOptions {
  url: string;
  token: string | undefined;
  directory: string;
}

/**
 * The value after `flag`, or undefined when the flag is absent, last, or
 * followed by another flag (`--url --token x`, what CI writes for an unset
 * secret).
 */
export function getArg(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  const value = args[idx + 1];
  return value.startsWith("--") ? undefined : value;
}

function firstNonBlank(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) return trimmed;
  }
  return undefined;
}

/**
 * What the CLI uploads, and where: each value from its flag, then its
 * environment variable; a blank value counts as unset. The server defaults to
 * Traceway Cloud, so only a self-hosted server needs `--url`/`TRACEWAY_URL`.
 */
export function resolveOptions(
  args: string[],
  env: Record<string, string | undefined>,
): CliOptions {
  return {
    url: firstNonBlank(getArg(args, "--url"), env.TRACEWAY_URL) ?? DEFAULT_URL,
    token: firstNonBlank(getArg(args, "--token"), env.TRACEWAY_SOURCEMAP_TOKEN),
    directory: firstNonBlank(getArg(args, "--directory")) ?? ".",
  };
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "10.0.2.2", "[::1]"]);

/**
 * The upload endpoint of the server at `url`, read the way the SDKs read
 * `baseUrl` (CONTRACT §16.1): `https://` added when there is no scheme
 * (`http://` for a local host), query, fragment and trailing slashes dropped,
 * then a trailing `/api/report`, else `/api`. A URL that already ends in the
 * endpoint is kept.
 */
export function uploadEndpoint(url: string): string {
  let base = url.trim();
  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(base)) {
    const authority = base.split(/[/?#]/)[0];
    const host = authority.startsWith("[")
      ? authority.slice(0, authority.indexOf("]") + 1)
      : authority.split(":")[0];
    base = `${LOCAL_HOSTS.has(host.toLowerCase()) ? "http" : "https"}://${base}`;
  }
  base = base.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const pathStart = base.indexOf("/", base.indexOf("://") + 3);
  const path = pathStart === -1 ? "" : base.slice(pathStart);
  if (path.endsWith("/api/sourcemaps/upload")) return base;
  const authority = pathStart === -1 ? base : base.slice(0, pathStart);
  return authority + path.replace(/\/api(?:\/report)?$/, "").replace(/\/+$/, "") + "/api/sourcemaps/upload";
}
