import type {
  AgentConfigObject,
  AgentToServer,
  AttributeValue,
  ServerToAgent,
} from "./messages.js";
import {
  decodeServerToAgent,
  encodeAgentToServer,
  RemoteConfigStatus,
  ServerErrorType,
  ServerToAgentFlags,
} from "./messages.js";

export interface AgentDescription {
  identifying: Record<string, AttributeValue>;
  nonIdentifying: Record<string, AttributeValue>;
}

export interface RemoteConfig {
  configMap: Record<string, AgentConfigObject>;
  configHash: Uint8Array;
}

export type ApplyResult =
  | { applied: true }
  | { applied: false; errorMessage: string };

export interface OpampClientOptions {
  /** The server's OpAMP endpoint, e.g. https://traceway.example.com/api/otel/v1/opamp. */
  endpoint: string;
  headers?: Record<string, string>;
  instanceUid: Uint8Array;
  capabilities: number;
  customCapabilities?: string[];
  /** Read on every poll: the client sends its full state each time, so a stateless server can answer. */
  describe: () => AgentDescription;
  onRemoteConfig: (config: RemoteConfig) => ApplyResult;
  /** Hash of the config applied on an earlier page, so the server does not resend what is already in effect. */
  appliedConfigHash?: Uint8Array;
  onHeartbeatChange?: (seconds: number) => void;
  onInstanceUidChange?: (uid: Uint8Array) => void;
  /** Called once when the server rejects the credentials; the client stops polling. */
  onUnauthorized?: () => void;
  defaultPollIntervalMs?: number;
  fetchImpl?: typeof fetch;
}

const MIN_POLL_INTERVAL_MS = 30_000;
const MAX_BACKOFF_MS = 30 * 60_000;
const FIRST_BACKOFF_MS = 30_000;

export function uuidString(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
    "",
  );
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sameBytes(
  a: Uint8Array | undefined,
  b: Uint8Array | undefined,
): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

/**
 * An OpAMP client for the plain-HTTP transport: it polls, applies the remote
 * config the server offers and reports the result on the next poll. Polling
 * follows the server's heartbeat interval, backs off on errors and honours
 * Retry-After; a 413 is not retried and a 401/403 stops the client.
 */
export class OpampHttpClient {
  private uid: Uint8Array;
  private sequenceNum = 0;
  private status: AgentToServer["remoteConfigStatus"];
  private intervalMs: number;
  private backoffMs = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<void> | null = null;
  private stopped = true;
  private lastPollAt = 0;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpampClientOptions) {
    this.uid = options.instanceUid;
    this.intervalMs = Math.max(
      options.defaultPollIntervalMs ?? 300_000,
      MIN_POLL_INTERVAL_MS,
    );
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    if (options.appliedConfigHash?.length) {
      this.status = {
        lastRemoteConfigHash: options.appliedConfigHash,
        status: RemoteConfigStatus.Applied,
      };
    }
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    void this.poll();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  pollIntervalMs(): number {
    return this.intervalMs;
  }

  millisSinceLastPoll(): number {
    return this.lastPollAt === 0 ? Infinity : Date.now() - this.lastPollAt;
  }

  /** Polls now unless a poll is running or the client is backing off after an error. */
  poll(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    if (this.backoffMs > 0 && this.timer !== null) return Promise.resolve();
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.inFlight = this.exchange().finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  /** Polls with the current description even if a poll is under way, e.g. right after a targeting attribute changed. */
  async refresh(): Promise<void> {
    if (this.inFlight) await this.inFlight;
    await this.poll();
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll();
    }, delayMs);
  }

  private async exchange(): Promise<void> {
    this.lastPollAt = Date.now();
    let response: Response;
    try {
      response = await this.send({
        instanceUid: this.uid,
        sequenceNum: this.sequenceNum++,
        agentDescription: this.options.describe(),
        capabilities: this.options.capabilities,
        remoteConfigStatus: this.status,
        customCapabilities: this.options.customCapabilities,
      });
    } catch {
      this.backOff(null);
      return;
    }

    if (response.status === 401 || response.status === 403) {
      this.stop();
      this.options.onUnauthorized?.();
      return;
    }
    if (response.status === 413) {
      this.backoffMs = 0;
      this.schedule(this.intervalMs);
      return;
    }
    let message: ServerToAgent | null = null;
    try {
      message = decodeServerToAgent(
        new Uint8Array(await response.arrayBuffer()),
      );
    } catch {
      message = null;
    }
    if (
      response.status === 429 ||
      response.status >= 500 ||
      message?.errorResponse?.type === ServerErrorType.Unavailable
    ) {
      const header = Number(response.headers.get("Retry-After"));
      const retryAfter =
        Number.isFinite(header) && header > 0
          ? header * 1000
          : (message?.errorResponse?.retryAfterMs ?? null);
      this.backOff(retryAfter);
      return;
    }
    if (!response.ok || !message) {
      this.backOff(null);
      return;
    }
    if (this.stopped) return;
    this.backoffMs = 0;
    this.handle(message);
  }

  private handle(message: ServerToAgent): void {
    if (message.newInstanceUid?.length === 16) {
      this.uid = message.newInstanceUid;
      this.options.onInstanceUidChange?.(this.uid);
    }
    if (message.heartbeatIntervalSeconds) {
      const next = Math.max(
        message.heartbeatIntervalSeconds * 1000,
        MIN_POLL_INTERVAL_MS,
      );
      if (next !== this.intervalMs) {
        this.intervalMs = next;
        this.options.onHeartbeatChange?.(message.heartbeatIntervalSeconds);
      }
    }

    let reportNow = false;
    if (
      message.remoteConfig &&
      !sameBytes(
        message.remoteConfig.configHash,
        this.status?.lastRemoteConfigHash,
      )
    ) {
      let result: ApplyResult;
      try {
        result = this.options.onRemoteConfig(message.remoteConfig);
      } catch (err) {
        result = {
          applied: false,
          errorMessage: err instanceof Error ? err.message : String(err),
        };
      }
      this.status = result.applied
        ? {
            lastRemoteConfigHash: message.remoteConfig.configHash,
            status: RemoteConfigStatus.Applied,
          }
        : {
            lastRemoteConfigHash: message.remoteConfig.configHash,
            status: RemoteConfigStatus.Failed,
            errorMessage: result.errorMessage,
          };
      reportNow = true;
    }
    // The server answers a poll it cannot evaluate with ReportFullState; this client always sends its full state,
    // so it only needs to poll again. A freshly applied config is reported straight away for the same reason.
    if (
      reportNow ||
      (message.flags & ServerToAgentFlags.ReportFullState) !== 0
    ) {
      this.schedule(0);
      return;
    }
    this.schedule(this.intervalMs);
  }

  private backOff(retryAfterMs: number | null): void {
    this.backoffMs =
      retryAfterMs ??
      Math.min(
        this.backoffMs > 0 ? this.backoffMs * 2 : FIRST_BACKOFF_MS,
        MAX_BACKOFF_MS,
      );
    this.schedule(Math.max(this.backoffMs, 1_000));
  }

  private send(message: AgentToServer): Promise<Response> {
    return this.fetchImpl(this.options.endpoint, {
      method: "POST",
      headers: {
        ...this.options.headers,
        "Content-Type": "application/x-protobuf",
        "OpAMP-Instance-UID": uuidString(this.uid),
      },
      body: encodeAgentToServer(message) as BodyInit,
    });
  }
}
