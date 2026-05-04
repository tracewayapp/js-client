import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Traceway RN Demo",
  slug: "traceway-rn-demo",
  version: "1.0.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  newArchEnabled: true,
  splash: {
    backgroundColor: "#0b0b0f",
  },
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.tracewayapp.rndemo",
  },
  android: {
    package: "com.tracewayapp.rndemo",
    edgeToEdgeEnabled: true,
  },
  web: {
    bundler: "metro",
  },
  extra: {
    tracewayDsn:
      process.env.TRACEWAY_DSN ??
      "PLACEHOLDER_TOKEN@http://localhost:8082/api/report",
  },
};

export default config;
