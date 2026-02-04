import { describe, it, expect } from "vitest";
import { TypedRing } from "./typed-ring.js";

describe("TypedRing", () => {
  it("should push and read items in order", () => {
    const ring = new TypedRing<number>(5);
    ring.push(1);
    ring.push(2);
    ring.push(3);
    expect(ring.readAll()).toEqual([1, 2, 3]);
    expect(ring.length).toBe(3);
  });

  it("should overflow and overwrite oldest items", () => {
    const ring = new TypedRing<number>(3);
    ring.push(1);
    ring.push(2);
    ring.push(3);
    ring.push(4);
    expect(ring.readAll()).toEqual([2, 3, 4]);
    expect(ring.length).toBe(3);
  });

  it("should maintain insertion order in readAll after wrap-around", () => {
    const ring = new TypedRing<string>(3);
    ring.push("a");
    ring.push("b");
    ring.push("c");
    ring.push("d");
    ring.push("e");
    expect(ring.readAll()).toEqual(["c", "d", "e"]);
  });

  it("should clear all items", () => {
    const ring = new TypedRing<number>(5);
    ring.push(1);
    ring.push(2);
    ring.push(3);
    ring.clear();
    expect(ring.readAll()).toEqual([]);
    expect(ring.length).toBe(0);
  });

  it("should remove specific items", () => {
    const ring = new TypedRing<number>(5);
    ring.push(1);
    ring.push(2);
    ring.push(3);
    ring.push(4);
    const removed = ring.remove([2, 4]);
    expect(removed).toBe(2);
    expect(ring.readAll()).toEqual([1, 3]);
    expect(ring.length).toBe(2);
  });

  it("should remove items by reference", () => {
    const a = { id: 1 };
    const b = { id: 2 };
    const c = { id: 3 };
    const ring = new TypedRing<{ id: number }>(5);
    ring.push(a);
    ring.push(b);
    ring.push(c);
    const removed = ring.remove([b]);
    expect(removed).toBe(1);
    expect(ring.readAll()).toEqual([a, c]);
  });

  it("should handle remove with empty array", () => {
    const ring = new TypedRing<number>(3);
    ring.push(1);
    ring.push(2);
    expect(ring.remove([])).toBe(0);
    expect(ring.readAll()).toEqual([1, 2]);
  });

  it("should work with capacity 1", () => {
    const ring = new TypedRing<number>(1);
    ring.push(1);
    expect(ring.readAll()).toEqual([1]);
    ring.push(2);
    expect(ring.readAll()).toEqual([2]);
    expect(ring.length).toBe(1);
  });

  it("should report correct capacity", () => {
    const ring = new TypedRing<number>(10);
    expect(ring.capacity).toBe(10);
  });

  it("should handle remove after wrap-around", () => {
    const items = [{ v: 1 }, { v: 2 }, { v: 3 }, { v: 4 }, { v: 5 }];
    const ring = new TypedRing<{ v: number }>(3);
    ring.push(items[0]);
    ring.push(items[1]);
    ring.push(items[2]);
    ring.push(items[3]); // overwrites items[0]
    ring.push(items[4]); // overwrites items[1]

    const removed = ring.remove([items[3]]);
    expect(removed).toBe(1);
    expect(ring.readAll()).toEqual([items[2], items[4]]);
  });
});
