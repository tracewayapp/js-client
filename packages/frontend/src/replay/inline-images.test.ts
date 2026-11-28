/** CONTRACT §14.5: `replay.images = "always"` on the web, the encoding rules of every platform that inlines. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { eventWithTime } from "@rrweb/types";
import { ImageInliner, MAX_SESSION_IMAGE_BYTES, ReplaySegmentImages } from "./inline-images.js";

interface Drawn {
  width: number;
  height: number;
  type: string;
  quality: number;
}

let drawn: Drawn[];
/** Characters of the data URL the fake canvas writes for a picture of this size. */
let urlLength: (width: number, height: number) => number;
let alphaPixels: boolean;
let toDataURL: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  drawn = [];
  urlLength = (w, h) => Math.round((w * h) / 10);
  alphaPixels = false;
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (
    this: HTMLCanvasElement,
  ) {
    const canvas = this;
    return {
      drawImage: vi.fn(),
      getImageData: () => ({
        data: new Uint8ClampedArray(canvas.width * canvas.height * 4).fill(alphaPixels ? 128 : 255),
      }),
    } as any;
  });
  toDataURL = vi
    .spyOn(HTMLCanvasElement.prototype, "toDataURL")
    .mockImplementation(function (this: HTMLCanvasElement, type?: string, quality?: unknown) {
      drawn.push({ width: this.width, height: this.height, type: type!, quality: quality as number });
      const prefix = `data:${type};base64,`;
      return prefix + "A".repeat(Math.max(0, urlLength(this.width, this.height) - prefix.length));
    });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

let nextId = 10;

/** A loaded `<img>` of the page and the node rrweb wrote for it. */
function picture(
  natural: [number, number],
  shown: [number, number] = natural,
  src = `https://app.test/${nextId}.jpg`,
) {
  const img = document.createElement("img");
  img.setAttribute("src", src);
  document.body.append(img);
  for (const [key, value] of Object.entries({
    complete: true,
    naturalWidth: natural[0],
    naturalHeight: natural[1],
    width: shown[0],
    height: shown[1],
  }))
    Object.defineProperty(img, key, { configurable: true, value });
  const node = {
    type: 2,
    id: nextId++,
    tagName: "img",
    attributes: { src } as Record<string, unknown>,
    childNodes: [],
  };
  return { img, node };
}

/** A generous time budget by default, so a slow test machine encodes everything. */
function setup(pictures: Array<ReturnType<typeof picture>>, budgetMs = 10_000) {
  const byId = new Map<number, Node>(pictures.map((p) => [p.node.id, p.img]));
  return new ImageInliner((id) => byId.get(id) ?? null, budgetMs);
}

function snapshot(pictures: Array<ReturnType<typeof picture>>): eventWithTime {
  return {
    type: 2,
    timestamp: Date.now(),
    data: {
      node: { type: 0, id: 1, childNodes: [{ type: 2, id: 2, tagName: "body", attributes: {}, childNodes: pictures.map((p) => p.node) }] },
      initialOffset: { top: 0, left: 0 },
    },
  } as unknown as eventWithTime;
}

