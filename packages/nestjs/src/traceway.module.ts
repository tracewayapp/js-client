import {
  DynamicModule,
  Global,
  Module,
  OnModuleDestroy,
  Provider,
} from "@nestjs/common";
import { TRACEWAY_MODULE_OPTIONS } from "./traceway.constants.js";
import type {
  TracewayModuleOptions,
  TracewayModuleAsyncOptions,
  TracewayOptionsFactory,
} from "./traceway.interfaces.js";
import { TracewayService } from "./traceway.service.js";

@Global()
@Module({})
export class TracewayModule implements OnModuleDestroy {
  constructor(private readonly tracewayService: TracewayService) {}

  static forRoot(options: TracewayModuleOptions): DynamicModule {
    const optionsProvider: Provider = {
      provide: TRACEWAY_MODULE_OPTIONS,
      useValue: options,
    };

    return {
      module: TracewayModule,
      providers: [
        optionsProvider,
        TracewayService,
        {
          provide: "TRACEWAY_INIT",
          useFactory: (service: TracewayService) => {
            service.initialize();
            return true;
          },
          inject: [TracewayService],
        },
      ],
      exports: [TracewayService, TRACEWAY_MODULE_OPTIONS],
    };
  }

  static forRootAsync(options: TracewayModuleAsyncOptions): DynamicModule {
    const asyncProviders = this.createAsyncProviders(options);

    return {
      module: TracewayModule,
      imports: options.imports || [],
      providers: [
        ...asyncProviders,
        TracewayService,
        {
          provide: "TRACEWAY_INIT",
          useFactory: (service: TracewayService) => {
            service.initialize();
            return true;
          },
          inject: [TracewayService],
        },
      ],
      exports: [TracewayService, TRACEWAY_MODULE_OPTIONS],
    };
  }

  private static createAsyncProviders(
    options: TracewayModuleAsyncOptions,
  ): Provider[] {
    if (options.useExisting || options.useFactory) {
      return [this.createAsyncOptionsProvider(options)];
    }

    if (options.useClass) {
      return [
        this.createAsyncOptionsProvider(options),
        {
          provide: options.useClass,
          useClass: options.useClass,
        },
      ];
    }

    return [];
  }

  private static createAsyncOptionsProvider(
    options: TracewayModuleAsyncOptions,
  ): Provider {
    if (options.useFactory) {
      return {
        provide: TRACEWAY_MODULE_OPTIONS,
        useFactory: options.useFactory,
        inject: options.inject || [],
      };
    }

    const inject = options.useExisting || options.useClass;
    if (!inject) {
      throw new Error(
        "TracewayModule: useExisting, useClass, or useFactory must be provided",
      );
    }

    return {
      provide: TRACEWAY_MODULE_OPTIONS,
      useFactory: async (optionsFactory: TracewayOptionsFactory) =>
        optionsFactory.createTracewayOptions(),
      inject: [inject],
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.tracewayService.shutdownAsync();
  }
}
