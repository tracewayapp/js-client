import { Inject, Injectable, NestMiddleware } from "@nestjs/common";
import type { Request, Response, NextFunction } from "express";
import {
  withTraceContext,
  setTraceResponseInfo,
  captureCurrentTrace,
} from "@tracewayapp/backend";
import { TRACEWAY_MODULE_OPTIONS } from "./traceway.constants.js";
import type { TracewayModuleOptions } from "./traceway.interfaces.js";

@Injectable()
export class TracewayMiddleware implements NestMiddleware {
  constructor(
    @Inject(TRACEWAY_MODULE_OPTIONS)
    private readonly options: TracewayModuleOptions,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const routePath = req.route?.path || req.path;

    if (this.options.ignoredRoutes?.includes(routePath)) {
      return next();
    }

    const endpoint = `${req.method} ${routePath}`;
    const clientIP = this.getClientIP(req);

    withTraceContext({ endpoint, clientIP }, () => {
      res.on("finish", () => {
        const bodySize = parseInt(res.get("content-length") || "0", 10);
        setTraceResponseInfo(res.statusCode, bodySize);
        captureCurrentTrace();
      });

      next();
    });
  }

  private getClientIP(req: Request): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") {
      return forwarded.split(",")[0].trim();
    }
    if (Array.isArray(forwarded)) {
      return forwarded[0];
    }
    return req.ip || req.socket.remoteAddress || "";
  }
}
