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

export interface ParsedConnectionString {
  token: string;
  apiUrl: string;
}

export function parseConnectionString(
  connectionString: string,
): ParsedConnectionString {
  const atIndex = connectionString.indexOf("@");
  if (atIndex === -1) {
    throw new Error(
      "Invalid connection string: must be in format {token}@{apiUrl}",
    );
  }
  const token = connectionString.slice(0, atIndex);
  const apiUrl = connectionString.slice(atIndex + 1);
  if (!token || !apiUrl) {
    throw new Error(
      "Invalid connection string: token and apiUrl must not be empty",
    );
  }
  return { token, apiUrl };
}

export function nowISO(): string {
  return new Date().toISOString();
}

export function msToNanoseconds(ms: number): number {
  return Math.round(ms * 1_000_000);
}
