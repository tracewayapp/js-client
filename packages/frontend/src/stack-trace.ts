export function formatBrowserStackTrace(error: Error): string {
  const lines: string[] = [];
  const typeName = error.constructor?.name || "Error";
  lines.push(`${typeName}: ${error.message}`);

  if (error.stack) {
    const stackLines = error.stack.split("\n");
    for (const line of stackLines) {
      // V8 format: "    at funcName (file:line:col)"
      const v8Match = line.match(/^\s+at\s+(.+?)\s+\((.+):(\d+):(\d+)\)$/);
      if (v8Match) {
        const funcName = shortenFunctionName(v8Match[1]);
        const [file, lineNo, colNo] = unwrapEvalLocation(
          v8Match[2],
          v8Match[3],
          v8Match[4],
        );
        lines.push(`${funcName}()`);
        lines.push(`    ${shortenFilePath(file)}:${lineNo}:${colNo}`);
        continue;
      }

      // V8 anonymous: "    at file:line:col"
      const v8AnonMatch = line.match(/^\s+at\s+(.+):(\d+):(\d+)$/);
      if (v8AnonMatch) {
        const file = shortenFilePath(v8AnonMatch[1]);
        lines.push(`<anonymous>()`);
        lines.push(`    ${file}:${v8AnonMatch[2]}:${v8AnonMatch[3]}`);
        continue;
      }

      // Firefox format: "funcName@file:line:col"
      const ffMatch = line.match(/^(.+)@(.+):(\d+):(\d+)$/);
      if (ffMatch) {
        let rawFn = ffMatch[1];
        const starIdx = rawFn.lastIndexOf("*");
        if (starIdx !== -1) {
          rawFn = rawFn.slice(starIdx + 1);
          if (!rawFn) {
            continue;
          }
        }
        const funcName = shortenFunctionName(rawFn) || "<anonymous>";
        const [file, lineNo, colNo] = unwrapEvalLocation(
          ffMatch[2],
          ffMatch[3],
          ffMatch[4],
        );
        lines.push(`${funcName}()`);
        lines.push(`    ${shortenFilePath(file)}:${lineNo}:${colNo}`);
        continue;
      }

      // Firefox anonymous: "@file:line:col"
      const ffAnonMatch = line.match(/^@(.+):(\d+):(\d+)$/);
      if (ffAnonMatch) {
        const [file, lineNo, colNo] = unwrapEvalLocation(
          ffAnonMatch[1],
          ffAnonMatch[2],
          ffAnonMatch[3],
        );
        lines.push(`<anonymous>()`);
        lines.push(`    ${shortenFilePath(file)}:${lineNo}:${colNo}`);
        continue;
      }
    }
  }

  return lines.join("\n") + "\n";
}

function unwrapEvalLocation(
  file: string,
  lineNo: string,
  colNo: string,
): [string, string, string] {
  if (file.startsWith("eval at ")) {
    const site = file.match(/\(([^()]+):(\d+):(\d+)\)/);
    if (site) {
      return [site[1], site[2], site[3]];
    }
  }
  const gecko = file.match(/^(.*?) line (\d+) > (?:eval|Function)(?: line \d+ > (?:eval|Function))*$/);
  if (gecko) {
    return [gecko[1], gecko[2], "1"];
  }
  return [file, lineNo, colNo];
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
