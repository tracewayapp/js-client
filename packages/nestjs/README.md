<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo%20White.png" />
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" />
    <img src="https://raw.githubusercontent.com/tracewayapp/traceway/main/Traceway%20Logo.png" alt="Traceway" width="200" />
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@tracewayapp/nestjs"><img src="https://img.shields.io/npm/v/@tracewayapp/nestjs.svg" alt="npm"></a>
  <a href="https://github.com/tracewayapp/traceway-js/blob/main/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License"></a>
</p>

# Traceway NestJS SDK

> **Deprecated.** For new NestJS integrations, use [OpenTelemetry](https://opentelemetry.io/) instead — see the [NestJS OTel guide](https://docs.tracewayapp.com/client/nestjs) and the [OTel overview](https://docs.tracewayapp.com/client/otel). This package will keep receiving security fixes but is no longer the recommended path for new code.

NestJS integration for Traceway. Provides a module, request-tracing middleware, exception filter, an injectable `TracewayService`, and a `@Span` decorator on top of [`@tracewayapp/backend`](https://www.npmjs.com/package/@tracewayapp/backend).

[Traceway](https://tracewayapp.com) is a completely open-source error tracking platform. You can [self-host](https://docs.tracewayapp.com/server) it or use [Traceway Cloud](https://tracewayapp.com).

## Features

- `TracewayModule.forRoot()` / `forRootAsync()` for static or DI-driven configuration
- `TracewayMiddleware` records HTTP method, route, duration, status, and client IP for every request
- `TracewayExceptionFilter` captures unhandled exceptions with full stack traces and (optionally) request URL, query, body, and headers
- Injectable `TracewayService` for manual `captureException` / `captureMetric` / `startSpan` calls
- `@Span("name")` method decorator that auto-wraps the call in a span
- Inherits everything from [`@tracewayapp/backend`](https://www.npmjs.com/package/@tracewayapp/backend): distributed tracing, AsyncLocalStorage context, sampling, gzip transport

## Installation

```bash
npm install @tracewayapp/nestjs
```

## Quick Start

```ts
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";
import {
  TracewayModule,
  TracewayMiddleware,
  TracewayExceptionFilter,
} from "@tracewayapp/nestjs";

@Module({
  imports: [
    TracewayModule.forRoot({
      connectionString: "your-token@https://traceway.example.com/api/report",
      version: "1.0.0",
      onErrorRecording: ["url", "query", "body", "headers"],
    }),
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: TracewayExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TracewayMiddleware).forRoutes("*");
  }
}
```

That's it. Every HTTP request is traced; every uncaught exception is captured with the request context attached.

## Async Configuration

For DI-driven configuration (e.g., reading from `ConfigService`):

```ts
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { TracewayModule } from "@tracewayapp/nestjs";

@Module({
  imports: [
    ConfigModule.forRoot(),
    TracewayModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connectionString: config.get("TRACEWAY_CONNECTION_STRING"),
        debug: config.get("NODE_ENV") !== "production",
      }),
      inject: [ConfigService],
    }),
  ],
})
export class AppModule {}
```

## Manual Capture

Inject `TracewayService` to capture errors and create spans manually:

```ts
import { Injectable } from "@nestjs/common";
import { TracewayService, Span } from "@tracewayapp/nestjs";

@Injectable()
export class UsersService {
  constructor(private readonly traceway: TracewayService) {}

  @Span("db.users.findAll")
  async findAll() {
    return this.userRepository.find();
  }

  async createUser(data: CreateUserDto) {
    const span = this.traceway.startSpan("db.users.create");
    try {
      return await this.userRepository.save(data);
    } finally {
      this.traceway.endSpan(span);
    }
  }

  async riskyOperation() {
    try {
      await this.externalApi.call();
    } catch (error) {
      this.traceway.captureException(error);
      throw error;
    }
  }

  recordMetrics() {
    this.traceway.captureMetric("request.duration", 150);
    this.traceway.captureMetricWithTags("request.duration", 150, {
      region: "us-east",
      service: "users",
    });
  }
}
```

## What Gets Captured Automatically

| Data | Description |
|------|-------------|
| **Endpoint** | HTTP method and route (e.g., `GET /users/:id`) |
| **Duration** | Request processing time in ms |
| **Status code** | HTTP response status |
| **Client IP** | From `X-Forwarded-For` / `X-Real-IP` headers, falling back to socket |
| **Exceptions** | Unhandled errors with full stack traces |
| **Spans** | All `@Span("name")`-decorated method calls and manual `startSpan` invocations within the request |

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `connectionString` | — | Traceway connection string (`token@url`) |
| `debug` | `false` | Enable debug logging |
| `version` | `""` | Application version |
| `serverName` | hostname | Server identifier |
| `sampleRate` | `1.0` | Normal trace sampling rate (0.0-1.0) |
| `errorSampleRate` | `1.0` | Error trace sampling rate (0.0-1.0) |
| `ignoredRoutes` | `[]` | Routes to exclude from tracing |
| `onErrorRecording` | `[]` | Request data to attach on errors (`"url"`, `"query"`, `"body"`, `"headers"`) |

## Platform Support

| Environment | Status |
|---|---|
| NestJS ≥ 10 on Node.js ≥ 18 | Yes |
| NestJS Fastify adapter | Yes |
| Cloudflare Workers / Edge runtimes | No — use OTel instead |

## Migration to OpenTelemetry

For new code, prefer OTel — it has first-class NestJS support and is what the Traceway dashboard treats as a first-class citizen. The Traceway backend ingests OTLP/HTTP traces, metrics, and logs at `/api/otel/v1/{traces,metrics,logs}`. See the [NestJS OTel guide](https://docs.tracewayapp.com/client/nestjs) for the recommended setup.

## Links

- [Traceway Website](https://tracewayapp.com)
- [Traceway GitHub](https://github.com/tracewayapp/traceway)
- [Documentation](https://docs.tracewayapp.com)
- [Node.js SDK](https://www.npmjs.com/package/@tracewayapp/backend)
- [OpenTelemetry](https://opentelemetry.io/)

## License

MIT
