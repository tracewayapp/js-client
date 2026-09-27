/**
 * Keeps the open session in `sessionStorage` so a full page navigation in the
 * same tab continues it instead of starting a new one.
 *
 * `closedAtMs` is set when the page is hidden or unloads and cleared while a
 * page has the session open. A new page only resumes a session that has it:
 * a tab duplicated from a live page copies the storage while the session is
 * still open, and must start its own rather than interleave segments with it.
 */
export interface StoredSession {
  id: string;
  startedAt: string;
  startedAtMs: number;
  lastActivityMs: number;
  segmentIndex: number;
  /** url/path/referrer of the page the session started on. */
  entry?: Record<string, string>;
  closedAtMs?: number;
}

function storage(): Storage | null {
  try {
    return typeof sessionStorage === "undefined" ? null : sessionStorage;
  } catch {
    return null;
  }
}

export function readStoredSession(key: string): StoredSession | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredSession;
    if (
      typeof parsed.id !== "string" ||
      typeof parsed.startedAt !== "string" ||
      !Number.isFinite(parsed.startedAtMs) ||
      !Number.isFinite(parsed.lastActivityMs) ||
      !Number.isInteger(parsed.segmentIndex)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredSession(key: string, session: StoredSession): void {
  try {
    storage()?.setItem(key, JSON.stringify(session));
  } catch {
    // Storage full or blocked: the session still works for this page.
  }
}

export function clearStoredSession(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // ignore
  }
}
