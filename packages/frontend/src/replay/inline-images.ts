import type { eventWithTime } from "@rrweb/types";

/** The longest side of an inlined picture, in pixels: it is drawn at its displayed size, never larger. */
const MAX_SIDE = 384;
/** A picture with transparency is PNG at most this size: JPEG has no alpha and would replay it on black. */
const MAX_PNG_SIDE = 192;
const MAX_IMAGE_BYTES = 48 * 1024;
/** Encoded pictures kept for the next snapshots; the one used longest ago makes room for a new one. */
const MAX_IMAGES = 128;
export const MAX_SESSION_IMAGE_BYTES = 4 * 1024 * 1024;

interface SerializedNode {
  type: number;
  id: number;
  tagName?: string;
  attributes?: Record<string, unknown>;
  childNodes?: SerializedNode[];
  textContent?: string;
}

/** Base64 data URLs are ASCII. Count the bytes the player receives, including repeated thumbnails. */
const MAX_SEGMENT_IMAGE_BYTES = 128 * 1024;
/** A vector icon (a checkbox tick, a close button, a select arrow) is no picture of the page's content. */
const MAX_SVG_ICON_LENGTH = 4096;

interface BoxedImage {
  attrs: Record<string, unknown>;
  mutation: boolean;
  id: number;
  box?: { width: number; height: number; inline: boolean };
}

function imageBox(node: Node | null): BoxedImage["box"] {
  if (node?.nodeName !== "IMG") return;
  const image = node as HTMLImageElement;
  // Before decoding, a source-less image can report the size of its alt text.
  if (!image.complete || !image.naturalWidth || !image.width || !image.height) return;
  const inline = image.ownerDocument.defaultView?.getComputedStyle(image).display === "inline";
  return { width: image.width, height: image.height, inline };
}

/** References are to the serialized recording only, never to the live DOM. */
export class ReplaySegmentImages {
  /** Past the allowance the segment carries no copies: its pictures are URL references, as under `"wifi"`. */
  overflowed = false;
  private bytes = 0;
  private exposedBytes = 0;
  private copies: Record<string, unknown>[] = [];
  private pendingLayout: BoxedImage[] = [];
  private readonly boxed = new Set<number>();

  constructor(private readonly element: (id: number) => Node | null = () => null) {}

  // A lazy source can finish decoding without generating an rrweb mutation.
  // Revisit its mirror ID when the clip is read, without retaining DOM nodes.
  completeLayout(): void {
    this.pendingLayout = this.pendingLayout.filter(image => !this.size(image));
  }

  // A partial segment may already have been uploaded by an earlier error.
  expose(): void {
    this.exposedBytes = this.bytes;
  }

  /** Returns the adjustment to the session budget. Refund images removed before any partial export. */
  add(attrs: Record<string, unknown>, url: string): number {
    if (this.overflowed) return 0;
    if (this.bytes + url.length <= MAX_SEGMENT_IMAGE_BYTES) {
      this.bytes += url.length;
      attrs.rr_dataURL = url;
      this.copies.push(attrs);
      return url.length;
    }
    this.overflowed = true;
    for (const copy of this.copies) delete copy.rr_dataURL;
    this.copies = [];
    return this.exposedBytes - this.bytes;
  }

  /** An `<img>` whose inline source was removed keeps the size it has on the page. */
  box(attrs: Record<string, unknown>, id: number, live: Node | null, mutation: boolean): void {
    const image: BoxedImage = { attrs, mutation, id, box: imageBox(live) };
    this.boxed.add(id);
    if (!this.size(image)) this.pendingLayout.push(image);
  }

  /** Whether the image was given a size that its new source must not keep. */
  unbox(id: number): boolean {
    return this.boxed.delete(id);
  }

