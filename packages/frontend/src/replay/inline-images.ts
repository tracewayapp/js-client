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
}

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
  private readonly encoded = new Map<string, string>();
  private canvas: HTMLCanvasElement | null = null;

  constructor(
    private readonly element: (id: number) => Node | null,
    private readonly budgetMs = 16,
  ) {}

  /** Full snapshots and the nodes a mutation adds. */
  inline(event: eventWithTime): void {
    const until = performance.now() + this.budgetMs;
    const visit = (node: SerializedNode | undefined) => {
      if (node?.tagName === "img") this.image(node, until);
      node?.childNodes?.forEach(visit);
    };
    const data = event.data as any;
    if (event.type === 2) visit(data?.node);
    else if (event.type === 3 && data?.source === 0)
      data.adds?.forEach((add: { node: SerializedNode }) => visit(add.node));
  }

  private image(node: SerializedNode, until: number): void {
    const attributes = node.attributes!;
    const img = this.element(node.id) as HTMLImageElement | null;
    if (
      typeof attributes.src !== "string" ||
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
    const key = `${width}x${height} ${img.currentSrc || attributes.src}`;
    let url = this.encoded.get(key);
    if (url === undefined) {
      if (performance.now() > until) return;
      url = this.encode(img, width, height);
    }
    this.encoded.delete(key);
    this.encoded.set(key, url);
    if (this.encoded.size > MAX_IMAGES)
      this.encoded.delete(this.encoded.keys().next().value!);
    if (url && this.bytes + url.length <= MAX_SESSION_IMAGE_BYTES) {
      attributes.rr_dataURL = url;
      this.bytes += url.length;
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
