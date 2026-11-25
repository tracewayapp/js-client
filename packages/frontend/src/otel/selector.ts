const MAX_SELECTOR_LENGTH = 100;
const MAX_ELEMENTS = 3;
const MAX_ATTRIBUTE_VALUE_LENGTH = 40;
/** On every page, so they never tell two elements apart. */
const PAGE_ELEMENTS = ["body", "html"];
/** Unique by intent, so the walk can stop at them. */
const TEST_ID_ATTRIBUTES = ["data-testid", "data-test", "data-cy"];
/**
 * Only attributes a developer writes. Never `aria-label`, text, `href` or `value`: those can hold what the user
 * typed or is looking at, and as a metric dimension every distinct value would be its own series.
 */
const NAMING_ATTRIBUTES = [...TEST_ID_ATTRIBUTES, "data-slot", "name", "role"];

const GENERATED_ID_PREFIX =
  /^(bits-|radix-|headlessui-|mui-|rc-|react-aria|react-select-|ember|svelte-|tippy-|floating-ui-|downshift-|mantine-|chakra-|reach-|_r_)/i;
const CSS_IDENTIFIER = /^-?[_a-zA-Z][\w-]*$/;
const SAFE_ATTRIBUTE_VALUE = /^[A-Za-z0-9_. -]+$/;
const HEX_WITH_DIGIT = /^[0-9a-f]*\d[0-9a-f]*$/i;
/** One element as `describe` writes it: a tag (a `localName`), then an id, a naming attribute or classes. */
const SELECTOR_PART =
  /^[a-z][\w-]*(?:#([^.[\]"]+)|\[([\w-]+)="([^"]*)"\]|((?:\.[^.[\]"#]+){1,2}))?$/;

/** Ids that UI libraries and frameworks generate per render: a selector built on them never matches twice. */
function generatedId(id: string): boolean {
  if (GENERATED_ID_PREFIX.test(id) || /[:«»]|\d{2}/.test(id)) return true;
  return id
    .split(/[^A-Za-z0-9]+/)
    .some((token) => token.length >= 6 && HEX_WITH_DIGIT.test(token));
}

function stableId(element: Element): string | undefined {
  const id = element.id;
  return id && CSS_IDENTIFIER.test(id) && !generatedId(id) ? id : undefined;
}

function namingAttribute(element: Element): [string, string] | undefined {
  for (const name of NAMING_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (
      value &&
      value.length <= MAX_ATTRIBUTE_VALUE_LENGTH &&
      SAFE_ATTRIBUTE_VALUE.test(value)
    )
      return [name, value];
  }
  return undefined;
}

function plainClasses(element: Element): string[] {
  return (element.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter((name) => CSS_IDENTIFIER.test(name))
    .slice(0, 2);
}

/** The element's own part of the selector, and whether it identifies the element without its ancestors. */
function describe(element: Element): [string, boolean] {
  const tag = element.localName;
  const id = stableId(element);
  if (id) return [`${tag}#${id}`, true];
  const attribute = namingAttribute(element);
  if (attribute)
    return [
      `${tag}[${attribute[0]}="${attribute[1]}"]`,
      TEST_ID_ATTRIBUTES.includes(attribute[0]),
    ];
  const classes = plainClasses(element);
  return [classes.length ? `${tag}.${classes.join(".")}` : tag, false];
}

/**
 * A short CSS selector of an element that stays the same across renders and page loads, so it can be a metric
 * dimension: generated ids and utility classes with variants or arbitrary values are left out.
 */
export function selectorOf(node: unknown): string | undefined {
  let element = node as Element | null | undefined;
  // A layout shift can name a text node; its element is what moved.
  if (element?.nodeType === 3) element = element.parentElement;
  if (!element || element.nodeType !== 1) return undefined;
  const [own, unique] = describe(element);
  let selector = own.slice(0, MAX_SELECTOR_LENGTH);
  if (unique) return selector;
  for (let depth = 1; depth < MAX_ELEMENTS; depth++) {
    element = element.parentElement;
    if (!element || PAGE_ELEMENTS.includes(element.localName)) break;
    const [part, done] = describe(element);
    if (part.length + 1 + selector.length > MAX_SELECTOR_LENGTH) break;
    selector = `${part}>${selector}`;
    if (done) break;
  }
  return selector;
}

function stablePart(part: string): boolean {
  const match = SELECTOR_PART.exec(part);
  if (!match) return false;
  const [, id, attribute, value, classes] = match;
  if (id !== undefined) return CSS_IDENTIFIER.test(id) && !generatedId(id);
  if (attribute !== undefined)
    return (
      NAMING_ATTRIBUTES.includes(attribute) &&
      value!.length <= MAX_ATTRIBUTE_VALUE_LENGTH &&
      SAFE_ATTRIBUTE_VALUE.test(value!)
    );
  return (
    !classes ||
    classes
      .slice(1)
      .split(".")
      .every((name) => CSS_IDENTIFIER.test(name))
  );
}

/**
 * Whether a selector has the shape `selectorOf` writes. web-vitals does not ask for a selector of an element that
 * has left the page; it reports the browser's own instead (`#id` for LCP, a positional path such as
 * `BODY > DIV:nth-child(2)` for INP), which would bring generated ids and positions back into a dimension.
 */
export function isStableSelector(selector: string): boolean {
  const parts = selector.split(">");
  return (
    selector.length <= MAX_SELECTOR_LENGTH &&
    parts.length <= MAX_ELEMENTS &&
    parts.every(stablePart)
  );
}
