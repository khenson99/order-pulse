import type { Request } from "express";

export interface AuthContext {
  sub: string;
  email: string;
  tenantId: string;
}

export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
  requestId: string;
}

export type ErrorCode =
  | "AUTH_MISSING_TOKEN"
  | "AUTH_INVALID_TOKEN"
  | "AUTH_EXPIRED_TOKEN"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export interface ErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    requestId: string;
  };
}

export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
