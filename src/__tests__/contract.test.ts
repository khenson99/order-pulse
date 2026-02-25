import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";
import { parse } from "yaml";
import type { ErrorCode } from "../types";
import { ApiError } from "../types";

const CONTRACT_PATH = resolve(__dirname, "../../docs/api-contract.yaml");
const contract = parse(readFileSync(CONTRACT_PATH, "utf-8"));

describe("API contract", () => {
  it("parses as valid OpenAPI 3.1.0", () => {
    expect(contract.openapi).toBe("3.1.0");
    expect(contract.info.title).toBeTruthy();
    expect(contract.info.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("has a semver version", () => {
    const [major, minor, patch] = contract.info.version.split(".").map(Number);
    expect(major).toBeGreaterThanOrEqual(1);
    expect(minor).toBeGreaterThanOrEqual(0);
    expect(patch).toBeGreaterThanOrEqual(0);
  });

  describe("error codes", () => {
    const specErrorCodes: string[] =
      contract.components.schemas.ErrorResponse.properties.error.properties.code.enum;

    // The TypeScript ErrorCode union — kept in sync manually.
    // If you add a code to TypeScript, add it here too.
    const tsErrorCodes: ErrorCode[] = [
      "AUTH_MISSING_TOKEN",
      "AUTH_INVALID_TOKEN",
      "AUTH_EXPIRED_TOKEN",
      "VALIDATION_ERROR",
      "NOT_FOUND",
      "INTERNAL_ERROR",
    ];

    it("spec error codes match TypeScript ErrorCode union", () => {
      expect([...specErrorCodes].sort()).toEqual([...tsErrorCodes].sort());
    });

    it("every spec error code is UPPER_SNAKE_CASE", () => {
      for (const code of specErrorCodes) {
        expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/);
      }
    });
  });

  describe("ErrorResponse schema shape", () => {
    const errorSchema = contract.components.schemas.ErrorResponse;

    it("requires error object", () => {
      expect(errorSchema.required).toContain("error");
    });

    it("error object requires code, message, requestId", () => {
      const errorObj = errorSchema.properties.error;
      expect(errorObj.required).toEqual(
        expect.arrayContaining(["code", "message", "requestId"]),
      );
    });

    it("requestId has uuid format", () => {
      const requestIdSchema =
        errorSchema.properties.error.properties.requestId;
      expect(requestIdSchema.format).toBe("uuid");
    });
  });

  describe("security", () => {
    it("defines cognitoBearer and cognitoIdToken schemes", () => {
      const schemes = contract.components.securitySchemes;
      expect(schemes.cognitoBearer).toBeDefined();
      expect(schemes.cognitoBearer.type).toBe("http");
      expect(schemes.cognitoBearer.scheme).toBe("bearer");
      expect(schemes.cognitoIdToken).toBeDefined();
      expect(schemes.cognitoIdToken.type).toBe("apiKey");
      expect(schemes.cognitoIdToken.name).toBe("X-ID-Token");
    });

    it("applies default security globally", () => {
      expect(contract.security).toEqual([
        { cognitoBearer: [], cognitoIdToken: [] },
      ]);
    });

    it("health endpoint opts out of auth", () => {
      const healthGet = contract.paths["/health"].get;
      expect(healthGet.security).toEqual([]);
    });
  });

  describe("response consistency", () => {
    const paths = contract.paths;

    it("all authenticated endpoints reference 401 Unauthorized", () => {
      for (const [path, methods] of Object.entries(paths) as [string, any][]) {
        for (const [method, spec] of Object.entries(methods) as [string, any][]) {
          // Skip health endpoints (no auth)
          if (spec.security && spec.security.length === 0) continue;

          const responses = spec.responses;
          if (!responses) continue;

          // If it has any response besides 200/201, it should have 401
          const statusCodes = Object.keys(responses);
          if (statusCodes.some((s) => s !== "200" && s !== "201")) {
            expect(responses["401"]).toBeDefined();
          }
        }
      }
    });

    it("all authenticated endpoints reference 500 InternalError", () => {
      for (const [path, methods] of Object.entries(paths) as [string, any][]) {
        for (const [method, spec] of Object.entries(methods) as [string, any][]) {
          if (spec.security && spec.security.length === 0) continue;

          const responses = spec.responses;
          if (!responses) continue;

          const statusCodes = Object.keys(responses);
          if (statusCodes.some((s) => s !== "200" && s !== "201")) {
            expect(responses["500"]).toBeDefined();
          }
        }
      }
    });
  });

  describe("response examples use valid error codes", () => {
    const specErrorCodes: string[] =
      contract.components.schemas.ErrorResponse.properties.error.properties.code.enum;

    const responseDefs = contract.components.responses;

    for (const [name, responseDef] of Object.entries(responseDefs) as [string, any][]) {
      const content = responseDef.content?.["application/json"];
      if (!content) continue;

      if (content.examples) {
        for (const [exName, ex] of Object.entries(content.examples) as [string, any][]) {
          it(`${name}.${exName} example uses valid error code`, () => {
            expect(specErrorCodes).toContain(ex.value.error.code);
          });
        }
      }

      if (content.example) {
        it(`${name} example uses valid error code`, () => {
          expect(specErrorCodes).toContain(content.example.error.code);
        });
      }
    }
  });
});

describe("ApiError", () => {
  it("carries statusCode, code, and message", () => {
    const err = new ApiError(404, "NOT_FOUND", "Session not found");
    expect(err.statusCode).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Session not found");
    expect(err.name).toBe("ApiError");
    expect(err).toBeInstanceOf(Error);
  });

  it("can be constructed with VALIDATION_ERROR", () => {
    const err = new ApiError(422, "VALIDATION_ERROR", "Invalid field");
    expect(err.statusCode).toBe(422);
    expect(err.code).toBe("VALIDATION_ERROR");
  });
});
