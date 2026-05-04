import type { TracewayReactNativeClient } from "./client.js";

/**
 * Records a navigation transition from one screen to another. RN doesn't
 * have a `window.history` to auto-instrument, so app code wires this into
 * the navigation library it uses (react-navigation, expo-router, etc.).
 *
 * Example with react-navigation:
 *
 * ```tsx
 * <NavigationContainer
 *   onStateChange={(state) => {
 *     const route = state?.routes?.[state.index]?.name;
 *     if (route) recordNavigation(prevRouteRef.current, route);
 *   }}
 * />
 * ```
 */
export function recordNavigationOn(
  client: TracewayReactNativeClient,
  from: string,
  to: string,
): void {
  client.recordNavigationEvent({
    action: "push",
    from,
    to,
  });
}
