import { useEffect, useRef } from "react";
import {
  setAttributes as setAttrs,
  removeAttribute,
} from "@tracewayapp/frontend";

/**
 * Declaratively bind a map of key/value attributes to the Traceway client's
 * global scope. The hook diffs the previous map against the current one on
 * every render and pushes only the deltas — `setAttribute` for new/changed
 * keys, `removeAttribute` for keys that disappeared. On unmount it removes
 * every key it currently owns.
 *
 *   useTracewayAttributes({ userId: user.id, tenant: org.id });
 *
 * Important: the hook treats every key in the passed map as one it owns and
 * will remove on unmount. Don't share keys between this hook and direct
 * `setAttribute` calls — pick one source of truth per key.
 */
export function useTracewayAttributes(
  attributes: Record<string, string> | null | undefined,
): void {
  // Persist across renders so the cleanup-on-unmount effect can see what
  // keys this hook touched, regardless of which dep the diff fired on.
  const prevRef = useRef<Record<string, string>>({});

  // Stable string repr — re-runs the diff only when key/value content
  // changes, not when the parent re-renders with a new object reference.
  const fingerprint = stableFingerprint(attributes);

  useEffect(() => {
    const next = attributes ?? {};
    const prev = prevRef.current;

    const toSet: Record<string, string> = {};
    for (const k of Object.keys(next)) {
      if (prev[k] !== next[k]) toSet[k] = next[k]!;
    }
    if (Object.keys(toSet).length > 0) {
      setAttrs(toSet);
    }

    for (const k of Object.keys(prev)) {
      if (!(k in next)) {
        removeAttribute(k);
      }
    }

    prevRef.current = { ...next };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint]);

  // Cleanup on unmount — remove only what the hook currently owns.
  useEffect(() => {
    return () => {
      for (const k of Object.keys(prevRef.current)) {
        removeAttribute(k);
      }
      prevRef.current = {};
    };
  }, []);
}

function stableFingerprint(
  attributes: Record<string, string> | null | undefined,
): string {
  if (!attributes) return "";
  const keys = Object.keys(attributes).sort();
  const parts: string[] = [];
  for (const k of keys) {
    parts.push(`${k}=${attributes[k]}`);
  }
  return parts.join("\n");
}
