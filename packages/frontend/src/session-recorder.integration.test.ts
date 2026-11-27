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
