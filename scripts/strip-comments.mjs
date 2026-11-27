// A tsup plugin that removes comments from the built JavaScript. esbuild keeps the doc comments of class members in
// unminified output; editors read the documentation from the .d.ts files, which are built from the sources and keep
// every comment. Kept: legal comments, tree-shaking annotations (`@__PURE__`) and bundler hints (`webpackIgnore`).
// Only comments with nothing but whitespace after them on their line are removed, and a removed comment leaves its
// line breaks, so every line and column of the remaining code stays where the source map says it is.
import ts from "typescript";

const KEEP =
  /^\/\*!|@license|@preserve|[@#]__(?:PURE|NO_SIDE_EFFECTS)__|webpack[A-Z]|@vite-ignore|turbopackIgnore|^\/\/[#@] source(?:Mapping)?URL=/;

/** The comments of a script, as `[start, end]` offsets, in order. */
export function commentRanges(code) {
  const file = ts.createSourceFile(
    "bundle.js",
    code,
    {
      languageVersion: ts.ScriptTarget.Latest,
      jsDocParsingMode: ts.JSDocParsingMode.ParseNone,
    },
    false,
    ts.ScriptKind.JS,
  );
  const ranges = new Map();
  const visit = (node) => {
    const pos = node.pos;
    for (const range of [
      ...(ts.getLeadingCommentRanges(code, pos) ?? []),
      ...(ts.getTrailingCommentRanges(code, pos) ?? []),
    ])
      ranges.set(range.pos, range.end);
    for (const child of node.getChildren(file)) visit(child);
  };
  visit(file);
  return [...ranges].sort((a, b) => a[0] - b[0]);
}

/** `code` without its comments, see above. `kept` counts the comments left in place. */
export function stripComments(code) {
  let out = "";
  let last = 0;
  let removed = 0;
  let kept = 0;
  for (const [start, end] of commentRanges(code)) {
    if (start < last) continue;
    const text = code.slice(start, end);
    if (KEEP.test(text)) continue;
    const lineStart = code.lastIndexOf("\n", start - 1) + 1;
    const lineEnd = code.indexOf("\n", end);
    if (/\S/.test(code.slice(end, lineEnd < 0 ? code.length : lineEnd))) {
      // Code follows on the same line: removing the comment would move it.
      kept++;
      continue;
    }
    const before = code.slice(lineStart, start);
    const from = /\S/.test(before)
      ? lineStart + before.trimEnd().length
      : lineStart;
    out += code.slice(last, from) + text.replace(/[^\n]/g, "");
    last = end;
    removed++;
  }
  return { code: out + code.slice(last), removed, kept };
}

export function stripCommentsPlugin() {
  return {
    name: "strip-comments",
    renderChunk(code, info) {
      if (!/\.[cm]?js$/.test(info.path)) return;
      return { code: stripComments(code).code };
    },
  };
}
