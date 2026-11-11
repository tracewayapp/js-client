import type { Mode } from "@tracewayapp/core";
import { SessionRecorder } from "../session-recorder.js";
import type { SessionManager } from "../session/session-manager.js";
import type {
  RecordingSegment,
  RecordingsTransport,
} from "../transport/recordings.js";

interface BufferedSegment {
  segment: RecordingSegment;
  endedAtMs: number;
  bytes: number;
}

export interface ReplayApplyOptions {
  maskAllInputs: boolean;
  /** Whether this session falls inside `replay.sessionSampleRate`; sessions outside it never stream. */
  sessionSampled: boolean;
  maxBytes: number;
  maxAgeMs: number;
}

/**
 * Runs rrweb according to the replay mode: `stream` uploads every completed
 * segment, `buffer` keeps recent segments on the device until a trigger or
 * capture flushes them, `off` stops recording and forgets what was kept.
 */
export class ReplayController {
  private readonly recorder: SessionRecorder;
  lastFlushSegments = 0;
  private mode: Mode = "off";
  private maskAllInputs = true;
  private buffered: BufferedSegment[] = [];
  private bufferedBytes = 0;
  private maxBytes = 8 * 1024 * 1024;
  private maxAgeMs = 600_000;
  /** Index already given to the in-progress segment, because part of it was uploaded as a clip. */
  private currentIndex: number | null = null;

  constructor(
    private readonly session: SessionManager,
    private readonly transport: RecordingsTransport,
    segmentDuration?: number,
  ) {
    this.recorder = new SessionRecorder({
      segmentDuration,
      onSegmentReady: (segment) => this.handleSegment(segment, false),
    });
  }

  currentMode(): Mode {
    return this.mode;
  }

  apply(mode: Mode, options: ReplayApplyOptions): void {
    this.maxBytes = options.maxBytes;
    this.maxAgeMs = options.maxAgeMs;
    const effective: Mode =
      mode === "stream" && !options.sessionSampled ? "buffer" : mode;
    if (effective === "off" || this.maskAllInputs !== options.maskAllInputs) {
      this.transport.discard();
      this.recorder.stop();
      this.buffered = [];
      this.bufferedBytes = 0;
      this.currentIndex = null;
    }
    this.maskAllInputs = options.maskAllInputs;
    if (effective !== "off" && !this.recorder.isRecording()) {
      void this.recorder
        .start({ maskAllInputs: options.maskAllInputs })
        .catch(() => undefined);
    }
    if (effective === "stream" && this.mode !== "stream") {
      this.currentIndex = null;
      this.recorder.startFresh();
    }
    this.mode = effective;
    this.trim();
  }

  /**
   * Uploads the buffered segments that ended within the lookback window and
   * the in-progress segment as it stands, tagged as the clip of `exceptionId`.
   */
  flush(lookbackMs: number, exceptionId?: string, unloading = false): void {
    this.lastFlushSegments = 0;
    if (this.mode === "off") return;
    this.trim();
    const since = Date.now() - lookbackMs;
    const out: RecordingSegment[] = [];
    const kept: BufferedSegment[] = [];
    for (const entry of this.buffered) {
      if (entry.endedAtMs >= since) {
        out.push({ ...entry.segment, ...(exceptionId ? { exceptionId } : {}) });
      }
      kept.push(entry);
    }
    this.buffered = kept;

    const partial = this.recorder.peekCurrent();
    if (partial) {
      const session = this.session.current();
      const segment: RecordingSegment = {
        events: partial.events,
        startedAt: partial.startedAt,
        endedAt: partial.endedAt,
      };
      if (session) {
        this.currentIndex ??= this.session.nextSegmentIndex();
        segment.sessionId = session.id;
        segment.segmentIndex = this.currentIndex;
      }
      if (exceptionId) segment.exceptionId = exceptionId;
      if (segment.sessionId || segment.exceptionId) out.push(segment);
    }
    if (out.length > 0)
      this.lastFlushSegments = this.transport.send(out, { unloading });
  }

  /** The session ended: the in-progress segment is closed out under it. */
  onSessionEnd(unloading: boolean): void {
    const drained = this.recorder.drainCurrent();
    if (drained) this.handleSegment(drained, unloading);
    this.currentIndex = null;
  }

  onSessionStart(): void {
    this.currentIndex = null;
    this.recorder.startFresh();
  }

  /** The page was hidden and may never come back: a streaming segment leaves while it still can. */
  onHidden(): void {
    if (this.mode !== "stream") return;
    const drained = this.recorder.drainCurrent();
    if (drained) this.handleSegment(drained, true);
  }

  onVisible(): void {
    if (this.mode === "stream") this.recorder.startFresh();
  }

  stop(): void {
    this.recorder.stop();
  }

  private handleSegment(
    segment: { events: unknown[]; startedAt: string; endedAt: string },
    unloading: boolean,
  ): void {
    const session = this.session.current();
    if (!session || segment.events.length === 0) return;
    const index = this.currentIndex ?? this.session.nextSegmentIndex();
    this.currentIndex = null;
    const payload: RecordingSegment = {
      sessionId: session.id,
      segmentIndex: index,
      events: segment.events,
      startedAt: segment.startedAt,
      endedAt: segment.endedAt,
    };

    if (this.mode === "stream") {
      this.transport.send([payload], { unloading });
      return;
    }
    if (this.mode === "buffer") {
      const bytes = estimateSegmentBytes(payload);
      this.buffered.push({
        segment: payload,
        endedAtMs: Date.parse(segment.endedAt) || Date.now(),
        bytes,
      });
      this.bufferedBytes += bytes;
      this.trim();
    }
  }

  private trim(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    while (
      this.buffered.length > 0 &&
      (this.bufferedBytes > this.maxBytes ||
        this.buffered[0]!.endedAtMs < cutoff)
    ) {
      this.bufferedBytes -= this.buffered.shift()!.bytes;
    }
  }
}

function estimateSegmentBytes(segment: RecordingSegment): number {
  try {
    return new TextEncoder().encode(JSON.stringify(segment)).byteLength;
  } catch {
    return 64 * 1024;
  }
}
