import { createHash } from "node:crypto";

export const DEBUG_ID_COMMENT_PREFIX = "//# debugId=";

const DEBUG_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const MARKER_RE =
  /traceway-dbid-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/;
const COMMENT_RE =
  /\/\/[#@] debugId=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/g;

export function stringToDebugId(input: string): string {
  const hash = createHash("sha256").update(input).digest("hex");
  const variant = ["8", "9", "a", "b"][hash.charCodeAt(16) % 4];
  return [
    hash.slice(0, 8),
    hash.slice(8, 12),
    "4" + hash.slice(13, 16),
    variant + hash.slice(17, 20),
    hash.slice(20, 32),
  ].join("-");
}

export function isValidDebugId(id: string): boolean {
  return DEBUG_ID_RE.test(id);
}

export function getDebugIdSnippet(debugId: string): string {
  return `;!function(){try{var e="undefined"!=typeof window?window:"undefined"!=typeof globalThis?globalThis:"undefined"!=typeof global?global:"undefined"!=typeof self?self:{},n=(new e.Error).stack;n&&(e._tracewayDebugIds=e._tracewayDebugIds||{},e._tracewayDebugIds[n]="${debugId}",e._tracewayDebugIdIdentifier="traceway-dbid-${debugId}")}catch(e){}}();`;
}

export function getInjectionOffset(code: string): number {
  let offset = 0;
  if (code.startsWith("#!")) {
    const newline = code.indexOf("\n");
    offset = newline === -1 ? code.length : newline + 1;
  }
  const head = code.slice(offset);
  const directives = head.match(
    /^(?:\s|\/\*[\s\S]*?\*\/|\/\/[^\r\n]*[\r\n])*(?:"[^"]*";?|'[^']*';?)?/,
  );
  if (directives) {
    offset += directives[0].length;
  }
  return offset;
}

export function extractDebugIdFromSource(code: string): string | undefined {
  const marker = code.match(MARKER_RE);
  if (marker) {
    return marker[1];
  }
  let last: string | undefined;
  for (const match of code.matchAll(COMMENT_RE)) {
    last = match[1].toLowerCase();
  }
  return last;
}

export function hasDebugIdComment(code: string): boolean {
  const tail = code.slice(-4096);
  return /\/\/[#@] debugId=/.test(tail);
}

export function addDebugIdComment(code: string, debugId: string): string {
  const comment = `${DEBUG_ID_COMMENT_PREFIX}${debugId}`;
  const marker = "//# sourceMappingURL=";
  const idx = code.lastIndexOf(marker);
  if (idx !== -1) {
    const lineEnd = code.indexOf("\n", idx);
    const after = lineEnd === -1 ? "" : code.slice(lineEnd);
    if (after.trim() === "") {
      const before = code.slice(0, idx);
      const separator = before.endsWith("\n") ? "" : "\n";
      return before + separator + comment + "\n" + code.slice(idx);
    }
  }
  const separator = code.endsWith("\n") ? "" : "\n";
  return code + separator + comment + "\n";
}

export function addDebugIdToMap(mapJson: string, debugId: string): string {
  const parsed = JSON.parse(mapJson) as Record<string, unknown>;
  if (typeof parsed.debugId === "string" && isValidDebugId(parsed.debugId)) {
    return mapJson;
  }
  parsed.debugId = debugId;
  parsed.debug_id = debugId;
  return JSON.stringify(parsed);
}
