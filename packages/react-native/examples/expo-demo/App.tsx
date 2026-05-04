import React, { useCallback, useEffect, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  StatusBar,
} from "react-native";
import Constants from "expo-constants";
import {
  TracewayProvider,
  TracewayErrorBoundary,
  useTraceway,
  flush,
} from "@tracewayapp/react-native";

const DSN =
  (Constants.expoConfig?.extra?.tracewayDsn as string | undefined) ??
  "PLACEHOLDER_TOKEN@http://localhost:8082/api/report";

type LogEntry = { time: string; message: string; kind: "info" | "ok" | "err" };

function BrokenRender({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("Component render error: BrokenRender threw");
  return <Text style={styles.muted}>BrokenRender mounted normally.</Text>;
}

function Demo() {
  const { captureException, captureMessage, recordAction } = useTraceway();
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [renderError, setRenderError] = useState(false);
  const [renderKey, setRenderKey] = useState(0);

  const log = useCallback(
    (message: string, kind: LogEntry["kind"] = "info") => {
      const time = new Date().toLocaleTimeString();
      setLogs((prev) => [{ time, message, kind }, ...prev].slice(0, 50));
    },
    [],
  );

  useEffect(() => {
    log("Traceway initialized via TracewayProvider", "ok");
  }, [log]);

  const handleEventError = () => {
    try {
      throw new Error("Event handler error: onPress threw");
    } catch (err) {
      captureException(err as Error);
      log("Captured event handler error", "ok");
    }
  };

  const handleUncaughtThrow = () => {
    log("Throwing uncaught — ErrorUtils handler should catch it", "info");
    setTimeout(() => {
      throw new Error("Uncaught timer throw — captured by ErrorUtils");
    }, 0);
  };

  const handleUnhandledRejection = () => {
    log("Rejecting a promise without .catch — ErrorUtils catches it", "info");
    Promise.reject(new Error("Unhandled rejection: Promise.reject without .catch"));
  };

  const handleRenderError = () => {
    log("Triggering render error inside <TracewayErrorBoundary>", "info");
    setRenderError(true);
  };

  const handleFetch500 = async () => {
    log("Fetching httpstat.us/500…", "info");
    try {
      const resp = await fetch("https://httpstat.us/500");
      if (!resp.ok) throw new Error(`Fetch error: HTTP ${resp.status}`);
    } catch (err) {
      captureException(err as Error);
      log("Captured fetch HTTP 500 error", "ok");
    }
  };

  const handleFetchBadHost = async () => {
    log("Fetching invalid host…", "info");
    try {
      await fetch("https://this-domain-does-not-exist-12345.example/");
    } catch (err) {
      captureException(err as Error);
      log("Captured fetch network error", "ok");
    }
  };

  const handleCaptureMessage = () => {
    captureMessage(`User reached checkout at ${new Date().toISOString()}`);
    log("Captured a manual message", "ok");
  };

  const handleRecordAction = () => {
    recordAction("cart", "add_item", { sku: "SKU-123", qty: 2 });
    log("Recorded a custom action (will ride along the next exception)", "ok");
  };

  const handleFlush = async () => {
    log("Flushing pending events…", "info");
    try {
      await flush();
      log("Flush completed", "ok");
    } catch (err) {
      log(`Flush failed: ${err}`, "err");
    }
  };

  const resetRender = () => {
    setRenderError(false);
    setRenderKey((k) => k + 1);
  };

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <Text style={styles.title}>Traceway RN Demo</Text>
      <Text style={styles.subtitle}>
        Tap any button to exercise a capture path. Then check your Traceway
        dashboard.
      </Text>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Errors</Text>
        <Button label="Caught exception" onPress={handleEventError} />
        <Button label="Uncaught throw (ErrorUtils)" onPress={handleUncaughtThrow} />
        <Button
          label="Unhandled rejection (ErrorUtils)"
          onPress={handleUnhandledRejection}
        />
        <Button label="Render-time throw (boundary)" onPress={handleRenderError} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Network</Text>
        <Button label="fetch HTTP 500" onPress={handleFetch500} />
        <Button label="fetch bad host" onPress={handleFetchBadHost} />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Manual</Text>
        <Button label="captureMessage" onPress={handleCaptureMessage} />
        <Button label="recordAction" onPress={handleRecordAction} />
        <Button label="flush" onPress={handleFlush} kind="muted" />
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Error Boundary</Text>
        <TracewayErrorBoundary
          key={`render-${renderKey}`}
          fallback={
            <View style={styles.fallback}>
              <Text style={styles.fallbackTitle}>Boundary caught a render error.</Text>
              <Button label="Reset boundary" onPress={resetRender} kind="muted" />
            </View>
          }
        >
          <BrokenRender shouldThrow={renderError} />
        </TracewayErrorBoundary>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Activity Log</Text>
        {logs.length === 0 ? (
          <Text style={styles.muted}>No activity yet.</Text>
        ) : (
          logs.map((entry, i) => (
            <Text key={i} style={[styles.logLine, kindStyle(entry.kind)]}>
              <Text style={styles.logTime}>{entry.time}</Text>  {entry.message}
            </Text>
          ))
        )}
      </View>
    </ScrollView>
  );
}

function Button({
  label,
  onPress,
  kind = "primary",
}: {
  label: string;
  onPress: () => void;
  kind?: "primary" | "muted";
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        kind === "muted" ? styles.buttonMuted : styles.buttonPrimary,
        pressed && styles.buttonPressed,
      ]}
    >
      <Text style={styles.buttonLabel}>{label}</Text>
    </Pressable>
  );
}

function kindStyle(kind: LogEntry["kind"]) {
  if (kind === "ok") return styles.logOk;
  if (kind === "err") return styles.logErr;
  return styles.logInfo;
}

export default function App() {
  return (
    <TracewayProvider
      connectionString={DSN}
      options={{ debug: true, version: "1.0.0" }}
    >
      <StatusBar barStyle="light-content" backgroundColor="#0b0b0f" />
      <Demo />
    </TracewayProvider>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: "#0b0b0f" },
  container: { padding: 20, paddingTop: 60, paddingBottom: 60 },
  title: { color: "#f5f5f7", fontSize: 28, fontWeight: "700" },
  subtitle: { color: "#8a8a92", marginTop: 6, marginBottom: 24, lineHeight: 20 },
  section: { marginBottom: 24 },
  sectionTitle: {
    color: "#c7c7d1",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 10,
  },
  button: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginBottom: 8,
  },
  buttonPrimary: { backgroundColor: "#3461ff" },
  buttonMuted: { backgroundColor: "#1f1f26" },
  buttonPressed: { opacity: 0.7 },
  buttonLabel: { color: "white", fontWeight: "600", fontSize: 15 },
  fallback: {
    padding: 14,
    borderRadius: 10,
    backgroundColor: "#3a1d1d",
  },
  fallbackTitle: { color: "#ffb4b4", marginBottom: 8 },
  muted: { color: "#6e6e76" },
  logLine: { fontSize: 13, fontFamily: "Courier", marginBottom: 2 },
  logTime: { color: "#5a5a62" },
  logInfo: { color: "#c7c7d1" },
  logOk: { color: "#7be584" },
  logErr: { color: "#ff8b8b" },
});
