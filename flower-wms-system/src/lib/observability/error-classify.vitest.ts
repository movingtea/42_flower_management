// Auth.js error classes as shipped by `@auth/core` (re-exported by `next-auth`).
// Importing the `next-auth` entry point in Vitest fails on its `next/server`
// extensionless import, so the canonical upstream module is used here instead.
import { CredentialsSignin, AuthError } from "@auth/core/errors";
import { describe, expect, it } from "vitest";
import { MINIPROGRAM_ERROR_CODES } from "../miniprogram-business-error";
import { MiniprogramBusinessError } from "../miniprogram-business-error";
import {
  assertV2AnyCapability,
  assertV2Capability,
  V2PermissionDeniedError,
} from "../../v2/navigation";
import {
  classifyBusinessCode,
  classifyControlFlowDigest,
  classifyError,
  errorName,
  isAuthJsError,
} from "./error-classify";

/** The E3.6 throttled subclass: a CredentialsSignin with a stable code. */
class LoginThrottledError extends CredentialsSignin {
  code = "too_many_attempts";
}

describe("expected: Auth.js errors", () => {
  it("classifies the real AuthError base class as expected", () => {
    const error = new AuthError("auth is misconfigured");
    expect(isAuthJsError(error)).toBe(true);
    const result = classifyError(error);
    expect(result.kind).toBe("expected");
    expect(result.reason).toBe("auth_rejection");
    expect(result.name).toBe("AuthError");
  });

  it("classifies the real CredentialsSignin class as expected", () => {
    const error = new CredentialsSignin();
    expect(error).toBeInstanceOf(AuthError);
    expect(isAuthJsError(error)).toBe(true);
    expect(classifyError(error)).toMatchObject({
      kind: "expected",
      reason: "auth_rejection",
      name: "CredentialsSignin",
    });
  });

  it("classifies a throttled CredentialsSignin subclass with its stable code", () => {
    const error = new LoginThrottledError();
    const result = classifyError(error);
    expect(result.kind).toBe("expected");
    expect(result.reason).toBe("auth_throttled");
    expect(result.code).toBe("too_many_attempts");
  });

  it("does not treat an ordinary Error as an Auth.js error", () => {
    expect(isAuthJsError(new Error("boom"))).toBe(false);
  });
});

describe("expected: Next.js control flow", () => {
  it("recognises redirect and not-found digests", () => {
    expect(
      classifyError(Object.assign(new Error("redirect"), {
        digest: "NEXT_REDIRECT;replace;/v2;307;",
      })),
    ).toMatchObject({ kind: "expected", reason: "next_redirect" });

    expect(
      classifyError(Object.assign(new Error("not found"), {
        digest: "NEXT_NOT_FOUND",
      })),
    ).toMatchObject({ kind: "expected", reason: "next_not_found" });

    expect(
      classifyError(Object.assign(new Error("fallback"), {
        digest: "NEXT_HTTP_ERROR_FALLBACK;403",
      })),
    ).toMatchObject({ kind: "expected", reason: "next_http_error_fallback" });
  });

  it("classifies invalid digest-like values as system errors", () => {
    expect(
      classifyError(Object.assign(new Error("odd"), { digest: "not-a-next-digest" })),
    ).toMatchObject({ kind: "system", reason: "unclassified" });
  });

  it("exposes stable digest classification helpers", () => {
    expect(classifyControlFlowDigest("NEXT_REDIRECT;push;/login;307;")).toBe("next_redirect");
    expect(classifyControlFlowDigest("NEXT_HTTP_ERROR_FALLBACK;404")).toBe("next_not_found");
    expect(classifyControlFlowDigest("BAILOUT_TO_CLIENT_SIDE_RENDERING")).toBe("next_control_flow");
    expect(classifyControlFlowDigest("abc123")).toBeNull();
  });
});

