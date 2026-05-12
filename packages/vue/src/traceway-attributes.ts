import { defineComponent } from "vue";
import type { PropType } from "vue";
import { useTracewayAttributes } from "./use-traceway-attributes.js";

export interface TracewayAttributesProps {
  attributes: Record<string, string> | null | undefined;
}

/**
 * Declarative wrapper around `useTracewayAttributes`. Mount inside any tree
 * where you've established the user/tenant/etc. context:
 *
 *   <TracewayAttributes :attributes="{ userId: user.id, tenant: org.id }" />
 *
 * Renders nothing. Removes the keys it owns on unmount.
 */
export const TracewayAttributes = defineComponent({
  name: "TracewayAttributes",
  props: {
    attributes: {
      type: Object as PropType<Record<string, string> | null | undefined>,
      default: null,
    },
  },
  setup(props) {
    useTracewayAttributes(() => props.attributes);
    return () => null;
  },
});
