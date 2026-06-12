import { describe, expect, it } from "vitest";
import { formatBrowserStackTrace } from "./stack-trace.js";

function fakeError(message: string, stack: string): Error {
  const err = new Error(message);
  err.stack = stack;
  return err;
}

describe("formatBrowserStackTrace eval frames", () => {
  it("unwraps chrome eval frames to the eval call site", () => {
    const err = fakeError(
      "boom from inside eval",
      [
        "Error: boom from inside eval",
        "    at evalBoom (eval at handleEvalThrow (http://localhost:4173/assets/app.js:1:1635), <anonymous>:1:30)",
        "    at handleEvalThrow (http://localhost:4173/assets/app.js:1:1635)",
      ].join("\n"),
    );
    expect(formatBrowserStackTrace(err)).toBe(
      "Error: boom from inside eval\nevalBoom()\n    app.js:1:1635\nhandleEvalThrow()\n    app.js:1:1635\n",
    );
  });

  it("unwraps nested chrome eval frames", () => {
    const err = fakeError(
      "deep",
      [
        "Error: deep",
        "    at inner (eval at outer (eval at top (http://x/app.js:2:10), <anonymous>:1:5), <anonymous>:1:9)",
      ].join("\n"),
    );
    expect(formatBrowserStackTrace(err)).toBe(
      "Error: deep\ninner()\n    app.js:2:10\n",
    );
  });

  it("unwraps firefox eval line markers to the eval site line", () => {
    const err = fakeError(
      "boom from inside eval",
      [
        "evalBoom@http://localhost:4173/assets/app.js line 1 > eval:1:30",
        "@http://localhost:4173/assets/app.js line 1 > eval:1:68",
        "handleEvalThrow@http://localhost:4173/assets/app.js:1:1635",
      ].join("\n"),
    );
    expect(formatBrowserStackTrace(err)).toBe(
      "Error: boom from inside eval\nevalBoom()\n    app.js:1:1\n<anonymous>()\n    app.js:1:1\nhandleEvalThrow()\n    app.js:1:1635\n",
    );
  });

  it("unwraps repeated firefox eval markers", () => {
    const err = fakeError(
      "deep",
      ["f@http://x/app.js line 3 > eval line 1 > eval:1:9"].join("\n"),
    );
    expect(formatBrowserStackTrace(err)).toBe(
      "Error: deep\nf()\n    app.js:3:1\n",
    );
  });

  it("leaves regular frames untouched", () => {
    const err = fakeError(
      "plain",
      [
        "Error: plain",
        "    at doWork (http://x/assets/app.js:1:42)",
      ].join("\n"),
    );
    expect(formatBrowserStackTrace(err)).toBe(
      "Error: plain\ndoWork()\n    app.js:1:42\n",
    );
  });
});

describe("formatBrowserStackTrace firefox synthetic frames", () => {
  it("drops bare synthetic frames and unwraps star-prefixed callees", () => {
    const err = fakeError(
      "x is undefined",
      [
        "assertValid@http://x/app.js:1:730",
        "handleEvent*@http://x/app.js:1:2067",
        "async*@http://x/app.js:1:2223",
        "async*loadRate@http://x/app.js:1:2300",
      ].join("\n"),
    );
    expect(formatBrowserStackTrace(err)).toBe(
      "Error: x is undefined\nassertValid()\n    app.js:1:730\nloadRate()\n    app.js:1:2300\n",
    );
  });
});
