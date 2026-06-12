import { describe, expect, it } from "vitest";

import {
  addDebugIdComment,
  addDebugIdToMap,
  extractDebugIdFromSource,
  getDebugIdSnippet,
  getInjectionOffset,
  hasDebugIdComment,
  isValidDebugId,
  stringToDebugId,
} from "./debug-id";

const ID = "85314830-023f-4cf1-a267-535f4e37bb17";

describe("stringToDebugId", () => {
  it("produces a valid lowercase uuid", () => {
    const id = stringToDebugId("console.log(1);");
    expect(isValidDebugId(id)).toBe(true);
  });

  it("is deterministic for the same content", () => {
    expect(stringToDebugId("abc")).toBe(stringToDebugId("abc"));
    expect(stringToDebugId("abc")).not.toBe(stringToDebugId("abd"));
  });
});

describe("getInjectionOffset", () => {
  it("returns 0 for plain code", () => {
    expect(getInjectionOffset("console.log(1);")).toBe(0);
  });

  it("skips the shebang line", () => {
    const code = "#!/usr/bin/env node\nconsole.log(1);";
    expect(getInjectionOffset(code)).toBe(20);
  });

  it("skips use strict directives", () => {
    const code = '"use strict";\nconsole.log(1);';
    expect(getInjectionOffset(code)).toBe(13);
  });

  it("skips leading comments before directives", () => {
    const code = '/* banner */\n"use strict";\nconsole.log(1);';
    expect(getInjectionOffset(code)).toBe(26);
  });
});

describe("extractDebugIdFromSource", () => {
  it("finds the runtime marker", () => {
    const code = getDebugIdSnippet(ID) + "\nconsole.log(1);";
    expect(extractDebugIdFromSource(code)).toBe(ID);
  });

  it("finds the trailing comment", () => {
    const code = `console.log(1);\n//# debugId=${ID}\n`;
    expect(extractDebugIdFromSource(code)).toBe(ID);
  });

  it("returns undefined when absent", () => {
    expect(extractDebugIdFromSource("console.log(1);")).toBeUndefined();
  });
});

describe("addDebugIdComment", () => {
  it("inserts before the sourceMappingURL comment", () => {
    const code = "console.log(1);\n//# sourceMappingURL=app.js.map\n";
    expect(addDebugIdComment(code, ID)).toBe(
      `console.log(1);\n//# debugId=${ID}\n//# sourceMappingURL=app.js.map\n`,
    );
  });

  it("appends when there is no sourceMappingURL comment", () => {
    expect(addDebugIdComment("console.log(1);", ID)).toBe(
      `console.log(1);\n//# debugId=${ID}\n`,
    );
  });

  it("is detected by hasDebugIdComment", () => {
    expect(hasDebugIdComment(addDebugIdComment("x", ID))).toBe(true);
    expect(hasDebugIdComment("console.log(1);")).toBe(false);
  });
});

describe("addDebugIdToMap", () => {
  it("adds both debugId spellings", () => {
    const patched = JSON.parse(addDebugIdToMap('{"version":3}', ID));
    expect(patched.debugId).toBe(ID);
    expect(patched.debug_id).toBe(ID);
  });

  it("keeps an existing debugId", () => {
    const original = JSON.stringify({ version: 3, debugId: ID });
    expect(addDebugIdToMap(original, stringToDebugId("other"))).toBe(original);
  });
});

describe("getDebugIdSnippet", () => {
  it("registers the debug id keyed by stack in a runtime global", () => {
    const sandbox = { Error };
    const fn = new Function(
      "window",
      getDebugIdSnippet(ID).replace(/^;/, ""),
    );
    fn(sandbox);
    const registry = (
      sandbox as unknown as { _tracewayDebugIds: Record<string, string> }
    )._tracewayDebugIds;
    expect(registry).toBeDefined();
    expect(Object.values(registry)).toContain(ID);
    expect(
      (sandbox as unknown as { _tracewayDebugIdIdentifier: string })
        ._tracewayDebugIdIdentifier,
    ).toBe(`traceway-dbid-${ID}`);
  });
});
