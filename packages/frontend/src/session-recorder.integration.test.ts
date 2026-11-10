import { afterEach, describe, expect, it, vi } from "vitest";
import { EventType, IncrementalSource } from "@rrweb/types";
import { SessionRecorder } from "./session-recorder.js";

let recorder: SessionRecorder | undefined;

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
    recorder.start();
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

  it("rotates into replayable segments, takes fresh snapshots and stops observing", async () => {
    document.body.innerHTML = "<p>Before rotation</p>";
    const ready = vi.fn();
    const activity = vi.fn();
    recorder = new SessionRecorder({
      segmentDuration: 50,
      onSegmentReady: ready,
      onActivity: activity,
    });
    recorder.start();
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
    expect(recorder.drainCurrent()?.events.length).toBeGreaterThan(0);
    expect(recorder.hasSegments()).toBe(false);
  });
});
