// The build removes comments from the shipped JavaScript (scripts/strip-comments.mjs); the .d.ts files keep them.
import { describe, expect, it } from "vitest";
// @ts-ignore A build script without type declarations.
import { stripComments } from "../../../scripts/strip-comments.mjs";

const strip = (code: string): string => stripComments(code).code;

describe("stripComments", () => {
  it("removes doc and line comments, and every line and column of the code stays where it was", () => {
    const code = [
      "// src/client.ts",
      "class A {",
      "  /** The doc of a member. */",
      "  x = 1;",
      "  /**",
      "   * A doc over",
      "   * three lines.",
      "   */",
      "  m() {",
      "    return this.x; // trailing note",
      "  }",
      "}",
    ].join("\n");
    const out = strip(code);
    expect(out).not.toMatch(/\/\*\*|\/\/ /);
    const lines = out.split("\n");
    expect(lines).toHaveLength(12);
    for (const [i, line] of code.split("\n").entries()) {
      if (lines[i]!.trim()) expect(line.startsWith(lines[i]!)).toBe(true);
    }
    expect(lines[3]).toBe("  x = 1;");
    expect(lines[9]).toBe("    return this.x;");
  });

  it("keeps legal comments, tree-shaking annotations, bundler hints and the source map link", () => {
    const kept = [
      "/*! MIT licensed */",
      "/** @license MIT */",
      "const a = /* @__PURE__ */ make();",
      "const b = /* #__PURE__ */ make();",
      'import(/* webpackIgnore: true */ "x");',
      'import(/* @vite-ignore */ "y");',
      "//# sourceMappingURL=index.mjs.map",
    ];
    for (const line of kept) expect(strip(line)).toBe(line);
  });

  it("leaves text that only looks like a comment in strings, templates and regular expressions", () => {
    const code = [
      'const s = "/** not a comment */";',
      "const t = `// nor ${'/* this */'}`;",
      "const r = /\\/\\*.*\\*\\//g;",
      "const u = 'http://example.test';",
    ].join("\n");
    expect(strip(code)).toBe(code);
  });

  it("keeps a comment with code after it on the same line, which would move if it went", () => {
    const code = "call(/* first */ 1, 2);";
    expect(stripComments(code)).toEqual({ code, removed: 0, kept: 1 });
  });
});
