/** CONTRACT §14.5: `replay.images = "always"` on the web, the encoding rules of every platform that inlines. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { eventWithTime } from "@rrweb/types";
import { ImageInliner, MAX_SESSION_IMAGE_BYTES } from "./inline-images.js";

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
