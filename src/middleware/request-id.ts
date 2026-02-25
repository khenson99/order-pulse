import { Response, NextFunction } from "express";
import { randomUUID } from "crypto";
import type { AuthenticatedRequest } from "../types";

export function requestIdMiddleware(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction,
) {
  const requestId =
    (req.headers["x-request-id"] as string) || randomUUID();
  req.requestId = requestId;
  res.setHeader("X-Request-ID", requestId);
  next();
}
