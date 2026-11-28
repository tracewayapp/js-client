export function generateUUID(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// The 2.0 connection string (`token@url`), read by the rules of CONTRACT §16.1; see connection.ts.
export { parseConnectionString } from "./connection.js";
export type { ParsedConnectionString } from "./connection.js";

export function nowISO(): string {
  return new Date().toISOString();
}

export function msToNanoseconds(ms: number): number {
  return Math.round(ms * 1_000_000);
}
