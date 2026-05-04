import { describe, it, expect } from "vitest";
import { _collectSyncDeviceInfoFrom } from "./device-info.js";

const FAKE_RN = {
  Platform: { OS: "ios", Version: "17.4" },
  Dimensions: {
    get: (k: string) =>
      k === "screen" ? { width: 393.5, height: 852 } : { width: 0, height: 0 },
  },
  PixelRatio: { get: () => 3 },
};

describe("collectSyncDeviceInfo", () => {
  it("collects os, screen, locale, runtime info from RN core APIs", () => {
    const info = _collectSyncDeviceInfoFrom(FAKE_RN, {});

    expect(info["os.name"]).toBe("ios");
    expect(info["os.version"]).toBe("17.4");
    expect(info["screen.resolution"]).toBe("394x852");
    expect(info["screen.density"]).toBe("3.0");
    expect(info["device.locale"]).toMatch(/^[a-z]{2}/i);
    expect(info["runtime.engine"]).toBe("hermes");
  });

  it("reports javascriptcore when HermesInternal is absent", () => {
    const info = _collectSyncDeviceInfoFrom(FAKE_RN, undefined);
    expect(info["runtime.engine"]).toBe("javascriptcore");
  });

  it("rounds fractional screen dimensions to whole pixels", () => {
    const info = _collectSyncDeviceInfoFrom(FAKE_RN, {});
    expect(info["screen.resolution"]).not.toMatch(/\./);
  });

  it("returns an empty object (apart from runtime) when RN module is absent", () => {
    const info = _collectSyncDeviceInfoFrom({}, undefined);
    expect(info["os.name"]).toBeUndefined();
    expect(info["os.version"]).toBeUndefined();
    expect(info["screen.resolution"]).toBeUndefined();
    expect(info["runtime.engine"]).toBe("javascriptcore");
  });

  it("treats Platform.Version=0 as a valid value", () => {
    const info = _collectSyncDeviceInfoFrom(
      { Platform: { OS: "android", Version: 0 } },
      undefined,
    );
    expect(info["os.version"]).toBe("0");
  });
});
