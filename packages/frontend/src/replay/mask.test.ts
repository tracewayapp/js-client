// What `maskEvent` hides inside `traceway-mask` that rrweb itself leaves visible (JS-13, JS-16); the real-recorder
// cases are in session-recorder.integration.test.ts.
import { afterEach, describe, expect, it } from "vitest";
import type { eventWithTime } from "@rrweb/types";
import { inMask, maskEvent } from "./mask.js";

afterEach(() => document.body.replaceChildren());

const event = (type: number, data: unknown) => ({ type, timestamp: 0, data }) as eventWithTime;

describe("maskEvent", () => {
  it("masks a snapshot's masked subtree: text and text attributes as *, pictures left out, style text kept", () => {
    const snapshot = {
      type: 0,
      id: 1,
      childNodes: [
        {
          type: 2, id: 2, tagName: "div", attributes: { class: "card traceway-mask", "data-user": "alice" },
          childNodes: [
            { type: 2, id: 3, tagName: "span", attributes: { title: "Alice Smith", class: "x", style: "background: url(/a.jpg) no-repeat; color: red" }, childNodes: [{ type: 3, id: 4, textContent: "Alice" }] },
            { type: 2, id: 5, tagName: "input", attributes: { type: "image", src: "/b.jpg", value: "Go now" }, childNodes: [] },
            { type: 2, id: 6, tagName: "style", attributes: {}, childNodes: [{ type: 3, id: 7, textContent: ".x { color: red }", isStyle: true }] },
            { type: 5, id: 8, textContent: "comment about Alice" },
          ],
        },
        { type: 2, id: 9, tagName: "p", attributes: { title: "Public" }, childNodes: [{ type: 3, id: 10, textContent: "Shown" }] },
      ],
    };
    maskEvent(event(2, { node: snapshot }), () => null);
    const [masked, open] = snapshot.childNodes as any[];
    expect(masked.attributes).toEqual({ class: "card traceway-mask", "data-user": "*****" });
    const [span, input, style, comment] = masked.childNodes;
    expect(span.attributes).toEqual({ title: "***** *****", class: "x", style: "background: none no-repeat; color: red" });
    expect(span.childNodes[0].textContent).toBe("*****");
    expect(input.attributes).toEqual({ type: "image", value: "** ***" });
    expect(style.childNodes[0].textContent).toBe(".x { color: red }");
    expect(comment.textContent).toBe("******* ***** *****");
    expect(open.attributes.title).toBe("Public");
    expect(open.childNodes[0].textContent).toBe("Shown");
  });

  it("masks what a mutation adds or changes inside a mask, and leaves the rest", () => {
    document.body.innerHTML = `<div class="traceway-mask"><b id="in">Old</b><style id="css">.a{}</style></div><i id="out">Out</i>`;
    const nodes: Record<number, Node> = {
      1: document.querySelector("#in")!,
      2: document.querySelector("#in")!.firstChild!,
      3: document.querySelector("#css")!.firstChild!,
      4: document.querySelector("#out")!,
      5: document.querySelector("#out")!.firstChild!,
    };
    const live = (id: number) => nodes[id] ?? null;
    const mutation = {
      source: 0,
      // 20 is added in this event under a masked node, and 21 under 20: neither is in the page's DOM yet here.
      adds: [
        { parentId: 1, nextId: null, node: { type: 2, id: 20, tagName: "span", attributes: { "aria-label": "Bob" }, childNodes: [] } },
        { parentId: 20, nextId: null, node: { type: 3, id: 21, textContent: "Bob Jones" } },
        { parentId: 4, nextId: null, node: { type: 3, id: 22, textContent: "Visible" } },
      ],
      texts: [{ id: 2, value: "New secret" }, { id: 3, value: ".b{}" }, { id: 5, value: "Out text" }],
      attributes: [
        { id: 1, attributes: { title: "Carol", style: { "background-image": "url(/c.jpg)", color: ["red", "important"] }, src: "/d.jpg", hidden: null } },
        { id: 4, attributes: { title: "Open" } },
      ],
      removes: [],
    };
    maskEvent(event(3, mutation), live);
    expect(mutation.adds.map((a: any) => a.node.attributes?.["aria-label"] ?? a.node.textContent)).toEqual(["***", "*** *****", "Visible"]);
    expect(mutation.texts.map((t) => t.value)).toEqual(["*** ******", ".b{}", "Out text"]);
    expect(mutation.attributes[0]!.attributes).toEqual({ title: "*****", style: { "background-image": "none", color: ["red", "important"] }, hidden: null });
    expect(mutation.attributes[1]!.attributes).toEqual({ title: "Open" });
  });

  it("masks what is typed into a field inside a mask, whatever maskAllInputs says", () => {
    document.body.innerHTML = `<label class="traceway-mask"><input id="in"></label><input id="out">`;
    const live = (id: number) => document.querySelector(id === 1 ? "#in" : "#out");
    const typed = { source: 5, id: 1, text: "123-45-6789", isChecked: false };
    const open = { source: 5, id: 2, text: "hello", isChecked: false };
    maskEvent(event(3, typed), live);
    maskEvent(event(3, open), live);
    expect(typed.text).toBe("*".repeat(11));
    expect(open.text).toBe("hello");
  });

  it("finds a mask past shadow roots and frames, and none for nodes it cannot place", () => {
    document.body.innerHTML = `<div class="traceway-mask"><span id="host"></span></div>`;
    const root = document.querySelector("#host")!.attachShadow({ mode: "open" });
    root.innerHTML = "<b>x</b>";
    expect(inMask(root.querySelector("b")!.firstChild)).toBe(true);
    expect(inMask(root)).toBe(true);
    expect(inMask(document.body)).toBe(false);
    expect(inMask(null)).toBe(false);
    expect(inMask({ get parentNode(): never { throw new Error("cross-origin"); } } as any)).toBe(false);
  });
});
