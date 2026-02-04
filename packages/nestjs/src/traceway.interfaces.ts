import type {
  ModuleMetadata,
  Type,
  InjectionToken,
  OptionalFactoryDependency,
} from "@nestjs/common";

export type ErrorRecordingField = "url" | "query" | "body" | "headers";

export interface TracewayModuleOptions {
  connectionString: string;
  debug?: boolean;
  version?: string;
  serverName?: string;
  sampleRate?: number;
  errorSampleRate?: number;
  ignoredRoutes?: string[];
  onErrorRecording?: ErrorRecordingField[];
}

export interface TracewayOptionsFactory {
  createTracewayOptions():
    | Promise<TracewayModuleOptions>
    | TracewayModuleOptions;
}

export interface TracewayModuleAsyncOptions
  extends Pick<ModuleMetadata, "imports"> {
  useExisting?: Type<TracewayOptionsFactory>;
  useClass?: Type<TracewayOptionsFactory>;
  useFactory?: (
    ...args: unknown[]
  ) => Promise<TracewayModuleOptions> | TracewayModuleOptions;
  inject?: (InjectionToken | OptionalFactoryDependency)[];
}