describe("ImageInliner", () => {
  it("draws a picture at its displayed size, at most 384 px on the longest side, as JPEG 0.45", () => {
    const shownSmall = picture([800, 600], [200, 150]);
    const huge = picture([4000, 3000], [1000, 750]);
    const tiny = picture([1200, 900], [0, 0]);
    setup([shownSmall, huge, tiny]).inline(snapshot([shownSmall, huge, tiny]));
    expect(drawn).toEqual([
      { width: 200, height: 150, type: "image/jpeg", quality: 0.45 },
      { width: 384, height: 288, type: "image/jpeg", quality: 0.45 },
    ]);
    expect(shownSmall.node.attributes.rr_dataURL).toMatch(/^data:image\/jpeg;base64,/);
    expect(huge.node.attributes.rr_dataURL).toMatch(/^data:image\/jpeg;base64,/);
    // Not shown: nothing to draw.
    expect(tiny.node.attributes.rr_dataURL).toBeUndefined();
  });

  it("never makes a picture with transparency JPEG: it is PNG at most 192 px, at any size (JS2-6)", () => {
    // JPEG has no alpha: a transparent logo would replay as a black box.
    alphaPixels = true;
    const icon = picture([96, 64]);
    const logo = picture([200, 80]);
    const banner = picture([1200, 300], [600, 150]);
    setup([icon, logo, banner]).inline(snapshot([icon, logo, banner]));
    expect(drawn).toEqual([
      { width: 96, height: 64, type: "image/png", quality: 0.45 },
      { width: 192, height: 77, type: "image/png", quality: 0.45 },
      { width: 192, height: 48, type: "image/png", quality: 0.45 },
    ]);
    for (const p of [icon, logo, banner]) expect(p.node.attributes.rr_dataURL).toMatch(/^data:image\/png;base64,/);
    alphaPixels = false;
    const opaque = picture([32, 32]);
    const photo = picture([300, 200]);
    setup([opaque, photo]).inline(snapshot([opaque, photo]));
    expect(drawn.slice(3).map((d) => [d.type, d.width])).toEqual([
      ["image/jpeg", 32],
      ["image/jpeg", 300],
    ]);
  });

  it("tries a transparent picture that is too large once more at half the PNG size", () => {
    alphaPixels = true;
    urlLength = (w) => (w > 96 ? 70_000 : 60_000);
    const logo = picture([384, 384]);
    setup([logo]).inline(snapshot([logo]));
    expect(drawn.map((d) => [d.type, d.width])).toEqual([
      ["image/png", 192],
      ["image/png", 96],
    ]);
    expect(logo.node.attributes.rr_dataURL).toHaveLength(60_000);
  });

  it("tries once at half the size above 48 KiB, then drops the picture and does not try it again", () => {
    // 4/3 characters per byte: 48 KiB of data is 65,536 characters.
    urlLength = (w) => (w > 200 ? 70_000 : 60_000);
    const fitsAtHalf = picture([384, 384]);
    const inliner = setup([fitsAtHalf]);
    inliner.inline(snapshot([fitsAtHalf]));
    expect(drawn.map((d) => d.width)).toEqual([384, 192]);
    expect(fitsAtHalf.node.attributes.rr_dataURL).toHaveLength(60_000);

    urlLength = () => 70_000;
    const tooLarge = picture([384, 384]);
    const again = setup([tooLarge]);
    again.inline(snapshot([tooLarge]));
    again.inline(snapshot([tooLarge]));
    expect(drawn.map((d) => d.width)).toEqual([384, 192, 384, 192]);
    expect(tooLarge.node.attributes.rr_dataURL).toBeUndefined();
  });

  it("leaves the page's own image alone and keeps the URL of a picture it may not read", () => {
    toDataURL.mockImplementation(() => {
      throw new DOMException("tainted", "SecurityError");
    });
    const foreign = picture([300, 200], [300, 200], "https://cdn.other.test/a.jpg");
    const inliner = setup([foreign]);
    inliner.inline(snapshot([foreign]));
    inliner.inline(snapshot([foreign]));
    expect(toDataURL).toHaveBeenCalledTimes(1);
    expect(foreign.node.attributes.rr_dataURL).toBeUndefined();
    expect(foreign.img.hasAttribute("crossorigin")).toBe(false);
    expect(foreign.img.crossOrigin).toBeNull();
    expect(foreign.img.getAttribute("src")).toBe("https://cdn.other.test/a.jpg");
  });

  it("skips images rrweb blanked or masked (no src), not loaded yet, or that are not images", () => {
    const masked = picture([100, 100]);
    delete masked.node.attributes.src;
    masked.node.attributes.rr_width = "100px";
    const loading = picture([100, 100]);
    Object.defineProperty(loading.img, "complete", { value: false });
    const broken = picture([0, 0]);
    const notAnImage = picture([100, 100]);
    const inliner = new ImageInliner((id) =>
      id === notAnImage.node.id ? document.createElement("div") : [masked, loading, broken].find((p) => p.node.id === id)?.img ?? null,
    );
    inliner.inline(snapshot([masked, loading, broken, notAnImage]));
    expect(drawn).toEqual([]);
    for (const p of [masked, loading, broken, notAnImage]) expect(p.node.attributes.rr_dataURL).toBeUndefined();
  });

  it("reuses what it encoded at the next snapshot, and evicts the oldest of 128 pictures, not all of them", () => {
    const pictures = Array.from({ length: 129 }, () => picture([50, 50]));
    const inliner = setup(pictures);
    inliner.inline(snapshot([pictures[0]!]));
    inliner.inline(snapshot([pictures[0]!]));
    expect(drawn).toHaveLength(1);
    expect(pictures[0]!.node.attributes.rr_dataURL).toBeDefined();
    inliner.inline(snapshot(pictures.slice(1)));
    expect(drawn).toHaveLength(129);
    // The first one was used longest ago and made room for the 129th.
    inliner.inline(snapshot([pictures[128]!, pictures[0]!]));
    expect(drawn).toHaveLength(130);
  });

  it("strips inline pixels from CSS mutations, stylesheet replacements and adopted stylesheets", () => {
    const css = '.preview { color: red; background: url("data:image/png;base64,cHJldmlldw=="); }';
    const inliner = new ImageInliner(() => null);
    // The shape @rrweb/record 2.1.7 writes: a text node carries no marker of its parent.
    inliner.inline({type: 2, timestamp: 0, data: {node: {
      id: 2, type: 2, tagName: "style", attributes: {}, childNodes: [{ id: 3, type: 3, textContent: "p { color: red; }" }],
    }}} as unknown as eventWithTime, false);
    const changes = [
      {source: 0, attributes:[{id:2, attributes: {style:{background:[css,"important"]},_cssText:css}}], texts:[{id:3,value:css}]},
      {source: 8, adds:[{rule:css}], replace:css, replaceSync:css},
      {source: 13, set:{property:"background",value:css}},
      {source: 15, styles:[{rules:[{rule:css}]}]},
    ];
    for (const data of changes) {
      inliner.inline({type:3, timestamp:0, data} as unknown as eventWithTime, false);
      expect(JSON.stringify(data)).toContain("color: red");
      expect(JSON.stringify(data)).not.toContain("cHJldmlldw==");
    }
  });

  it("strips inline pixels from CSS text a mutation adds to a <style> the page already had", () => {
    const css = '.avatar { color: red; background: url("data:image/jpeg;base64,cGhvdG8="); }';
    document.body.innerHTML = "<style></style><svg><style></style></svg><code></code>";
    const [html, svg] = document.querySelectorAll("style");
    const nodes = new Map<number, Node>([[4, html!], [5, svg!], [6, document.querySelector("code")!]]);
    const inliner = new ImageInliner((id) => nodes.get(id) ?? null);
    // A <style> serialized earlier and since detached: only its id is left to tell what the text is.
    inliner.inline({type: 2, timestamp: 0, data: {node: {
      id: 7, type: 2, tagName: "style", attributes: {}, childNodes: [],
    }}} as unknown as eventWithTime, false);
    // @rrweb/record 2.1.7, serializeTextNode: { type: 3, textContent, rootId } and the id; one add per node.
    const adds = [4, 5, 6, 7].map((parentId, i) => ({
      parentId, nextId: null, node: { type: 3, textContent: css, id: 20 + i },
    }));
    inliner.inline({type: 3, timestamp: 0, data: {source: 0, adds, removes: [], texts: [], attributes: []}} as unknown as eventWithTime, false);
    expect(adds.map((add) => add.node.textContent)).toEqual([
      ".avatar { color: red; background: none; }",
      ".avatar { color: red; background: none; }",
      css,
      ".avatar { color: red; background: none; }",
    ]);
  });

  it("preserves a literal data URL in public text and strips it from a live style text change", () => {
    const cssText = document.createTextNode("");
    document.createElement("style").append(cssText);
    const publicText = document.createTextNode("");
    document.createElement("code").append(publicText);
    const inliner = new ImageInliner(id => id === 2 ? cssText : publicText);
    const value = 'background: url("data:image/png;base64,cGl4ZWxz")';
    const changes = [{id: 2, value}, {id: 3, value}];
    inliner.inline({type: 3, timestamp: 0, data: {source: 0, texts: changes}} as unknown as eventWithTime, false);
    expect(changes[0]!.value).toBe("background: none");
    expect(changes[1]!.value).toBe(value);
  });

  it("encodes each loaded resource even when a URL and size are reused", () => {
    const first = picture([50,50], [50,50], "/avatar");
    const second = picture([50,50], [50,50], "/avatar");
    const inliner = setup([first,second]);
    toDataURL.mockReturnValueOnce("data:image/png,first").mockReturnValueOnce("data:image/png,second").mockReturnValueOnce("data:image/png,reloaded");
    inliner.inline(snapshot([first,second]));
    expect(second.node.attributes.rr_dataURL).toBe("data:image/png,second");
    first.img.dispatchEvent(new Event("load"));
    inliner.inline(snapshot([first]));
    expect(first.node.attributes.rr_dataURL).toBe("data:image/png,reloaded");
    inliner.clearCache();
    toDataURL.mockReturnValueOnce("data:image/png,new-session");
    inliner.inline(snapshot([first]));
    expect(first.node.attributes.rr_dataURL).toBe("data:image/png,new-session");
  });

  it("keeps previously exposed bytes charged when a later update drops the segment's copies", () => {
    const segment = new ReplaySegmentImages();
    const image: Record<string, unknown> = {src: "/avatar"};
    const encoded = "data:image/jpeg;base64,".padEnd(64 * 1024, "A");
    expect(segment.add(image, encoded)).toBe(encoded.length);
    segment.expose();
    expect(segment.add(image, encoded)).toBe(encoded.length);
    expect(segment.add(image, encoded)).toBe(-encoded.length);
    expect(image).toEqual({src: "/avatar"});
    const changed: Record<string, unknown> = { src: "/new-avatar" };
    expect(segment.add(changed, encoded)).toBe(0);
    expect(changed).toEqual({ src: "/new-avatar" });
  });

  it.each([
    [131_072, true],
    [131_073, false],
  ])("a segment with %i characters of copies keeps them: %s; over the allowance only the copies go", (total, kept) => {
    const lengths: Record<number, number> = { 10: 65_536, 20: 65_436, 30: total - 130_972 };
    urlLength = (w) => lengths[w]!;
    const pictures = [picture([10, 10]), picture([20, 20]), picture([30, 30])];
    pictures[0]!.node.attributes.srcset = "https://app.test/a.jpg 1x, https://app.test/a@2x.jpg 2x";
    // Pictures the page may not read, or that are no <img>: they never had a copy.
    toDataURL.mockImplementationOnce(() => {
      throw new DOMException("tainted", "SecurityError");
    });
    const foreign = picture([40, 40], [40, 40], "https://cdn.other.test/photo.jpg");
    foreign.node.attributes.srcset = "https://cdn.other.test/photo@2x.jpg 2x";
    const others = [
      { type: 2, id: 900, tagName: "source", attributes: { srcset: "https://cdn.other.test/art.webp" }, childNodes: [] },
      { type: 2, id: 901, tagName: "video", attributes: { poster: "https://cdn.other.test/poster.jpg", src: "https://cdn.other.test/clip.mp4" }, childNodes: [] },
      { type: 2, id: 902, tagName: "image", attributes: { href: "https://cdn.other.test/map.png" }, childNodes: [] },
      { type: 2, id: 903, tagName: "input", attributes: { type: "image", src: "https://cdn.other.test/go.png" }, childNodes: [] },
    ];
    const urls = (nodes: Array<{ attributes: Record<string, unknown> }>) =>
      nodes.map(({ attributes: { rr_dataURL, ...rest } }) => rest);
    const all = [foreign, ...pictures];
    const event = snapshot(all);
    ((event.data as any).node.childNodes[0].childNodes as unknown[]).push(...others);
    const before = structuredClone(urls([...all.map((p) => p.node), ...others]));
    const segment = new ReplaySegmentImages();
    const inliner = setup(all);
    inliner.inline(event, true, segment);
    expect(pictures.map((p) => typeof p.node.attributes.rr_dataURL)).toEqual(Array(3).fill(kept ? "string" : "undefined"));
    expect(foreign.node.attributes.rr_dataURL).toBeUndefined();
    expect(inliner.bytes).toBe(kept ? 131_072 : 0);
    expect(urls([...all.map((p) => p.node), ...others])).toEqual(before);

    // A picture that arrives later in the same segment keeps its URL and gets no copy.
    const late = picture([10, 10]);
    const mutation = { source: 0, adds: [{ parentId: 2, nextId: null, node: late.node }], removes: [], texts: [],
      attributes: [{ id: pictures[1]!.node.id, attributes: { src: "https://app.test/changed.jpg" } as Record<string, unknown> }] };
    const withLate = setup([...all, late]);
    withLate.bytes = inliner.bytes;
    withLate.inline({ type: 3, timestamp: 0, data: mutation } as unknown as eventWithTime, true, segment);
    expect(late.node.attributes.src).toBe(`https://app.test/${late.node.id}.jpg`);
    expect(late.node.attributes.rr_dataURL).toBeUndefined();
    expect(mutation.attributes[0]!.attributes.src).toBe("https://app.test/changed.jpg");

    // The next segment starts with its own allowance.
    const next = new ReplaySegmentImages();
    const again = picture([10, 10]);
    setup([again]).inline(snapshot([again]), true, next);
    expect(again.node.attributes.rr_dataURL).toHaveLength(65_536);
  });

  it("keeps svg data URLs of at most 4,096 characters, in CSS and in markup; any other inline picture goes", () => {
    const svg = (id: string, length: number) => `data:image/svg+xml,%3Csvg%20id=${id}`.padEnd(length - 6, "a") + "%3E%3C";
    const icon = svg("icon", 4096);
    const large = svg("large", 4097);
    const tiny = svg("tiny", 120);
    const png = "data:image/png;base64,cmFzdGVy";
    expect([icon.length, large.length]).toEqual([4096, 4097]);
    const css = `.tick { background: url("${icon}") } .big { background: url('${large}') } .x { color: red; background: url(${png}) } ` +
      `.set { background: image-set("${icon}" 1x, "${png}" 2x) } .bare { --close: url( ${icon} ) }`;
    const kept = `.tick { background: url("${icon}") } .big { background: none } .x { color: red; background: none } ` +
      `.set { background: image-set("${icon}" 1x, "" 2x) } .bare { --close: url( ${icon} ) }`;
    const event = {
      type: 2,
      timestamp: 0,
      data: { node: { type: 0, id: 1, childNodes: [
        { type: 2, id: 2, tagName: "style", attributes: { _cssText: css }, childNodes: [{ type: 3, id: 3, textContent: "" }] },
        { type: 2, id: 4, tagName: "div", attributes: { style: `background-image: url("${icon}")`, "data-icon": icon, "data-photo": png }, childNodes: [] },
        { type: 2, id: 5, tagName: "img", attributes: { src: icon, srcset: `${tiny} 1x, ${png} 2x` }, childNodes: [] },
        { type: 2, id: 6, tagName: "img", attributes: { src: large, alt: "large" }, childNodes: [] },
        { type: 2, id: 7, tagName: "img", attributes: { src: " DATA:IMAGE/SVG+XML;base64,PHN2Zz4=", srcset: `${tiny} 2x` }, childNodes: [] },
        { type: 2, id: 8, tagName: "img", attributes: { src: "data:image/svg+xmlish;base64,cmFzdGVy" }, childNodes: [] },
      ] } },
    };
    const inliner = new ImageInliner(() => null);
    inliner.sanitize(event as unknown as eventWithTime);
    const [style, div, small, big, base64, other] = event.data.node.childNodes.map((node) => node.attributes as Record<string, unknown>);
    expect(style!._cssText).toBe(kept);
    expect(div).toEqual({ style: `background-image: url("${icon}")`, "data-icon": icon });
    expect(small).toEqual({ src: icon });
    expect(big).toEqual({ alt: "large" });
    expect(base64).toEqual({ src: " DATA:IMAGE/SVG+XML;base64,PHN2Zz4=", srcset: `${tiny} 2x` });
    expect(other).toEqual({});

    // The policy that inlines copies treats them the same.
    const always = { type: 2, timestamp: 0, data: { node: { type: 2, id: 2, tagName: "style", attributes: { _cssText: css }, childNodes: [] } } };
    inliner.inline(always as unknown as eventWithTime, true, new ReplaySegmentImages());
    expect(always.data.node.attributes._cssText).toBe(kept);

    const rules = { source: 8, adds: [{ rule: `.a { background: url("${icon}") }` }, { rule: `.b { background: url("${large}") }` }] };
    inliner.sanitize({ type: 3, timestamp: 0, data: rules } as unknown as eventWithTime);
    expect(rules.adds.map((add) => add.rule)).toEqual([`.a { background: url("${icon}") }`, ".b { background: none }"]);
    const attributes = { source: 0, attributes: [{ id: 4, attributes: { style: { "background-image": `url("${icon}")`, mask: [`url(${png})`, "important"] }, "data-icon": icon, "data-photo": png } }] };
    inliner.sanitize({ type: 3, timestamp: 0, data: attributes } as unknown as eventWithTime);
    expect(attributes.attributes[0]!.attributes).toEqual({ style: { "background-image": `url("${icon}")`, mask: ["none", "important"] }, "data-icon": icon, "data-photo": null });
  });

  it("keeps the box of an <img> whose data: source it removes, under every policy, until the image shows a picture again", () => {
    const png = "data:image/png;base64,cmFzdGVy";
    const logo = picture([200, 100], [100, 50], png);
    logo.node.attributes.style = "border: 0";
    const lazy = picture([300, 200], [150, 100], "https://app.test/first.jpg");
    const pending = picture([300, 200], [150, 100], png);
    Object.defineProperty(pending.img, "complete", { configurable: true, value: false });
    const withSet = picture([300, 200], [150, 100], png);
    withSet.node.attributes.srcset = "https://app.test/set.jpg 2x";
    const all = [logo, lazy, pending, withSet];
    const segment = new ReplaySegmentImages((id) => all.find((p) => p.node.id === id)?.img ?? null);
    const inliner = setup(all);
    inliner.sanitize(snapshot(all), undefined, segment);
    expect(logo.node.attributes).toEqual({
      rr_width: "100px", rr_height: "50px", style: expect.stringMatching(/^border: 0;(display:inline-block;)?width:100px;height:50px$/),
    });
    expect(lazy.node.attributes).toEqual({ src: "https://app.test/first.jpg" });
    expect(withSet.node.attributes).toEqual({ srcset: "https://app.test/set.jpg 2x" });
    // Not decoded yet: sized when the clip is read.
    expect(pending.node.attributes).toEqual({});
    Object.defineProperty(pending.img, "complete", { configurable: true, value: true });
    segment.completeLayout();
    expect(pending.node.attributes.rr_width).toBe("150px");

    const change = (id: number, attributes: Record<string, unknown>) => {
      const data = { source: 0, adds: [], removes: [], texts: [], attributes: [{ id, attributes }] };
      inliner.sanitize({ type: 3, timestamp: 0, data } as unknown as eventWithTime, undefined, segment);
      return attributes;
    };
    expect(change(lazy.node.id, { src: png })).toEqual({
      src: null, rr_dataURL: null, rr_width: "150px", rr_height: "100px",
      style: expect.objectContaining({ width: "150px", height: "100px" }),
    });
    // The picture arrives: the size comes from the page again, with the page's own inline style.
    lazy.img.setAttribute("style", "opacity: 1");
    expect(change(lazy.node.id, { src: "https://app.test/second.jpg" })).toEqual({
      src: "https://app.test/second.jpg", rr_dataURL: null, rr_width: null, rr_height: null, style: "opacity: 1",
    });
    expect(change(logo.node.id, { srcset: "https://app.test/logo.png 2x" })).toEqual({
      srcset: "https://app.test/logo.png 2x", rr_dataURL: null, rr_width: null, rr_height: null, style: null,
    });
    // Never boxed: a source change is passed on as it is.
    expect(change(withSet.node.id, { src: "https://app.test/other.jpg" })).toEqual({
      src: "https://app.test/other.jpg", rr_dataURL: null,
    });
  });

  it("stops adding pictures at 4 MiB a session; the images keep their URLs", () => {
    urlLength = () => 60_000;
    const pictures = Array.from({ length: 80 }, () => picture([300, 300]));
    const inliner = setup(pictures);
    inliner.inline(snapshot(pictures));
    const added = pictures.filter((p) => p.node.attributes.rr_dataURL !== undefined);
    expect(added.length).toBe(Math.floor(MAX_SESSION_IMAGE_BYTES / 60_000));
    expect(inliner.bytes).toBeLessThanOrEqual(MAX_SESSION_IMAGE_BYTES);
    expect(pictures.every((p) => typeof p.node.attributes.src === "string")).toBe(true);
  });

  it("encodes no more than its time budget allows per event; the rest wait for the next snapshot", () => {
    const pictures = [picture([50, 50]), picture([50, 50])];
    const inliner = setup(pictures, -1);
    inliner.inline(snapshot(pictures));
    expect(drawn).toEqual([]);
  });

  it("adds pictures to the nodes a mutation adds", () => {
    const added = picture([120, 80]);
    setup([added]).inline({
      type: 3,
      timestamp: Date.now(),
      data: { source: 0, adds: [{ parentId: 2, nextId: null, node: { type: 2, id: 99, tagName: "div", attributes: {}, childNodes: [added.node] } }], removes: [], texts: [], attributes: [] },
    } as unknown as eventWithTime);
    expect(added.node.attributes.rr_dataURL).toMatch(/^data:image\/jpeg/);
  });
});
