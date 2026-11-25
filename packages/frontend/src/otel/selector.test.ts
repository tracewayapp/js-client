import { afterEach, describe, expect, it } from "vitest";
import { isStableSelector, selectorOf } from "./selector.js";

function render(html: string): Element {
  document.body.innerHTML = html;
  return document.querySelector("[data-target]")!;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("selectorOf", () => {
  it("skips a bits-ui id in favour of data-slot", () => {
    const target = render(
      `<div class="menu"><button id="bits-c10" data-slot="dropdown-menu-trigger" data-target>Open</button></div>`,
    );
    expect(selectorOf(target)).toBe(
      'div.menu>button[data-slot="dropdown-menu-trigger"]',
    );
  });

  it("skips ids made by React useId and other generators", () => {
    for (const id of [
      ":r1:",
      "«r2»",
      "_r_3_",
      "radix-:R1:",
      "headlessui-menu-button-1",
      "ember7",
      "item-12",
      "row-a1b2c3",
    ]) {
      const target = render(`<button data-target>Go</button>`);
      target.id = id;
      expect(selectorOf(target)).toBe("button");
    }
  });

  it("keeps a stable id and stops there", () => {
    const target = render(
      `<main id="checkout"><form class="pay"><button id="pay-now" data-target>Pay</button></form></main>`,
    );
    expect(selectorOf(target)).toBe("button#pay-now");
    target.removeAttribute("id");
    expect(selectorOf(target)).toBe("main#checkout>form.pay>button");
  });

  it("stops the walk at a test id", () => {
    const target = render(
      `<section class="cart"><div data-testid="cart-summary"><span class="total" data-target>9</span></div></section>`,
    );
    expect(selectorOf(target)).toBe('div[data-testid="cart-summary"]>span.total');
  });

  it("walks on past data-slot, name and role", () => {
    const target = render(
      `<div class="field"><label role="group"><input name="email" data-target></label></div>`,
    );
    expect(selectorOf(target)).toBe(
      'div.field>label[role="group"]>input[name="email"]',
    );
  });

  it("drops Tailwind classes with variants or arbitrary values", () => {
    const target = render(
      `<button class="[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none hover:bg-accent w-1/2 btn inline-flex" data-target>Save</button>`,
    );
    expect(selectorOf(target)).toBe("button.btn.inline-flex");
  });

  it("never uses attributes that can hold user data, or unsafe values", () => {
    const target = render(
      `<a href="/orders/8841" aria-label="Order for Jane" data-testid='he said "hi"' data-target>Jane</a>`,
    );
    expect(selectorOf(target)).toBe("a");
  });

  it("describes a text node by its element", () => {
    const target = render(`<p class="lede" data-target>Hello</p>`);
    expect(selectorOf(target.firstChild)).toBe("p.lede");
    expect(selectorOf(document)).toBeUndefined();
    expect(selectorOf(null)).toBeUndefined();
  });

  it("is at most 100 characters and keeps the element end", () => {
    const long = "a".repeat(45);
    const target = render(
      `<div class="${long}-x ${long}-y"><div class="${long}-z"><span class="inner" data-target></span></div></div>`,
    );
    const selector = selectorOf(target)!;
    expect(selector).toBe(`div.${long}-z>span.inner`);
    expect(selector.length).toBeLessThanOrEqual(100);
    target.setAttribute("class", `${long}-1 ${long}-2 ${long}-3`);
    expect(selectorOf(target)!.length).toBe(100);
  });
});

describe("isStableSelector", () => {
  it("accepts what selectorOf writes", () => {
    for (const html of [
      `<div class="menu"><button id="bits-c10" data-slot="dropdown-menu-trigger" data-target>Open</button></div>`,
      `<main id="checkout"><form class="pay"><button data-target>Pay</button></form></main>`,
      `<section class="cart"><div data-testid="cart-summary"><span class="total" data-target>9</span></div></section>`,
      `<div class="field"><label role="group"><input name="first name" data-target></label></div>`,
      `<button class="hover:bg-accent btn -mt-2 inline-flex" data-target>Save</button>`,
      `<svg><foreignObject data-target></foreignObject></svg>`,
      `<a href="/orders/8841" data-target>Jane</a>`,
    ]) {
      const selector = selectorOf(render(html))!;
      expect(selector, html).toBeTruthy();
      expect(isStableSelector(selector), selector).toBe(true);
    }
  });

  it("rejects the selectors browsers and web-vitals write for an element that has left the page", () => {
    for (const selector of [
      "#checkout",
      "#radix-:r1:",
      "button#bits-c10",
      "BODY > DIV:nth-child(2) > BUTTON",
      "html>body>main>div>button",
      "div.flex.items-center.gap-2",
      "button.hover\\:bg-accent",
      'a[href="/orders/8841"]',
      'button[aria-label="Order for Jane"]',
      `img.${"x".repeat(120)}`,
      "",
    ])
      expect(isStableSelector(selector), selector).toBe(false);
  });
});
