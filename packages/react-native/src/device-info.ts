/**
 * Auto-collected device attributes that ride along with every captured
 * exception. Mirrors the keys produced by the Flutter and Android SDKs so the
 * Traceway dashboard renders them consistently across platforms.
 *
 * Everything here is synchronous and uses only React Native core APIs
 * (`Platform`, `Dimensions`, `PixelRatio`) plus the JS `Intl` global, so this
 * module works in Expo Go and bare RN apps without any native module deps.
 *
 * Apps that want richer info (model, manufacturer, IP) can install
 * `expo-device` / `react-native-device-info` themselves and pass the extra
 * keys via `setDeviceAttributes` after init.
 */

interface RNAPIs {
  Platform?: { OS?: unknown; Version?: unknown };
  Dimensions?: {
    get?: (k: string) => { width: number; height: number };
  };
  PixelRatio?: { get?: () => number };
}

/** @internal — exposed for tests so we don't need to mock the `react-native` module specifier. */
export function _collectSyncDeviceInfoFrom(
  rn: RNAPIs,
  hermesInternal: unknown,
): Record<string, string> {
  const info: Record<string, string> = {};

  if (rn.Platform?.OS != null) info["os.name"] = String(rn.Platform.OS);
  if (rn.Platform?.Version != null) {
    info["os.version"] = String(rn.Platform.Version);
  }

  try {
    const screen = rn.Dimensions?.get?.("screen");
    if (screen && Number.isFinite(screen.width) && Number.isFinite(screen.height)) {
      const w = Math.round(screen.width);
      const h = Math.round(screen.height);
      info["screen.resolution"] = `${w}x${h}`;
    }
  } catch {
    // Dimensions not available — skip.
  }

  try {
    const ratio = rn.PixelRatio?.get?.();
    if (typeof ratio === "number" && Number.isFinite(ratio)) {
      info["screen.density"] = ratio.toFixed(1);
    }
  } catch {
    // PixelRatio not available — skip.
  }

  try {
    const locale = new Intl.DateTimeFormat().resolvedOptions().locale;
    if (typeof locale === "string" && locale.length > 0) {
      info["device.locale"] = locale;
    }
  } catch {
    // Intl unavailable on very old engines — skip.
  }

  info["runtime.engine"] = hermesInternal != null ? "hermes" : "javascriptcore";

  return info;
}

function loadReactNative(): RNAPIs {
  try {
    const req = (
      globalThis as { require?: (id: string) => unknown }
    ).require;
    if (typeof req !== "function") return {};
    return req("react-native") as RNAPIs;
  } catch {
    return {};
  }
}

export function collectSyncDeviceInfo(): Record<string, string> {
  const rn = loadReactNative();
  const hermes = (globalThis as { HermesInternal?: unknown }).HermesInternal;
  return _collectSyncDeviceInfoFrom(rn, hermes);
}
