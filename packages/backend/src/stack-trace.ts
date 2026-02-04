export function formatErrorStackTrace(error: Error): string {
  const lines: string[] = [];

  const typeName = error.constructor.name || "Error";
  lines.push(`${typeName}: ${error.message}`);

  if (error.stack) {
    const stackLines = error.stack.split("\n");
    for (const line of stackLines) {
      const match = line.match(/^\s+at\s+(.+?)\s+\((.+):(\d+):\d+\)$/);
      if (match) {
        const funcName = shortenFunctionName(match[1]);
        const file = shortenFilePath(match[2]);
        const lineNum = match[3];
        lines.push(`${funcName}()`);
        lines.push(`    ${file}:${lineNum}`);
        continue;
      }

      const matchNoParens = line.match(/^\s+at\s+(.+):(\d+):\d+$/);
      if (matchNoParens) {
        const file = shortenFilePath(matchNoParens[1]);
        const lineNum = matchNoParens[2];
        lines.push(`<anonymous>()`);
        lines.push(`    ${file}:${lineNum}`);
        continue;
      }

      const matchFnOnly = line.match(/^\s+at\s+(.+)$/);
      if (matchFnOnly) {
        const funcName = shortenFunctionName(matchFnOnly[1]);
        lines.push(`${funcName}()`);
        lines.push(`    <unknown>:0`);
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
