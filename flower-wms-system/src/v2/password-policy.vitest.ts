import { describe, expect, it } from "vitest";
import {
  KNOWN_DEFAULT_PASSWORD_CANDIDATES,
  V2_BOOTSTRAP_PASSWORD_MIN_LENGTH,
  V2_PASSWORD_MAX_BYTES,
  V2_PASSWORD_MIN_UNIQUE_CHARS,
  V2_STAFF_RESET_PASSWORD_MIN_LENGTH,
  evaluateV2PasswordChange,
  isStrongV2Password,
} from "./password-policy";

function distinctCjk(count: number): string {
  return Array.from({ length: count }, (_, index) =>
    String.fromCharCode(0x4e00 + index),
  ).join("");
}

describe("V2 password policy constants", () => {
  it("records the current fork without tightening it", () => {
    expect(V2_BOOTSTRAP_PASSWORD_MIN_LENGTH).toBe(8);
    expect(V2_STAFF_RESET_PASSWORD_MIN_LENGTH).toBe(8);
    expect(V2_PASSWORD_MAX_BYTES).toBe(72);
    expect(V2_PASSWORD_MIN_UNIQUE_CHARS).toBe(8);
  });

  it("uses one canonical known-default candidate list", () => {
    expect(KNOWN_DEFAULT_PASSWORD_CANDIDATES).toContain("admin");
    expect(new Set(KNOWN_DEFAULT_PASSWORD_CANDIDATES).size).toBe(
      KNOWN_DEFAULT_PASSWORD_CANDIDATES.length,
    );
    expect(KNOWN_DEFAULT_PASSWORD_CANDIDATES.every((value) => value.length > 0)).toBe(true);
  });
});

describe("isStrongV2Password", () => {
  it("accepts the 8-character boundary with enough distinct characters", () => {
    expect(isStrongV2Password("abcdefgh", "admin")).toBe(true);
  });

  it("rejects 7 characters", () => {
    expect(isStrongV2Password("abcdefg", "admin")).toBe(false);
  });

  it("rejects a password containing the username (case-insensitive)", () => {
    expect(isStrongV2Password("flowerFlower1234!", "flower")).toBe(false);
  });

  it("rejects more than 72 UTF-8 bytes", () => {
    const overLimit = distinctCjk(25);
    expect(Buffer.byteLength(overLimit, "utf8")).toBeGreaterThan(V2_PASSWORD_MAX_BYTES);
    expect(isStrongV2Password(overLimit, "admin")).toBe(false);
  });

  it("accepts exactly 72 UTF-8 bytes", () => {
    const atLimit = distinctCjk(24);
    expect(Buffer.byteLength(atLimit, "utf8")).toBe(V2_PASSWORD_MAX_BYTES);
    expect(isStrongV2Password(atLimit, "admin")).toBe(true);
  });

  it("rejects fewer than 8 distinct characters", () => {
    expect(isStrongV2Password("abababababababab", "admin")).toBe(false);
    expect(isStrongV2Password("aaaaaaaaaaaaaaaa", "admin")).toBe(false);
  });
});

describe("evaluateV2PasswordChange", () => {
  const currentPassword = "CurrentPass123!";
  const currentHash = `hashed:${currentPassword}`;
  const compare = async (password: string, hash: string) => hash === `hashed:${password}`;

  const base = {
    current: currentPassword,
    next: "NewStrongPass1234!",
    confirm: "NewStrongPass1234!",
    username: "admin",
    currentPasswordHash: currentHash,
    compare,
  };

  it("allows a valid change and returns the accepted password", async () => {
    await expect(evaluateV2PasswordChange(base)).resolves.toEqual({
      allowed: true,
      nextPassword: "NewStrongPass1234!",
    });
  });

  it("rejects missing fields", async () => {
    await expect(
      evaluateV2PasswordChange({ ...base, next: null }),
    ).resolves.toEqual({ allowed: false, reason: "missing_fields" });
    await expect(
      evaluateV2PasswordChange({ ...base, current: undefined }),
    ).resolves.toEqual({ allowed: false, reason: "missing_fields" });
  });

  it("rejects a confirmation mismatch", async () => {
    await expect(
      evaluateV2PasswordChange({ ...base, confirm: "NewStrongPass12345!" }),
    ).resolves.toEqual({ allowed: false, reason: "confirmation_mismatch" });
  });

  it("rejects a weak new password", async () => {
    await expect(
      evaluateV2PasswordChange({ ...base, next: "short", confirm: "short" }),
    ).resolves.toEqual({ allowed: false, reason: "weak_password" });
  });

  it("rejects a wrong current password", async () => {
    await expect(
      evaluateV2PasswordChange({ ...base, current: "WrongPass123!" }),
    ).resolves.toEqual({ allowed: false, reason: "current_password_mismatch" });
  });

  it("rejects reusing the current password", async () => {
    await expect(
      evaluateV2PasswordChange({
        ...base,
        current: "NewStrongPass1234!",
        next: "NewStrongPass1234!",
        confirm: "NewStrongPass1234!",
        currentPasswordHash: "hashed:NewStrongPass1234!",
      }),
    ).resolves.toEqual({ allowed: false, reason: "password_reuse" });
  });
});
