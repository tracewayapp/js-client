import { watchEffect, onUnmounted, toValue } from "vue";
import type { MaybeRefOrGetter } from "vue";
import {
  setAttributes as setAttrs,
  removeAttribute,
} from "@tracewayapp/frontend";

/**
 * Bind a Vue component to the Traceway client's global attribute scope.
 * Pass a reactive ref / getter / plain map. The composable diffs the new
 * map against the last one on each reactive change, pushes only the deltas,
 * and removes any keys that disappeared. On component unmount, every key
 * it currently owns is removed from the global scope.
 *
 * ```vue
 * <script setup>
 *   import { useTracewayAttributes } from "@tracewayapp/vue";
 *   const props = defineProps<{ user: User; org: Org }>();
 *   useTracewayAttributes(() => ({ userId: props.user.id, tenant: props.org.id }));
 * </script>
 * ```
 *
 * Important: the hook treats every key in the passed map as one it owns and
 * will remove on unmount. Don't share keys between this hook and direct
 * `setAttribute` calls — pick one source of truth per key.
 */
export function useTracewayAttributes(
  attributes: MaybeRefOrGetter<Record<string, string> | null | undefined>,
): void {
  let prev: Record<string, string> = {};

  watchEffect(() => {
    const next = toValue(attributes) ?? {};

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
  });

  onUnmounted(() => {
    for (const k of Object.keys(prev)) {
      removeAttribute(k);
    }
    prev = {};
  });
}
