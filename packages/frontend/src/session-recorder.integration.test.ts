import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType, IncrementalSource, type eventWithTime } from "@rrweb/types";
import { SessionRecorder } from "./session-recorder.js";

let recorder: SessionRecorder | undefined;

interface SerializedElement {
  type: 2;
  tagName: string;
  attributes: Record<string, string | number | boolean | null>;
  childNodes: SerializedNode[];
}
type SerializedNode = SerializedElement | { type: number; childNodes?: SerializedNode[] };

/** Every element node of the full snapshots and of the nodes mutations add. */
function serializedElements(events: eventWithTime[]): SerializedElement[] {
  const found: SerializedElement[] = [];
  const walk = (node: SerializedNode) => {
    if (node.type === 2) found.push(node as SerializedElement);
    for (const child of node.childNodes ?? []) walk(child);
  };
  for (const event of events) {
    if (event.type === EventType.FullSnapshot) walk(event.data.node as unknown as SerializedNode);
    if (event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Mutation)
      for (const add of event.data.adds) walk(add.node as unknown as SerializedNode);
  }
  return found;
}

afterEach(() => {
  recorder?.stop();
  recorder = undefined;
  document.body.replaceChildren();
});

describe("SessionRecorder with the real recorder", () => {
  it("records snapshots, DOM changes, shadow DOM and input while masking passwords", async () => {
    document.body.innerHTML = `
      <p>Initial text</p>
      <input id="input" />
      <input type="password" value="initial-secret" />
      <div id="shadow"></div>
    `;
    recorder = new SessionRecorder();
    await recorder.start({ maskAllInputs: false });
    expect(recorder.getClipEvents().some((event) => event.type === EventType.FullSnapshot)).toBe(true);

    document.querySelector("p")!.textContent = "Updated text";
    const added = document.createElement("span");
    added.textContent = "Added node";
    document.body.append(added);
    document.querySelector("#shadow")!.attachShadow({ mode: "open" }).innerHTML =
      "<b>Shadow content</b>";
    const input = document.querySelector<HTMLInputElement>("#input")!;
    input.value = "Recorded input";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    const password = document.querySelector<HTMLInputElement>("[type=password]")!;
    password.value = "updated-secret";
    password.dispatchEvent(new Event("input", { bubbles: true }));

    await vi.waitFor(() => {
      const events = recorder!.getClipEvents();
      const json = JSON.stringify(events);
      expect(json).toContain("Updated text");
      expect(json).toContain("Added node");
      expect(json).toContain("Shadow content");
      expect(json).toContain("Recorded input");
      expect(json).not.toContain("initial-secret");
      expect(json).not.toContain("updated-secret");
      expect(json).toContain("********");
      expect(events.some((event) =>
        event.type === EventType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Input,
      )).toBe(true);
    });

    added.remove();
    await vi.waitFor(() => {
      expect(recorder!.getClipEvents().some((event) =>
        event.type === EventType.IncrementalSnapshot &&
        event.data.source === IncrementalSource.Mutation &&
        event.data.removes.length > 0,
      )).toBe(true);
    });
  });

  it("masks traceway-mask text and media and blanks traceway-blank, next to rrweb's own classes", async () => {
    document.body.innerHTML = `
      <p class="traceway-mask">Card 4242 owner Alice</p>
      <div class="traceway-mask" id="gallery">
        <span>Nested masked line</span>
        <img src="https://img.test/masked-photo.png">
        <svg><text>svg-label-secret</text></svg>
      </div>
      <img class="traceway-mask" src="https://img.test/self-masked.png">
      <div class="traceway-blank"><b>Blank area secret</b><input value="blank-input-secret"></div>
      <p class="rr-mask">rrweb masked line</p>
      <div class="rr-block">rrweb blocked secret</div>
      <p>Visible paragraph</p>
    `;
    recorder = new SessionRecorder();
    await recorder.start({ maskAllInputs: false });

    document.querySelector("p.traceway-mask")!.textContent = "Updated card 5555";
    const late = document.createElement("img");
    late.src = "https://img.test/late-photo.png";
    document.querySelector("#gallery")!.append(late);

    await vi.waitFor(() => {
      const images = serializedElements(recorder!.getClipEvents()).filter((node) => node.tagName === "img");
      expect(images).toHaveLength(3);
    });

    const events = recorder.getClipEvents();
    const json = JSON.stringify(events);
    expect(json).toContain("Visible paragraph");
    for (const secret of [
      "Alice", "4242", "5555", "Nested masked", "masked-photo", "svg-label-secret", "self-masked",
      "Blank area secret", "blank-input-secret", "late-photo", "rrweb masked", "rrweb blocked secret",
    ])
      expect(json, secret).not.toContain(secret);
    expect(json).toContain("**** **** ***** *****");
    expect(json).toContain("****** ****** ****");

    const elements = serializedElements(events);
    const blocked = (tag: string, className?: string) =>
      elements.filter((node) =>
        node.tagName === tag &&
        (className === undefined || node.attributes.class === className) &&
        node.attributes.rr_width !== undefined &&
        node.attributes.src === undefined &&
        node.childNodes.length === 0,
      );
    expect(blocked("div", "traceway-blank")).toHaveLength(1);
    expect(blocked("div", "rr-block")).toHaveLength(1);
    expect(blocked("svg")).toHaveLength(1);
    expect(blocked("img", "traceway-mask")).toHaveLength(1);
    expect(blocked("img")).toHaveLength(3);
  });

  it("rotates into replayable segments, takes fresh snapshots and stops observing", async () => {
    document.body.innerHTML = "<p>Before rotation</p>";
    const ready = vi.fn();
    const activity = vi.fn();
    recorder = new SessionRecorder({
      segmentDuration: 50,
      onSegmentReady: ready,
      onActivity: activity,
    });
    await recorder.start({ maskAllInputs: false });
    await new Promise((resolve) => setTimeout(resolve, 80));
    document.querySelector("p")!.textContent = "After rotation";
    await vi.waitFor(() => {
      expect(ready).toHaveBeenCalled();
      expect(recorder!.getClipEvents().some((event) => event.type === EventType.FullSnapshot)).toBe(true);
      expect(JSON.stringify(recorder!.getClipEvents())).toContain("After rotation");
    });

    recorder.startFresh();
    expect(recorder.getSegments()).toHaveLength(1);
    expect(recorder.getClipEvents().some((event) => event.type === EventType.FullSnapshot)).toBe(true);
    expect(activity).toHaveBeenCalled();
    recorder.stop();
    const stoppedEvents = JSON.stringify(recorder.getClipEvents());
    document.querySelector("p")!.textContent = "After stop";
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(JSON.stringify(recorder.getClipEvents())).toBe(stoppedEvents);
    expect(recorder.drainCurrent()).toBeNull();
    expect(recorder.hasSegments()).toBe(false);
  });
});

