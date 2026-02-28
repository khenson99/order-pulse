import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAuthMiddleware, type AuthDependencies } from "../middleware/auth";
import type { AuthenticatedRequest } from "../types";
import type { Response, NextFunction } from "express";

function mockRequest(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    headers: {},
    requestId: "test-request-id",
    path: "/api/onboarding/session",
    method: "GET",
    ...overrides,
  } as AuthenticatedRequest;
}

function mockResponse(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

function createMockDeps(overrides: Partial<AuthDependencies> = {}): AuthDependencies {
  return {
    accessTokenVerifier: {
      verify: vi.fn().mockResolvedValue({ sub: "user-123", token_use: "access" }),
    },
    idTokenVerifier: {
      verify: vi.fn().mockResolvedValue({
        sub: "user-123",
        email: "test@example.com",
        "custom:tenant": "tenant-abc",
      }),
    },
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as AuthDependencies["logger"],
    ...overrides,
  };
}

describe("auth middleware", () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it("returns 401 when Authorization header is missing", async () => {
    const deps = createMockDeps();
    const middleware = createAuthMiddleware(deps);
    const req = mockRequest({
      headers: { "x-id-token": "some-id-token" } as any,
    });
    const res = mockResponse();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "AUTH_MISSING_TOKEN",
        message: "Authorization Bearer token and X-ID-Token headers are required",
        requestId: "test-request-id",
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when X-ID-Token header is missing", async () => {
    const deps = createMockDeps();
    const middleware = createAuthMiddleware(deps);
    const req = mockRequest({
      headers: { authorization: "Bearer some-access-token" } as any,
    });
    const res = mockResponse();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "AUTH_MISSING_TOKEN",
        message: "Authorization Bearer token and X-ID-Token headers are required",
        requestId: "test-request-id",
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when access token verification fails", async () => {
    const deps = createMockDeps({
      accessTokenVerifier: {
        verify: vi.fn().mockRejectedValue(new Error("Invalid signature")),
      },
    });
    const middleware = createAuthMiddleware(deps);
    const req = mockRequest({
      headers: {
        authorization: "Bearer bad-token",
        "x-id-token": "some-id-token",
      } as any,
    });
    const res = mockResponse();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "AUTH_INVALID_TOKEN",
        message: "Invalid or expired access token",
        requestId: "test-request-id",
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 with AUTH_EXPIRED_TOKEN when token is expired", async () => {
    const deps = createMockDeps({
      accessTokenVerifier: {
        verify: vi.fn().mockRejectedValue(new Error("Token expired at 2024-01-01")),
      },
    });
    const middleware = createAuthMiddleware(deps);
    const req = mockRequest({
      headers: {
        authorization: "Bearer expired-token",
        "x-id-token": "some-id-token",
      } as any,
    });
    const res = mockResponse();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "AUTH_EXPIRED_TOKEN",
        message: "Invalid or expired access token",
        requestId: "test-request-id",
      },
    });
  });

  it("returns 401 when ID token verification fails", async () => {
    const deps = createMockDeps({
      idTokenVerifier: {
        verify: vi.fn().mockRejectedValue(new Error("Bad ID token")),
      },
    });
    const middleware = createAuthMiddleware(deps);
    const req = mockRequest({
      headers: {
        authorization: "Bearer good-token",
        "x-id-token": "bad-id-token",
      } as any,
    });
    const res = mockResponse();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "AUTH_INVALID_TOKEN",
        message: "Invalid ID token",
        requestId: "test-request-id",
      },
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 401 when ID token is missing sub claim", async () => {
    const deps = createMockDeps({
      idTokenVerifier: {
        verify: vi.fn().mockResolvedValue({
          email: "test@example.com",
          "custom:tenant": "tenant-abc",
        }),
      },
    });
    const middleware = createAuthMiddleware(deps);
    const req = mockRequest({
      headers: {
        authorization: "Bearer good-token",
        "x-id-token": "missing-sub-token",
      } as any,
    });
    const res = mockResponse();

    await middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: {
        code: "AUTH_INVALID_TOKEN",
        message: "ID token missing sub claim",
        requestId: "test-request-id",
      },
    });
  });

  it("attaches auth context and calls next on valid tokens", async () => {
    const deps = createMockDeps();
    const middleware = createAuthMiddleware(deps);
    const req = mockRequest({
      headers: {
        authorization: "Bearer valid-access-token",
        "x-id-token": "valid-id-token",
      } as any,
    });
    const res = mockResponse();

    await middleware(req, res, next);

    expect(req.auth).toEqual({
      sub: "user-123",
      email: "test@example.com",
      tenantId: "tenant-abc",
    });
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it("handles missing custom:tenant gracefully (empty string)", async () => {
    const deps = createMockDeps({
      idTokenVerifier: {
        verify: vi.fn().mockResolvedValue({
          sub: "user-456",
          email: "user@example.com",
        }),
      },
    });
    const middleware = createAuthMiddleware(deps);
    const req = mockRequest({
      headers: {
        authorization: "Bearer valid-token",
        "x-id-token": "valid-id-token",
      } as any,
    });
    const res = mockResponse();

    await middleware(req, res, next);

    expect(req.auth).toEqual({
      sub: "user-456",
      email: "user@example.com",
      tenantId: "",
    });
    expect(next).toHaveBeenCalled();
  });
});
