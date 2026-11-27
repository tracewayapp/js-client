import type { eventWithTime } from "@rrweb/types";

/** Attributes that carry text or a value of the page: inside a mask every character but whitespace becomes `*`. */
const TEXT_ATTRIBUTE = /^(?:title|alt|placeholder|value|label|href|aria-.+|data-.+)$/;
/** Attributes that make the replay load a picture: inside a mask they are left out. */
const URL_ATTRIBUTE = /^(?:src|srcset|srcdoc|rr_dataURL|poster|background)$/;

const stars = (text: string): string => text.replace(/\S/g, "*");

function scrubStyle(value: unknown): unknown {
  return typeof value === "string"
    ? value.replace(/url\([^)]*\)/gi, "none")
    : Array.isArray(value)
      ? [scrubStyle(value[0]), value[1]]
      : value;
}

/**
 * Whether a node of the page is inside an element with class `traceway-mask`, looking past shadow roots to their
 * host and past a same-origin frame's document to the `<iframe>`.
 */
export function inMask(node: Node | null | undefined): boolean {
  try {
    for (let n: any = node; n; n = n.parentNode ?? n.host ?? n.defaultView?.frameElement)
      if (n.classList?.contains("traceway-mask")) return true;
  } catch {
    // A frame of another origin: rrweb does not record it.
  }
  return false;
}

function maskAttributes(attributes: Record<string, unknown> | undefined): void {
  for (const name in attributes) {
    const value = attributes[name];
    if (name === "style")
      attributes[name] =
        value && typeof value === "object" && !Array.isArray(value)
          ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubStyle(v)]))
          : scrubStyle(value);
    else if (typeof value !== "string") continue;
    else if (URL_ATTRIBUTE.test(name)) delete attributes[name];
    else if (TEXT_ATTRIBUTE.test(name)) attributes[name] = stars(value);
  }
}

/** A serialized element with class `traceway-mask`. */
const hasMask = (node: any): boolean =>
  node?.type === 2 && /(?:^|\s)traceway-mask(?:\s|$)/.test(String(node.attributes?.class ?? ""));

function maskNode(node: any, masked: boolean): void {
  if (!node) return;
  masked ||= hasMask(node);
  if (masked) {
    if (node.type === 2) maskAttributes(node.attributes);
    else if (typeof node.textContent === "string" && !node.isStyle)
      node.textContent = stars(node.textContent);
  }
  node.childNodes?.forEach((child: unknown) => maskNode(child, masked));
}

/**
 * What rrweb leaves visible of a `traceway-mask` element, hidden in an event before it is kept: attribute values
 * (`title`, `aria-label`, `placeholder`, `data-*`, the `value` of buttons and of fields when inputs are not all
 * masked), the pictures of `style` and `src` attributes, what is typed into a field, and text added or changed after
 * the snapshot inside shadow roots and same-origin frames, where rrweb's own check stops.
 */
export function maskEvent(event: eventWithTime, live: (id: number) => Node | null): void {
  const data = event.data as any;
  if (event.type === 2) maskNode(data?.node, false);
  if (event.type !== 3 || !data) return;
  if (data.source === 0) {
    // A node added in this event answers for the children added with it.
    const known = new Map<number, boolean>();
    for (const add of data.adds ?? []) {
      const masked = known.get(add.parentId) ?? inMask(live(add.parentId));
      maskNode(add.node, masked);
      if (add.node) known.set(add.node.id, masked || hasMask(add.node));
    }
    for (const text of data.texts ?? []) {
      const node = live(text.id);
      if (typeof text.value === "string" && node?.parentNode?.nodeName !== "STYLE" && inMask(node))
        text.value = stars(text.value);
    }
    for (const change of data.attributes ?? [])
      if (inMask(live(change.id))) maskAttributes(change.attributes);
  } else if (data.source === 5 && typeof data.text === "string" && inMask(live(data.id)))
    data.text = stars(data.text);
}