describe("maskAllInputs with the real recorder", () => {
  const page = `<form>
      <input id="name" value="Alice Smith">
      <input id="csrf" type="hidden" name="csrf_token" value="csrf-initial-token">
      <input id="upload" type="file">
      <input type="submit" value="Send order">
    </form><p>before</p>`;

  async function record(options: { maskAllInputs?: boolean }): Promise<string> {
    document.body.innerHTML = page;
    // jsdom cannot pick a file: the value a browser reports once the user has.
    Object.defineProperty(document.querySelector("#upload")!, "value", { configurable: true, value: "C:\\fakepath\\passport-alice.pdf" });
    recorder = new SessionRecorder();
    await recorder.start(options);
    const csrf = document.querySelector<HTMLInputElement>("#csrf")!;
    // rrweb records a value set from script as an input event, and a changed attribute as a mutation.
    csrf.value = "csrf-script-token";
    document.querySelector("#upload")!.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => expect(recorder!.getClipEvents().filter((event) =>
      event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Input)).toHaveLength(2));
    csrf.setAttribute("value", "csrf-attribute-token");
    document.querySelector("p")!.textContent = "change observed";
    await vi.waitFor(() => expect(JSON.stringify(recorder!.getClipEvents())).toContain("change observed"));
    const events = recorder.getClipEvents();
    expect(events.some((event) =>
      event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Input)).toBe(true);
    return JSON.stringify(events);
  }

  it("records hidden and file inputs as * like every other field, and keeps a button's label", async () => {
    const json = await record({});
    for (const secret of ["Alice Smith", "csrf-initial-token", "csrf-script-token", "csrf-attribute-token", "passport-alice"])
      expect(json, secret).not.toContain(secret);
    expect(json).toContain("*".repeat("csrf-initial-token".length));
    expect(json).toContain("Send order");
  });

  it("off: records them as they are", async () => {
    const json = await record({ maskAllInputs: false });
    for (const value of ["Alice Smith", "csrf-initial-token", "csrf-script-token", "csrf-attribute-token", "passport-alice"])
      expect(json, value).toContain(value);
  });
});