describe("expected: stable business error codes", () => {
  it("classifies V2 page and action capability denials as expected", () => {
    for (const invoke of [
      () => assertV2Capability(["BUYER"], "order"),
      () => assertV2AnyCapability(["FLORIST"], ["order", "delivery"]),
    ]) {
      let thrown: unknown;
      try {
        invoke();
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(V2PermissionDeniedError);
      expect(classifyError(thrown, { routeType: "render" })).toMatchObject({
        kind: "expected",
        reason: "permission_denied",
        code: "PERMISSION_DENIED",
        name: "V2PermissionDeniedError",
      });
    }
  });

  it("classifies MiniprogramBusinessError by its stable code", () => {
    const stock = new MiniprogramBusinessError(
      MINIPROGRAM_ERROR_CODES.INSUFFICIENT_STOCK,
      "库存不足",
    );
    expect(classifyError(stock)).toMatchObject({
      kind: "expected",
      reason: "business_conflict",
      code: "INSUFFICIENT_STOCK",
      name: "MiniprogramBusinessError",
    });
  });

  it("classifies validation and permission codes", () => {
    for (const code of [
      "VALIDATION_ERROR",
      MINIPROGRAM_ERROR_CODES.INVALID_QUANTITY,
      MINIPROGRAM_ERROR_CODES.INVALID_DELIVERY_DATE,
    ]) {
      expect(classifyError(Object.assign(new Error("input"), { code }))).toMatchObject({
        kind: "expected",
        reason: "validation",
        code,
      });
    }

    expect(
      classifyError(Object.assign(new Error("denied"), {
        code: "PERMISSION_DENIED",
      })),
    ).toMatchObject({ kind: "expected", reason: "permission_denied" });

    expect(
      classifyError(Object.assign(new Error("login"), {
        code: MINIPROGRAM_ERROR_CODES.AUTH_REQUIRED,
      })),
    ).toMatchObject({ kind: "expected", reason: "permission_denied" });
  });

  it("classifies the remaining business codes as controlled conflicts", () => {
    for (const code of [
      "ENTITY_NOT_FOUND",
      "DUPLICATE_KEY",
      "INVALID_STATE_TRANSITION",
      "BUSINESS_RULE_VIOLATION",
      MINIPROGRAM_ERROR_CODES.PRICE_CHANGED,
      MINIPROGRAM_ERROR_CODES.ORDER_INVALID_STATE,
    ]) {
      expect(classifyError(Object.assign(new Error("conflict"), { code }))).toMatchObject({
        kind: "expected",
        reason: "business_conflict",
      });
    }
    expect(classifyBusinessCode(MINIPROGRAM_ERROR_CODES.ORDER_EXPIRED)).toBe(
      "business_conflict",
    );
  });

  it("classifies validation error classes by name", () => {
    expect(classifyError(Object.assign(new Error("bad"), { name: "ValidationError" }))).toMatchObject({
      kind: "expected",
      reason: "validation",
    });
    expect(classifyError(Object.assign(new Error("bad"), { name: "ZodError" }))).toMatchObject({
      kind: "expected",
      reason: "validation",
    });
  });
});

describe("expected: malformed JSON request bodies", () => {
  it("classifies JSON parse errors on route handlers as client input", () => {
    const syntaxError = new SyntaxError(
      "Unexpected token 'x', \"not-json\" is not valid JSON",
    );
    expect(classifyError(syntaxError, { routeType: "route" })).toMatchObject({
      kind: "expected",
      reason: "invalid_request_body",
      name: "SyntaxError",
    });
  });

  it("keeps JSON parse errors outside route handlers as system errors", () => {
    const syntaxError = new SyntaxError("Unexpected token 'x' is not valid JSON");
    expect(classifyError(syntaxError, { routeType: "render" })).toMatchObject({
      kind: "system",
    });
    expect(classifyError(syntaxError)).toMatchObject({ kind: "system" });
  });

  it("does not treat unrelated SyntaxErrors as request body errors", () => {
    expect(
      classifyError(new SyntaxError("Unexpected identifier 'foo'"), { routeType: "route" }),
    ).toMatchObject({ kind: "system" });
  });
});

describe("system errors", () => {
  it("classifies generic, infrastructure and thrown non-Error values as system", () => {
    expect(classifyError(new Error("boom"))).toMatchObject({
      kind: "system",
      reason: "unclassified",
      name: "Error",
    });

    const prisma = Object.assign(
      new Error("Can't reach database server"),
      { name: "PrismaClientInitializationError", code: "P1001" },
    );
    expect(classifyError(prisma)).toMatchObject({
      kind: "system",
      name: "PrismaClientInitializationError",
      code: "P1001",
    });

    expect(classifyError("thrown-string")).toMatchObject({
      kind: "system",
      name: "ThrownValue",
    });
    expect(classifyError(undefined)).toMatchObject({
      kind: "system",
      name: "ThrownValue",
    });
  });
});

describe("errorName", () => {
  it("never falls back to the message", () => {
    expect(errorName(new Error("secret message"))).toBe("Error");
    expect(errorName({ name: "WeirdError" })).toBe("WeirdError");
    expect(errorName({ name: "" })).toBe("ThrownValue");
  });
});
