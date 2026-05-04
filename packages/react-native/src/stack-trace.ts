/**
 * Formats an `Error` into Traceway's wire stack-trace string.
 *
 * Hermes (the default RN engine) emits a V8-shaped stack — `at funcName
 * (file:line:col)` — so the V8 patterns from the browser SDK match cleanly.
 * JavaScriptCore on iOS uses Firefox/SpiderMonkey-style `funcName@file:line:col`
 * lines, which the second batch of patterns covers.
 */
export function formatStackTrace(error: Error): string {
  const lines: string[] = [];
  const typeName = error.constructor?.name || "Error";
  lines.push(`${typeName}: ${error.message}`);

  if (error.stack) {
    const stackLines = error.stack.split("\n");
    for (const line of stackLines) {
      const v8Match = line.match(/^\s+at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
      if (v8Match) {
        const funcName = shortenFunctionName(v8Match[1]);
        const file = shortenFilePath(v8Match[2]);
        lines.push(`${funcName}()`);
        lines.push(`    ${file}:${v8Match[3]}:${v8Match[4]}`);
        continue;
      }

      const v8AnonMatch = line.match(/^\s+at\s+(.+):(\d+):(\d+)$/);
      if (v8AnonMatch) {
        const file = shortenFilePath(v8AnonMatch[1]);
        lines.push(`<anonymous>()`);
        lines.push(`    ${file}:${v8AnonMatch[2]}:${v8AnonMatch[3]}`);
        continue;
      }

      const ffMatch = line.match(/^(.+)@(.+):(\d+):(\d+)$/);
      if (ffMatch) {
        const funcName = shortenFunctionName(ffMatch[1]) || "<anonymous>";
        const file = shortenFilePath(ffMatch[2]);
        lines.push(`${funcName}()`);
        lines.push(`    ${file}:${ffMatch[3]}:${ffMatch[4]}`);
        continue;
      }

      const ffAnonMatch = line.match(/^@(.+):(\d+):(\d+)$/);
      if (ffAnonMatch) {
        const file = shortenFilePath(ffAnonMatch[1]);
        lines.push(`<anonymous>()`);
        lines.push(`    ${file}:${ffAnonMatch[2]}:${ffAnonMatch[3]}`);
        continue;
      }
    }
  }

  return lines.join("\n") + "\n";
}

function shortenFunctionName(fn: string): string {
  const slashIdx = fn.lastIndexOf("/");
  if (slashIdx >= 0) {
    fn = fn.slice(slashIdx + 1);
  }
  const dotIdx = fn.indexOf(".");
  if (dotIdx >= 0) {
    fn = fn.slice(dotIdx + 1);
  }
  return fn;
}

function shortenFilePath(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1];
}
