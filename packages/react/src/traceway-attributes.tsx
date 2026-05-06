import { useTracewayAttributes } from "./use-traceway-attributes.js";

export interface TracewayAttributesProps {
  attributes: Record<string, string> | null | undefined;
}

/**
 * Declarative wrapper around `useTracewayAttributes`. Mount inside any tree
 * where you've established the user/tenant/etc. context:
 *
 *   <TracewayAttributes attributes={{ userId: user.id, tenant: org.id }} />
 *
 * Renders nothing. Removes the keys it owns on unmount.
 */
export function TracewayAttributes({ attributes }: TracewayAttributesProps): null {
  useTracewayAttributes(attributes);
  return null;
}
