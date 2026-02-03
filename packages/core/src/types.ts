export interface ExceptionStackTrace {
  traceId: string | null;
  isTask?: boolean;
  stackTrace: string;
  recordedAt: string;
  attributes?: Record<string, string>;
  isMessage: boolean;
}

export interface MetricRecord {
  name: string;
  value: number;
  recordedAt: string;
}

export interface Span {
  id: string;
  name: string;
  startTime: string;
  duration: number;
}

export interface Trace {
  id: string;
  endpoint: string;
  duration: number;
  recordedAt: string;
  statusCode: number;
  bodySize: number;
  clientIP: string;
  attributes?: Record<string, string>;
  spans?: Span[];
  isTask?: boolean;
}

export interface CollectionFrame {
  stackTraces: ExceptionStackTrace[];
  metrics: MetricRecord[];
  traces: Trace[];
}

export interface ReportRequest {
  collectionFrames: CollectionFrame[];
  appVersion: string;
  serverName: string;
}

export interface TracewayOptions {
  debug?: boolean;
  maxCollectionFrames?: number;
  collectionInterval?: number;
  uploadThrottle?: number;
  metricsInterval?: number;
  version?: string;
  serverName?: string;
  sampleRate?: number;
  errorSampleRate?: number;
}