describe("replay.images with the real recorder (§14.5)", () => {
  const page = `
    <img id="photo" src="https://app.test/photo.jpg">
    <picture><source srcset="https://app.test/art.webp"><img src="https://app.test/art.jpg"></picture>
    <div class="traceway-mask"><img id="secret" src="https://app.test/secret.jpg"></div>
  `;

  /** jsdom loads no images and lays nothing out: a picture as a browser has it once loaded and shown. */
  function loaded(img: HTMLImageElement, width = 640, height = 480): HTMLImageElement {
    for (const [key, value] of Object.entries({
      complete: true,
      naturalWidth: width,
      naturalHeight: height,
      width: width / 2,
      height: height / 2,
    }))
      Object.defineProperty(img, key, { configurable: true, value });
    return img;
  }

  it("off: records every picture as an empty box of its size", async () => {
    document.body.innerHTML = page;
    recorder = new SessionRecorder();
    await recorder.start({ maskAllInputs: false, images: "off" });
    const events = recorder.getClipEvents();
    expect(JSON.stringify(events)).not.toContain("app.test");
    const pictures = serializedElements(events).filter((node) => ["img", "picture"].includes(node.tagName));
    expect(pictures.map((node) => node.tagName).sort()).toEqual(["img", "img", "picture"]);
    for (const node of pictures) {
      expect(node.attributes.rr_width).toBeDefined();
      expect(node.attributes.src).toBeUndefined();
      expect(node.childNodes).toEqual([]);
    }
  });

  it("wifi (the default): records the URLs of the pictures and no pixels", async () => {
    document.body.innerHTML = page;
    recorder = new SessionRecorder();
    await recorder.start({ maskAllInputs: false });
    const json = JSON.stringify(recorder.getClipEvents());
    expect(json).toContain("https://app.test/photo.jpg");
    expect(json).toContain("https://app.test/art.jpg");
    expect(json).not.toContain("secret.jpg");
    expect(json).not.toContain("rr_dataURL");
  });

  it.each(["wifi", "always"] as const)("strips original inline image bytes from snapshots and updates under %s", async (images) => {
    const original = "data:image/png;base64,YXBwUGl4ZWxz";
    document.body.innerHTML = `<picture><source srcset="${original} 1x"><img src="${original}"></picture>
      <svg><image href="${original}"></image></svg><input type="image" src="${original}">
      <a href="${original}">Open preview</a><object data="${original}"></object><img data-lazy-src="${original}">
      <style>.preview { color: red; background-image: url("${original}"); }</style>
      <div style="background-image: url('${original}')"></div><iframe srcdoc="&lt;img src='${original}'&gt;"></iframe><p>before update</p>`;
    recorder = new SessionRecorder();
    await recorder.start({ images });
    document.querySelector("img")!.src = original + "QQ";
    document.querySelector("source")!.srcset = original + "QQ 2x";
    document.querySelector("img")!.dataset.lazyPreview = original + "QQ";
    document.querySelector("p")!.textContent = "after update";
    await vi.waitFor(() => expect(JSON.stringify(recorder!.getClipEvents())).toContain("after update"));
    expect(JSON.stringify(recorder.getClipEvents())).not.toContain("YXBwUGl4ZWxz");
  });

  it("keeps exactly 128 KiB of copies; past that the segment keeps the URLs only, and the next one starts afresh", async ({ onTestFinished }) => {
    // Exercise the byte limit regardless of jsdom's first computed-style lookup.
    // The encoder's per-event time limit has a separate regression.
    vi.spyOn(performance, "now").mockReturnValue(0);
    onTestFinished(() => { vi.restoreAllMocks(); });
    const thumbnail = "data:image/jpeg;base64,".padEnd(64 * 1024, "A");
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage() {},
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(thumbnail);

    const photo = () => {
      const img = loaded(document.createElement("img"), 120, 80);
      img.src = "https://app.test/avatar.jpg";
      return img;
    };
    // Pictures of another origin that the page has not loaded: URL references under every policy.
    document.body.innerHTML = `<p>Order details</p>
      <img id="cdn" src="https://cdn.other.test/banner.jpg" srcset="https://cdn.other.test/banner@2x.jpg 2x">
      <picture><source srcset="https://cdn.other.test/art.webp"><img src="https://cdn.other.test/art.jpg"></picture>
      <video poster="https://cdn.other.test/poster.jpg"></video>
      <svg><image href="https://cdn.other.test/map.png"></image></svg>`;
    document.body.append(photo());
    recorder = new SessionRecorder();
    await recorder.start({ images: "always" });
    const images = () => serializedElements(recorder!.getClipEvents()).filter(n => n.tagName === "img");
    const copies = () => images().filter(n => n.attributes.rr_dataURL);
    document.body.append(photo());
    await vi.waitFor(() => expect(copies()).toHaveLength(2));
    expect(recorder.images.bytes).toBe(128 * 1024);

    document.body.append(photo());
    await vi.waitFor(() => expect(images()).toHaveLength(5));
    const exported = JSON.stringify(recorder.peekCurrent()?.events);
    expect(exported).toContain("Order details");
    expect(exported).not.toContain(thumbnail.slice(0, 80));
    expect(copies()).toEqual([]);
    expect(recorder.images.bytes).toBe(0);
    // What "wifi" records of the same page.
    expect(images().filter(n => n.attributes.src === "https://app.test/avatar.jpg")).toHaveLength(3);
    for (const url of ["banner.jpg", "banner@2x.jpg 2x", "art.webp", "art.jpg", "poster.jpg", "map.png"])
      expect(exported, url).toContain("https://cdn.other.test/" + url);
    for (const image of images()) {
      expect(image.attributes.rr_width).toBeUndefined();
      expect(image.attributes.style).toBeUndefined();
    }

    document.body.replaceChildren(photo());
    recorder.startFresh();
    expect(images()).toHaveLength(1);
    expect(images()[0]!.attributes.rr_dataURL).toBe(thumbnail);
    expect(images()[0]!.attributes.src).toBe("https://app.test/avatar.jpg");
  });

  it.each(["wifi", "always", "off"] as const)("%s: keeps small svg data URLs (vector icons) and the box of an <img> whose data: source it removes", async (images) => {
    const tick = "data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2016%2016%27%3E%3Cpath%20d=%27m6%2010%203%203%206-6%27/%3E%3C/svg%3E";
    const large = "data:image/svg+xml,%3Csvg%20id=%27large%27%3E" + "a".repeat(4096);
    const photo = "data:image/png;base64,cGhvdG9QaXhlbHM=";
    document.body.innerHTML = `<style>.check:checked { background-image: url("${tick}"); } .hero { background-image: url("${large}"); }</style>
      <div id="close" style="background: url('${tick}') no-repeat"></div>
      <p id="logo-row"><img id="logo" src="${photo}"></p><input class="check" type="checkbox" checked><p>before update</p>`;
    loaded(document.querySelector<HTMLImageElement>("#logo")!, 240, 80);
    // No canvas in jsdom: under "always" the picture gets no copy, as one the page may not read.
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    recorder = new SessionRecorder();
    await recorder.start({ images });
    canvas.mockRestore();
    document.querySelector<HTMLElement>("#logo-row")!.style.backgroundImage = `url("${tick}")`;
    document.querySelector("p:last-child")!.textContent = "after update";
    await vi.waitFor(() => expect(JSON.stringify(recorder!.getClipEvents())).toContain("after update"));
    const events = recorder.getClipEvents();
    const json = JSON.stringify(events);
    expect(json).not.toContain("cGhvdG9QaXhlbHM=");
    expect(json).not.toContain("id=%27large%27");
    const elements = serializedElements(events);
    expect(String(elements.find((node) => node.tagName === "style")!.attributes._cssText)).toContain(tick);
    expect(String(elements.find((node) => node.attributes.id === "close")!.attributes.style)).toContain(tick);
    const mutated = events.flatMap((event) =>
      event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Mutation ? event.data.attributes : []);
    expect(JSON.stringify(mutated)).toContain(tick);
    const logo = elements.find((node) => node.tagName === "img")!;
    expect(logo.attributes.src).toBeUndefined();
    // "off": rrweb's own box, which jsdom measures as 0 by 0.
    expect(logo.attributes.rr_width).toBe(images === "off" ? "0px" : "120px");
    expect(logo.attributes.rr_height).toBe(images === "off" ? "0px" : "40px");
  });

  it("always: adds small copies of the page's pictures, never of masked ones, and leaves the page's images as they are", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
      drawImage: vi.fn(),
      getImageData: () => ({ data: new Uint8ClampedArray(4).fill(255) }),
    } as any);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
      (type?: string) => `data:${type};base64,AAAA`,
    );
    try {
      document.body.innerHTML = page;
      document.querySelectorAll("img").forEach((img) => loaded(img));
      recorder = new SessionRecorder();
      await recorder.start({ maskAllInputs: false, images: "always" });
      const late = loaded(document.createElement("img"), 100, 100);
      late.src = "https://app.test/late.jpg";
      document.body.append(late);
      await vi.waitFor(() => {
        const images = serializedElements(recorder!.getClipEvents()).filter((node) => node.tagName === "img");
        expect(images.filter((node) => node.attributes.rr_dataURL)).toHaveLength(3);
      });
      const images = serializedElements(recorder.getClipEvents()).filter((node) => node.tagName === "img");
      const bySrc = Object.fromEntries(images.map((node) => [String(node.attributes.src), node]));
      for (const src of ["photo", "art", "late"])
        expect(bySrc[`https://app.test/${src}.jpg`]!.attributes.rr_dataURL).toBe("data:image/jpeg;base64,AAAA");
      // The masked one: an empty box, no URL, no pixels.
      const masked = images.find((node) => node.attributes.src === undefined)!;
      expect(masked.attributes.rr_dataURL).toBeUndefined();
      expect(JSON.stringify(recorder.getClipEvents())).not.toContain("secret.jpg");
      for (const img of document.querySelectorAll("img")) {
        expect(img.hasAttribute("crossorigin")).toBe(false);
        expect(img.getAttribute("src")).toMatch(/^https:\/\/app\.test\//);
      }
      expect(recorder.images.bytes).toBe(3 * "data:image/jpeg;base64,AAAA".length);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe("traceway-mask beyond rrweb's own masking (JS-13, JS-16)", () => {
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

  it("omits a masked iframe document from snapshots and attribute changes", async () => {
    document.body.innerHTML = '<div class="traceway-mask"><iframe srcdoc="private initial note"></iframe></div><p>before</p>';
    recorder = new SessionRecorder();
    await recorder.start();
    document.querySelector("iframe")!.srcdoc = "private changed note";
    document.querySelector("p")!.textContent = "change observed";
    await vi.waitFor(() => expect(JSON.stringify(recorder!.getClipEvents())).toContain("change observed"));
    expect(JSON.stringify(recorder.getClipEvents())).not.toMatch(/private initial note|private changed note/);
  });

  it("leaves out the source of a masked iframe that rrweb cannot read, and an inline document given as a data: source", async () => {
    document.body.innerHTML = `<div class="traceway-mask"><iframe id="viewer" src="https://docs.vendor.test/view?file=contract&sig=initial-signature"></iframe></div>
      <iframe id="inline" src="data:text/html,<p class='traceway-mask'>inline private note</p>"></iframe>
      <iframe id="widget" src="https://widgets.vendor.test/chat"></iframe><p>before</p>`;
    // A frame of another origin, or with an opaque origin (data:), has no contentDocument for the page.
    for (const frame of document.querySelectorAll("iframe"))
      Object.defineProperty(frame, "contentDocument", { configurable: true, value: null });
    recorder = new SessionRecorder();
    await recorder.start();
    // rrweb 2.1.7 records such a frame's address as `rr_src`.
    expect(JSON.stringify(recorder.getClipEvents())).toContain('"rr_src":"https://widgets.vendor.test/chat"');
    document.querySelector("#viewer")!.setAttribute("src", "https://docs.vendor.test/view?file=contract&sig=changed-signature");
    document.querySelector("#inline")!.setAttribute("src", "data:text/html,<p class='traceway-mask'>inline changed note</p>");
    document.querySelector("#widget")!.setAttribute("src", "https://widgets.vendor.test/chat?open=1");
    document.querySelector("p")!.textContent = "change observed";
    await vi.waitFor(() => expect(JSON.stringify(recorder!.getClipEvents())).toContain("change observed"));
    const json = JSON.stringify(recorder.getClipEvents());
    expect(json).toContain('"rr_src":"https://widgets.vendor.test/chat?open=1"');
    for (const secret of ["initial-signature", "changed-signature", "docs.vendor.test", "inline private note", "inline changed note"])
      expect(json, secret).not.toContain(secret);
  });

  it("keeps the CSS a page writes into a <style> it already had inside traceway-mask, and takes inline pixels out of it anywhere", async () => {
    const photo = "data:image/jpeg;base64,cGhvdG9QaXhlbHM=";
    document.body.innerHTML = `<style id="theme">.avatar { color: blue; }</style>
      <div class="traceway-mask"><style id="scoped">.card { color: blue; }</style><b>Card owner</b></div><p>before</p>`;
    recorder = new SessionRecorder();
    await recorder.start();
    document.querySelector("#theme")!.textContent = `.avatar { color: red; background: url(${photo}); }`;
    document.querySelector("#scoped")!.textContent = `.card { color: green; background: url(${photo}); }`;
    document.querySelector("p")!.textContent = "change observed";
    await vi.waitFor(() => expect(JSON.stringify(recorder!.getClipEvents())).toContain("change observed"));
    const added = recorder.getClipEvents().flatMap((event) =>
      event.type === EventType.IncrementalSnapshot && event.data.source === IncrementalSource.Mutation
        ? event.data.adds.map((add) => add.node as unknown as Record<string, unknown>)
        : []);
    // What rrweb 2.1.7 writes for the new text: a bare text node, with nothing that says it is CSS.
    expect(added.filter((node) => node.type === 3 && "isStyle" in node)).toEqual([]);
    expect(added.map((node) => node.textContent)).toEqual(expect.arrayContaining([
      ".avatar { color: red; background: none; }",
      ".card { color: green; background: none; }",
    ]));
    const json = JSON.stringify(recorder.getClipEvents());
    expect(json).not.toContain("cGhvdG9QaXhlbHM=");
    expect(json).not.toContain("Card owner");
  });

  it("masks text that a shadow root inside traceway-mask renders or changes later (JS-13)", async () => {
    document.body.innerHTML = `<div class="traceway-mask"><span id="host"></span></div><p id="plain">Plain text</p>`;
    recorder = new SessionRecorder();
    await recorder.start({ maskAllInputs: false });
    const root = document.querySelector("#host")!.attachShadow({ mode: "open" });
    root.innerHTML = "<b>Shadow secret</b>Loose secret<i class='traceway-mask'></i>";
    await settle();
    root.querySelector("b")!.textContent = "Changed secret";
    root.querySelector("b")!.firstChild!.textContent = "Edited secret";
    await settle();
    // A mask inside a shadow root outside any mask.
    const open = document.querySelector("#plain")!.attachShadow({ mode: "open" });
    open.innerHTML = "<span class='traceway-mask'>Inner secret</span><span>Shown text</span>";
    await settle();
    open.querySelector(".traceway-mask")!.append("Appended secret");
    await settle();
    const json = JSON.stringify(recorder.getClipEvents());
    for (const secret of ["Shadow secret", "Loose secret", "Changed secret", "Edited secret", "Inner secret", "Appended secret"])
      expect(json, secret).not.toContain(secret);
    expect(json).toContain("Shown text");
    expect(json).toContain("****** ******");
  });

  it("masks text added later in a same-origin frame inside traceway-mask (JS-13)", async () => {
    document.body.innerHTML = `<div class="traceway-mask"><iframe id="frame"></iframe></div><iframe id="open"></iframe>`;
    recorder = new SessionRecorder();
    await recorder.start({ maskAllInputs: false });
    const frame = document.querySelector<HTMLIFrameElement>("#frame")!;
    const open = document.querySelector<HTMLIFrameElement>("#open")!;
    await vi.waitFor(() => expect(frame.contentDocument?.body && open.contentDocument?.body).toBeTruthy());
    await settle();
    frame.contentDocument!.body.innerHTML = "<p>Frame secret</p>";
    open.contentDocument!.body.innerHTML = "<p>Open frame text</p>";
    await settle();
    frame.contentDocument!.querySelector("p")!.textContent = "Frame changed secret";
    await settle();
    const json = JSON.stringify(recorder.getClipEvents());
    // The frame outside the mask shows rrweb records frames here at all.
    expect(json).toContain("Open frame text");
    expect(json).not.toContain("Frame secret");
    expect(json).not.toContain("Frame changed secret");
  });

  it("hides attribute values, pictures in styles and typed values inside traceway-mask (JS-16)", async () => {
    document.body.innerHTML = `
      <div class="traceway-mask">
        <span title="Alice Smith" aria-label="Alice's card" data-user="alice@example.test">x</span>
        <input type="submit" value="Pay Alice">
        <input placeholder="Alice's PIN">
        <div style="background-image: url(/avatars/42.jpg); color: red"></div>
        <input type="image" src="/avatars/43.jpg">
        <a href="/users/alice">profile</a>
        <input id="field">
      </div>
      <span title="Public title">shown</span>
      <input id="open">
    `;
    recorder = new SessionRecorder();
    await recorder.start({ maskAllInputs: false });
    const field = document.querySelector<HTMLInputElement>("#field")!;
    field.value = "123-45-6789";
    field.dispatchEvent(new Event("input", { bubbles: true }));
    const open = document.querySelector<HTMLInputElement>("#open")!;
    open.value = "typed in the open";
    open.dispatchEvent(new Event("input", { bubbles: true }));
    const span = document.querySelector(".traceway-mask span")!;
    span.setAttribute("title", "Bob Jones");
    (document.querySelector(".traceway-mask div") as HTMLElement).style.backgroundImage = "url(/avatars/44.jpg)";
    await settle();
    const json = JSON.stringify(recorder.getClipEvents());
    for (const secret of ["Alice", "alice", "42.jpg", "43.jpg", "44.jpg", "123-45-6789", "Bob Jones"])
      expect(json, secret).not.toContain(secret);
    // Outside the mask everything stays as it was, and inside it the layout does.
    expect(json).toContain("Public title");
    expect(json).toContain("typed in the open");
    expect(json).toContain("color: red");
    expect(json).toContain("*** ****");
  });
});
