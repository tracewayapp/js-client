import { onDestroy } from "svelte";
import {
  setAttributes as setAttrs,
  removeAttribute,
} from "@tracewayapp/frontend";

/**
 * Bind a Svelte component to the Traceway client's global attribute scope.
 * Call once during component setup; the returned function is the per-render
 * sync hook — invoke it from `$effect` (Svelte 5) or `$:` (Svelte 4) and it
 * will diff the new map against the last one, push only the deltas, and
 * remove any keys that disappeared. On `onDestroy` every key it currently
 * owns is removed from the scope.
 *
 * Svelte 5:
 * ```svelte
 * <script>
 *   import { useTracewayAttributes } from "@tracewayapp/svelte";
 *   let { user, org } = $props();
 *   const sync = useTracewayAttributes();
 *   $effect(() => sync({ userId: user.id, tenant: org.id }));
 * </script>
 * ```
 *
 * Svelte 4:
 * ```svelte
 * <script>
 *   import { useTracewayAttributes } from "@tracewayapp/svelte";
 *   export let user; export let org;
 *   const sync = useTracewayAttributes();
 *   $: sync({ userId: user.id, tenant: org.id });
 * </script>
 * ```
 *
 * Important: the hook treats every key it has set as one it owns and will
 * remove on destroy. Don't share keys between this hook and direct
 * `setAttribute` calls — pick one source of truth per key.
 */
export function useTracewayAttributes(): (
  attributes: Record<string, string> | null | undefined,
) => void {
  let prev: Record<string, string> = {};

  onDestroy(() => {
    for (const k of Object.keys(prev)) {
      removeAttribute(k);
    }
    prev = {};
  });

  return function sync(attributes) {
    const next = attributes ?? {};

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

    prev = { ...next };
  };
}
