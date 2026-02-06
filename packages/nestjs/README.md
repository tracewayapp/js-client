# @tracewayapp/nestjs

NestJS integration for Traceway. Provides a module, middleware, exception filter, service, and decorators for request tracing and error capture.

## Installation

```bash
npm install @tracewayapp/nestjs
```

## Setup

### 1. Import TracewayModule

Add `TracewayModule.forRoot()` to your app module:

```typescript
import { Module } from "@nestjs/common";
import { TracewayModule } from "@tracewayapp/nestjs";

@Module({
  imports: [
    TracewayModule.forRoot({
      connectionString: "your-token@https://traceway.example.com/api/report",
    }),
  ],
})
export class AppModule {}
```

### 2. Add Middleware for Request Tracing

Apply `TracewayMiddleware` to trace all HTTP requests:

```typescript
import { MiddlewareConsumer, Module, NestModule } from "@nestjs/common";
import { TracewayModule, TracewayMiddleware } from "@tracewayapp/nestjs";

@Module({
  imports: [
    TracewayModule.forRoot({
      connectionString: "your-token@https://traceway.example.com/api/report",
    }),
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TracewayMiddleware).forRoutes("*");
  }
}
```

### 3. Add Exception Filter

Register `TracewayExceptionFilter` globally to capture unhandled exceptions:

```typescript
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
      debug: true,
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

## TracewayService

Inject `TracewayService` to capture errors and create spans manually:

```typescript
import { Injectable } from "@nestjs/common";
import { TracewayService, Span } from "@tracewayapp/nestjs";

@Injectable()
export class UsersService {
  constructor(private readonly traceway: TracewayService) {}

  @Span("db.users.findAll")
  async findAll() {
    // Span automatically created and ended
    return this.userRepository.find();
  }

  async createUser(data: CreateUserDto) {
    const span = this.traceway.startSpan("db.users.create");
    try {
      const user = await this.userRepository.save(data);
      return user;
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
}
```

## @Span Decorator

Automatically creates and ends a span for a method:

```typescript
import { Span } from "@tracewayapp/nestjs";

@Span("operation-name")
async myMethod() {
  // span is created on entry and ended on return
}
```

## Async Configuration

Use `forRootAsync` for dynamic configuration (e.g., from `ConfigService`):

```typescript
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

## What Gets Captured

| Data | Description |
|------|-------------|
| Endpoint | HTTP method and route (e.g., `GET /users/:id`) |
| Duration | Request processing time |
| Status Code | HTTP response status |
| Client IP | Client IP address from headers or socket |
| Exceptions | Unhandled errors with full stack traces |
| Spans | Custom spans created within the request |

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `connectionString` | `string` | — | Traceway connection string (`token@url`) |
| `debug` | `boolean` | `false` | Enable debug logging |
| `version` | `string` | `""` | Application version |
| `serverName` | `string` | hostname | Server identifier |
| `sampleRate` | `number` | `1.0` | Normal trace sampling rate (0.0-1.0) |
| `errorSampleRate` | `number` | `1.0` | Error trace sampling rate (0.0-1.0) |
| `ignoredRoutes` | `string[]` | `[]` | Routes to exclude from tracing |
| `onErrorRecording` | `ErrorRecordingField[]` | `[]` | Request data to include on errors (`"url"`, `"query"`, `"body"`, `"headers"`) |

## Requirements

- NestJS >= 10
- `@tracewayapp/backend` (installed automatically as dependency)
