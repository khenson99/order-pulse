import { Request, Response, NextFunction } from "express";
import type { ErrorBody, AuthenticatedRequest } from "../types";
import { ApiError } from "../types";
import type { Logger } from "../lib/logger";

export function createErrorHandler(logger: Logger) {
  return (
    err: Error,
    req: Request,
    res: Response,
    _next: NextFunction,
  ) => {
    const requestId = (req as AuthenticatedRequest).requestId ?? "unknown";

    if (err instanceof ApiError) {
      logger.warn(
        { requestId, code: err.code, error: err.message, path: req.path },
        "API error",
      );

      if (err.statusCode === 429) {
        res.setHeader("Retry-After", "10");
      }

      const body: ErrorBody = {
        error: {
          code: err.code,
          message: err.message,
          requestId,
        },
      };

      res.status(err.statusCode).json(body);
      return;
    }

    logger.error(
      { requestId, error: err.message, stack: err.stack, path: req.path },
      "Unhandled error",
    );

    const body: ErrorBody = {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId,
      },
    };

    res.status(500).json(body);
  };
}
