import { describe, it, expect, vi } from "vitest";
import { requestIdMiddleware } from "../middleware/request-id";
import type { AuthenticatedRequest } from "../types";
import type { Response, NextFunction } from "express";

function mockRequest(headers: Record<string, string> = {}): AuthenticatedRequest {
  return {
    headers,
  } as AuthenticatedRequest;
}

function mockResponse(): Response {
  const res = {
    setHeader: vi.fn(),
  };
  return res as unknown as Response;
}

describe("request-id middleware", () => {
  it("generates a UUID when no X-Request-ID header is present", () => {
    const req = mockRequest();
    const res = mockResponse();
    const next: NextFunction = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", req.requestId);
    expect(next).toHaveBeenCalled();
  });

  it("uses the inbound X-Request-ID header when present", () => {
    const req = mockRequest({ "x-request-id": "client-req-123" });
    const res = mockResponse();
    const next: NextFunction = vi.fn();

    requestIdMiddleware(req, res, next);

    expect(req.requestId).toBe("client-req-123");
    expect(res.setHeader).toHaveBeenCalledWith("X-Request-ID", "client-req-123");
    expect(next).toHaveBeenCalled();
  });
});
