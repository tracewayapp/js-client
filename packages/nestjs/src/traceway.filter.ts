import {
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import { BaseExceptionFilter } from "@nestjs/core";
import type { Request, Response } from "express";
import {
  captureExceptionWithAttributes,
  getTraceId,
  getTraceContext,
} from "@traceway/backend";
import { TRACEWAY_MODULE_OPTIONS } from "./traceway.constants.js";
import type { TracewayModuleOptions } from "./traceway.interfaces.js";

const BODY_LIMIT = 64 * 1024;

@Catch()
export class TracewayExceptionFilter extends BaseExceptionFilter {
  constructor(
    @Inject(TRACEWAY_MODULE_OPTIONS)
    private readonly options: TracewayModuleOptions,
  ) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500 || !(exception instanceof HttpException)) {
      this.captureError(exception, request);
    }

    if (exception instanceof Error) {
      super.catch(exception, host);
    } else {
      response.status(status).json({
        statusCode: status,
        message: "Internal server error",
      });
    }
  }

  private captureError(exception: unknown, request: Request): void {
    const error =
      exception instanceof Error ? exception : new Error(String(exception));

    const attributes: Record<string, string> = {};
    const traceCtx = getTraceContext();

    if (traceCtx?.attributes) {
      Object.assign(attributes, traceCtx.attributes);
    }

    attributes["user agent"] = request.get("user-agent") || "";

    const recordingFields = this.options.onErrorRecording || [];

    if (recordingFields.includes("url")) {
      attributes["url"] = request.path;
    }

    if (recordingFields.includes("query")) {
      const query = request.query;
      if (Object.keys(query).length > 0) {
        attributes["query"] = JSON.stringify(query);
      }
    }

    if (recordingFields.includes("body")) {
      const contentType = request.get("content-type") || "";
      if (contentType.includes("application/json") && request.body) {
        const bodyStr = JSON.stringify(request.body);
        attributes["body"] = bodyStr.slice(0, BODY_LIMIT);
      }
    }

    if (recordingFields.includes("headers")) {
      const headers = { ...request.headers };
      delete headers["authorization"];
      delete headers["cookie"];
      attributes["headers"] = JSON.stringify(headers);
    }

    const traceId = getTraceId();
    captureExceptionWithAttributes(error, attributes, traceId);
  }
}
