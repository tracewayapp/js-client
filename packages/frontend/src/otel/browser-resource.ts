interface UserAgentData {
  brands?: Array<{ brand: string; version: string }>;
  mobile?: boolean;
  platform?: string;
}

const UA_BROWSERS: Array<[string, RegExp]> = [
  ["Edge", /Edg(?:e|A|iOS)?\/([\d.]+)/],
  ["Opera", /OPR\/([\d.]+)/],
  ["Samsung Internet", /SamsungBrowser\/([\d.]+)/],
  ["Firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
  ["Chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
  ["Safari", /Version\/([\d.]+).*Safari/],
];

const UA_OS: Array<[string, RegExp]> = [
  ["iOS", /iPhone|iPad|iPod/],
  ["Android", /Android/],
  ["Windows", /Windows/],
  ["macOS", /Mac OS X|Macintosh/],
  ["ChromeOS", /CrOS/],
  ["Linux", /Linux/],
];

export function browserFromUserAgent(ua: string): { name?: string; version?: string; os?: string } {
  const out: { name?: string; version?: string; os?: string } = {};
  for (const [name, re] of UA_BROWSERS) {
    const match = ua.match(re);
    if (match) {
      out.name = name;
      out.version = match[1];
      break;
    }
  }
  for (const [os, re] of UA_OS) {
    if (re.test(ua)) {
      out.os = os;
      break;
    }
  }
  return out;
}

/**
 * Resource attributes describing the browser, so the server can target
 * remote config at a browser or OS and the dashboard can show where an error
 * happened. `browser.*` follows the OpenTelemetry browser conventions; the
 * name and version are derived because targeting rules need them.
 */
export function browserResourceAttributes(): Record<string, string | boolean | string[]> {
  if (typeof navigator === "undefined") return {};
  const attrs: Record<string, string | boolean | string[]> = {};
  try {
    const ua = navigator.userAgent || "";
    if (ua) attrs["user_agent.original"] = ua;
    if (navigator.language) attrs["browser.language"] = navigator.language;
    const parsed = browserFromUserAgent(ua);
    if (parsed.name) attrs["browser.name"] = parsed.name;
    if (parsed.version) attrs["browser.version"] = parsed.version;
    if (parsed.os) attrs["os.name"] = parsed.os;

    const data = (navigator as Navigator & { userAgentData?: UserAgentData }).userAgentData;
    if (data) {
      if (typeof data.mobile === "boolean") attrs["browser.mobile"] = data.mobile;
      if (data.platform) attrs["browser.platform"] = data.platform;
      if (data.brands?.length) attrs["browser.brands"] = data.brands.map((b) => `${b.brand} ${b.version}`);
    }
  } catch {
    // Locked-down environments can throw on navigator access.
  }
  return attrs;
}
