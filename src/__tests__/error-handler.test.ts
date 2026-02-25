import { describe, it, expect, vi, beforeEach } from "vitest";
import { createErrorHandler } from "../middleware/error-handler";
import type { Request, Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types";
import { ApiError } from "../types";

function mockRequest(requestId: string = "test-req-id"): Request {
  return {
    path: "/api/onboarding/session",
    requestId,
  } as unknown as Request;
}

function mockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe("error handler middleware", () => {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as any;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns stable 500 error shape", () => {
    const handler = createErrorHandler(logger);
    const err = new Error("Something went wrong");
    const req = mockRequest();
    const res = mockResponse();
    const next: NextFunction = vi.fn();

    handler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred",
        requestId: "test-req-id",
      },
    });
  });

  it("does not leak error details to client", () => {
    const handler = createErrorHandler(logger);
    const err = new Error("Database password is hunter2");
    const req = mockRequest();
    const res = mockResponse();
    const next: NextFunction = vi.fn();

    handler(err, req, res, next);

    const body = (res.json as any).mock.calls[0][0];
    expect(body.error.message).not.toContain("hunter2");
    expect(body.error.message).toBe("An unexpected error occurred");
  });

  it("logs the full error with stack trace", () => {
    const handler = createErrorHandler(logger);
    const err = new Error("DB connection failed");
    const req = mockRequest();
    const res = mockResponse();
    const next: NextFunction = vi.fn();

    handler(err, req, res, next);

    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "test-req-id",
        error: "DB connection failed",
        stack: expect.any(String),
      }),
      "Unhandled error",
    );
  });

  it("uses 'unknown' when requestId is missing", () => {
    const handler = createErrorHandler(logger);
    const err = new Error("oops");
    const req = { path: "/test" } as Request;
    const res = mockResponse();
    const next: NextFunction = vi.fn();

    handler(err, req, res, next);

    const body = (res.json as any).mock.calls[0][0];
    expect(body.error.requestId).toBe("unknown");
  });

  it("returns ApiError status code and error code", () => {
    const handler = createErrorHandler(logger);
    const err = new ApiError(404, "NOT_FOUND", "Session not found");
    const req = mockRequest();
    const res = mockResponse();
    const next: NextFunction = vi.fn();

    handler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "NOT_FOUND",
        message: "Session not found",
        requestId: "test-req-id",
      },
    });
  });

  it("returns ApiError for validation errors", () => {
    const handler = createErrorHandler(logger);
    const err = new ApiError(422, "VALIDATION_ERROR", "Invalid content type");
    const req = mockRequest();
    const res = mockResponse();
    const next: NextFunction = vi.fn();

    handler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "VALIDATION_ERROR",
        message: "Invalid content type",
        requestId: "test-req-id",
      },
    });
  });

  it("logs ApiError at warn level (not error)", () => {
    const handler = createErrorHandler(logger);
    const err = new ApiError(404, "NOT_FOUND", "Session not found");
    const req = mockRequest();
    const res = mockResponse();
    const next: NextFunction = vi.fn();

    handler(err, req, res, next);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "test-req-id",
        code: "NOT_FOUND",
        error: "Session not found",
      }),
      "API error",
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});