  private size({ attrs, id, box, mutation }: BoxedImage): boolean {
    const known = box ?? imageBox(this.element(id));
    if (!known) return false;
    const width = known.width + "px";
    const height = known.height + "px";
    attrs.rr_width = width;
    attrs.rr_height = height;
    // With no source, an inline img can shrink to its alt text. A mutation's
    // style map updates individual CSS properties, preserving the others.
    const display = known.inline ? { display: "inline-block" } : {};
    if (mutation && typeof attrs.style !== "string") {
      attrs.style = { ...(attrs.style as Record<string, unknown> | undefined), ...display, width, height };
    } else {
      const style = typeof attrs.style === "string" ? attrs.style : "";
      attrs.style = style + ";" + (known.inline ? "display:inline-block;" : "") + `width:${width};height:${height}`;
    }
    return true;
  }
}

// CSS can contain data URLs inside url() or quoted image-set() candidates.
// Keep unrelated declarations and drop a malformed CSS value if it still contains inline pixels.
const DATA_IMAGE = /data\s*:\s*image\//i;
const CSS_URL_OR_STRING = /url\((?:[^()"'\\]|\\.|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')*\)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/gis;

/** One URL (a second one after a comma or a space is a `srcset` candidate) of an SVG document. */
const svgIcon = (url: string): boolean =>
  url.length <= MAX_SVG_ICON_LENGTH && /^data:image\/svg\+xml[;,]/i.test(url) && !/[\s,]data:/i.test(url);

function stripCssImages(css: string): string {
  if (!DATA_IMAGE.test(css)) return css;
  const safe = css.replace(CSS_URL_OR_STRING, (part) =>
    !DATA_IMAGE.test(part) || svgIcon(part.replace(/^(?:url\()?\s*["']?|["']?\s*\)?$/gi, ""))
      ? part
      : part[0] === '"' || part[0] === "'" ? '""' : "none",
  );
  return DATA_IMAGE.test(css.replace(CSS_URL_OR_STRING, " ")) ? "" : safe;
}

function stripStyleAttribute(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const properties = value as Record<string, unknown>;
  for (const [property, declaration] of Object.entries(properties)) {
    if (typeof declaration === "string") properties[property] = stripCssImages(declaration);
    else if (Array.isArray(declaration) && typeof declaration[0] === "string")
      declaration[0] = stripCssImages(declaration[0]);
  }
}

const isStyle = (node: Node | null | undefined): boolean => /^style$/i.test(node?.nodeName ?? "");

/**
 * `replay.images = "always"`: puts a small copy of each `<img>` of the page into the recording, as rrweb's
 * `rr_dataURL`, which the replay shows instead of loading the URL. It runs on the nodes rrweb has just serialized, so
 * the page's own images are never touched: no `crossOrigin` is set on them, as rrweb's `inlineImages` does, and a
 * picture from another origin that the browser does not let a page read stays a URL reference. A masked or blanked
 * image is serialized without its `src` and is skipped. At most `budgetMs` of encoding per recorder event; an image
 * left over is encoded at the next snapshot.
 */
export class ImageInliner {
  /** What this session's recording carries of pictures; past 4 MiB, images stay URL references. */
  bytes = 0;
  private readonly resources = new WeakMap<HTMLImageElement, object>();
  private readonly encoded = new Map<object, { key: string; url: string }>();
  private canvas: HTMLCanvasElement | null = null;
  /** The `<style>` elements of the recording and their text nodes: rrweb does not mark the text as CSS. */
  private readonly styleIds = new Set<number>();

  constructor(
    private readonly element: (id: number) => Node | null,
    private readonly budgetMs = 16,
  ) {}

  // A new resource load invalidates the identity even if the same element still has the same URL.
  // The cache keeps this identity, never the DOM element or its document.
  private resource(img: HTMLImageElement): object {
    const resources = this.resources;
    let id = resources.get(img);
    if (!id) {
      id = {};
      resources.set(img, id);
      img.addEventListener("load", () => resources.delete(img), { once: true });
    }
    return id;
  }

  clearCache(): void {
    this.encoded.clear();
    this.styleIds.clear();
    this.canvas = null;
  }

  /** Remove page-supplied inline pictures before storing the event. Only bounded SDK encodings can accompany it. */
  inline(event: eventWithTime, capture = true, segment?: ReplaySegmentImages): void {
    const until = performance.now() + this.budgetMs;
    this.sanitize(event, capture ? (node, src) => this.image(node, src, until, segment) : undefined, segment);
  }

  sanitize(
    event: eventWithTime,
    captureImage?: (node: SerializedNode, src: string) => void,
    segment?: ReplaySegmentImages,
  ): void {
    const visit = (node: SerializedNode | undefined, css: boolean) => {
      if (!node) return;
      const attrs = node.attributes;
      if (attrs) {
        const src = attrs.src;
        const image = node.tagName === "img";
        const sourced = image && ("src" in attrs || "srcset" in attrs);
        this.stripInline(attrs, node.tagName, false);
        if (sourced && !("src" in attrs || "srcset" in attrs))
          segment?.box(attrs, node.id, this.element(node.id), false);
        if (!segment?.overflowed && image && typeof src === "string") captureImage?.(node, src);
      }
      if (node.tagName === "style") this.styleIds.add(node.id);
      else if (css && typeof node.textContent === "string") {
        this.styleIds.add(node.id);
        node.textContent = stripCssImages(node.textContent);
      }
      node.childNodes?.forEach((child) => visit(child, node.tagName === "style"));
    };
    const data = event.data as any;
    if (event.type === 2) {
      this.styleIds.clear();
      visit(data?.node, false);
    } else if (event.type === 3 && data?.source === 0) {
      for (const removed of data.removes ?? []) this.styleIds.delete(removed.id);
      // rrweb adds one node at a time: the parent is in the page, or was recorded before.
      data.adds?.forEach((add: { parentId: number; node: SerializedNode }) =>
        visit(add.node, this.styleIds.has(add.parentId) || isStyle(this.element(add.parentId))));
      for (const text of data.texts ?? []) {
        if (typeof text.value !== "string" || !DATA_IMAGE.test(text.value)) continue;
        const parent = this.element(text.id)?.parentNode;
        if (parent ? isStyle(parent) : this.styleIds.has(text.id))
          text.value = stripCssImages(text.value);
      }
      for (const change of data.attributes ?? []) {
        const attrs = change.attributes;
        const live = this.element(change.id);
        const tag = live?.nodeName.toLowerCase();
        const sourced = tag === "img" && (typeof attrs.src === "string" || typeof attrs.srcset === "string");
        this.stripInline(attrs, tag, true);
        if (tag === "img" && ("src" in attrs || "srcset" in attrs)) attrs.rr_dataURL = null;
        if (!sourced) continue;
        if (typeof attrs.src !== "string" && typeof attrs.srcset !== "string") segment?.box(attrs, change.id, live, true);
        else if (segment?.unbox(change.id)) {
          // The size comes from the page again, with the inline style it has now.
          attrs.rr_width = attrs.rr_height = null;
          const style = (live as Element).getAttribute("style");
          attrs.style = style === null ? null : stripCssImages(style);
        }
      }
    } else if (event.type === 3 && data?.source === 8) {
      for (const added of data.adds ?? []) added.rule = stripCssImages(added.rule);
      for (const key of ["replace", "replaceSync"]) {
        if (typeof data[key] === "string") data[key] = stripCssImages(data[key]);
      }
    } else if (event.type === 3 && data?.source === 13 && typeof data.set?.value === "string") {
      data.set.value = stripCssImages(data.set.value);
    } else if (event.type === 3 && data?.source === 15) {
      for (const style of data.styles ?? []) {
        for (const added of style.rules) added.rule = stripCssImages(added.rule);
      }
    }
  }

  private stripInline(attrs: Record<string, unknown>, tag: string | undefined, mutation: boolean): void {
    if (typeof attrs.style === "string") attrs.style = stripCssImages(attrs.style);
    else stripStyleAttribute(attrs.style);
    if (typeof attrs._cssText === "string") attrs._cssText = stripCssImages(attrs._cssText);
    for (const [name, value] of Object.entries(attrs)) {
      if (typeof value !== "string" || name === "style" || name === "_cssText") continue;
      // Lazy-loading libraries commonly copy sources into application-defined data attributes.
      const imageSource = /^(src|srcset|poster|background)$/.test(name) ||
        ((name === "href" || name === "xlink:href") && (!tag || tag === "image"));
      if (
        // rrweb records a same-origin iframe's child DOM independently. Its raw source would bypass all child
        // masking; a frame it cannot read has its address in `rr_src`, a whole document when that is a data: URL.
        name === "srcdoc" ||
        name === "rr_dataURL" ||
        ((DATA_IMAGE.test(value) || ((imageSource || name === "rr_src") && /(?:^|[\s,])data:/i.test(value))) &&
          !svgIcon(value.trim()))
      ) {
        if (mutation) attrs[name] = null;
        else delete attrs[name];
      }
    }
  }

  private image(node: SerializedNode, src: string, until: number, segment?: ReplaySegmentImages): void {
    const attributes = node.attributes!;
    const img = this.element(node.id) as HTMLImageElement | null;
    if (
      img?.tagName !== "IMG" ||
      !img.complete ||
      !img.naturalWidth
    )
      return;
    const { naturalWidth: w, naturalHeight: h } = img;
    const scale = Math.min(
      1,
      Math.max(img.width / w, img.height / h),
      MAX_SIDE / Math.max(w, h),
    );
    if (!(scale > 0)) return;
    const width = Math.max(1, Math.round(w * scale));
    const height = Math.max(1, Math.round(h * scale));
    const source = img.currentSrc || src;
    const id = this.resource(img);
    // Keeping the original data URL in the cache key would retain the full picture.
    const key = /^\s*data:/i.test(source) ? null : `${width}x${height} ${source}`;
    const cached = this.encoded.get(id);
    let url = cached && cached.key === key ? cached.url : undefined;
    if (url === undefined) {
      if (performance.now() > until) return;
      url = this.encode(img, width, height);
    }
    this.encoded.delete(id);
    if (key !== null) this.encoded.set(id, { key, url });
    if (this.encoded.size > MAX_IMAGES) this.encoded.delete(this.encoded.keys().next().value!);
    if (url && this.bytes + url.length <= MAX_SESSION_IMAGE_BYTES) {
      if (segment) this.bytes += segment.add(attributes, url);
      else {
        attributes.rr_dataURL = url;
        this.bytes += url.length;
      }
    }
  }

  /** A data URL of at most 48 KiB, or "" when the picture cannot be read or is still too large at half the size. */
  private encode(img: HTMLImageElement, width: number, height: number): string {
    try {
      const canvas = (this.canvas ??= document.createElement("canvas"));
      let alpha: boolean | undefined;
      for (let attempt = 0; attempt < 2; ) {
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d")!;
        context.drawImage(img, 0, 0, width, height);
        if (alpha === undefined) {
          alpha = false;
          const pixels = context.getImageData(0, 0, width, height).data;
          for (let i = 3; i < pixels.length && !alpha; i += 4)
            alpha = pixels[i]! < 255;
          const scale = MAX_PNG_SIDE / Math.max(width, height);
          if (alpha && scale < 1) {
            width = Math.max(1, Math.round(width * scale));
            height = Math.max(1, Math.round(height * scale));
            continue;
          }
        }
        const url = canvas.toDataURL(alpha ? "image/png" : "image/jpeg", 0.45);
        // Base64 holds 3 bytes in 4 characters.
        if (url.length * 0.75 <= MAX_IMAGE_BYTES) return url;
        width = Math.ceil(width / 2);
        height = Math.ceil(height / 2);
        attempt++;
      }
    } catch {
      // A picture from another origin taints the canvas; no canvas at all (a test DOM) is the same.
    }
    return "";
  }
}
