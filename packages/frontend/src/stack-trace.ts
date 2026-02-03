export function formatBrowserStackTrace(error: Error): string {
  const lines: string[] = [];
  const typeName = error.constructor?.name || "Error";
  lines.push(`${typeName}: ${error.message}`);

  if (error.stack) {
    const stackLines = error.stack.split("\n");
    for (const line of stackLines) {
      // V8 format: "    at funcName (file:line:col)"
      const v8Match = line.match(/^\s+at\s+(.+?)\s+\((.+):(\d+):\d+\)$/);
      if (v8Match) {
        const funcName = shortenFunctionName(v8Match[1]);
        const file = shortenFilePath(v8Match[2]);
        lines.push(`${funcName}()`);
        lines.push(`    ${file}:${v8Match[3]}`);
        continue;
      }

      // V8 anonymous: "    at file:line:col"
      const v8AnonMatch = line.match(/^\s+at\s+(.+):(\d+):\d+$/);
      if (v8AnonMatch) {
        const file = shortenFilePath(v8AnonMatch[1]);
        lines.push(`<anonymous>()`);
        lines.push(`    ${file}:${v8AnonMatch[2]}`);
        continue;
      }

      // Firefox format: "funcName@file:line:col"
      const ffMatch = line.match(/^(.+)@(.+):(\d+):\d+$/);
      if (ffMatch) {
        const funcName = shortenFunctionName(ffMatch[1]) || "<anonymous>";
        const file = shortenFilePath(ffMatch[2]);
        lines.push(`${funcName}()`);
        lines.push(`    ${file}:${ffMatch[3]}`);
        continue;
      }

      // Firefox anonymous: "@file:line:col"
      const ffAnonMatch = line.match(/^@(.+):(\d+):\d+$/);
      if (ffAnonMatch) {
        const file = shortenFilePath(ffAnonMatch[1]);
        lines.push(`<anonymous>()`);
        lines.push(`    ${file}:${ffAnonMatch[2]}`);
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
