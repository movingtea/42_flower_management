import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PASSWORD_CHANGE_AUDIT_ACTION,
  PASSWORD_CHANGE_AUDIT_ENTITY_TYPE,
  PASSWORD_CHANGE_INVALID_REDIRECT,
  buildPasswordChangeAuditSnapshots,
  resolvePasswordChangeAuditScope,
} from "./audit";
import { evaluateV2PasswordChange } from "../../../v2/password-policy";

describe("password change audit payload", () => {
  it("uses the contract action and entity names", () => {
    expect(PASSWORD_CHANGE_AUDIT_ACTION).toBe("V2_STAFF_PASSWORD_CHANGED");
    expect(PASSWORD_CHANGE_AUDIT_ENTITY_TYPE).toBe("StaffUser");
  });

  it("snapshots only account state, never a hash or password", () => {
    const { beforeSnapshot, afterSnapshot } = buildPasswordChangeAuditSnapshots({
      active: true,
      mustChangePassword: true,
    });
    expect(beforeSnapshot).toEqual({ active: true, mustChangePassword: true });
    expect(afterSnapshot).toEqual({ active: true, mustChangePassword: false });
    expect(Object.keys(beforeSnapshot).sort()).toEqual(["active", "mustChangePassword"]);
    expect(Object.keys(afterSnapshot).sort()).toEqual(["active", "mustChangePassword"]);
    const serialized = JSON.stringify({ beforeSnapshot, afterSnapshot }).toLowerCase();
    expect(serialized).not.toContain("passwordhash");
    expect(serialized).not.toContain("$2");
    expect(serialized).not.toContain("hashed:");
  });
});

describe("resolvePasswordChangeAuditScope", () => {
  it("prefers the deterministic active store/tenant membership", () => {
    const scope = resolvePasswordChangeAuditScope({
      tenantMembers: [
        { tenantId: "tenant-b", active: true },
        { tenantId: "tenant-a", active: true },
      ],
      storeMembers: [
        { storeId: "store-z", active: true, store: { tenantId: "tenant-b" } },
        { storeId: "store-a", active: true, store: { tenantId: "tenant-a" } },
        { storeId: "store-inactive", active: false, store: { tenantId: "tenant-a" } },
      ],
    });
    expect(scope).toEqual({ tenantId: "tenant-a", storeId: "store-a" });
  });

  it("falls back to an active tenant membership without a store", () => {
    expect(
      resolvePasswordChangeAuditScope({
        tenantMembers: [{ tenantId: "tenant-1", active: true }],
        storeMembers: [{ storeId: "store-1", active: true, store: { tenantId: "tenant-other" } }],
      }),
    ).toEqual({ tenantId: "tenant-1", storeId: null });
  });

  it("ignores memberships for tenants without an active tenant membership", () => {
    expect(
      resolvePasswordChangeAuditScope({
        tenantMembers: [{ tenantId: "tenant-1", active: false }],
        storeMembers: [{ storeId: "store-1", active: true, store: { tenantId: "tenant-1" } }],
      }),
    ).toBeNull();
  });

  it("returns null when no active membership exists", () => {
    expect(resolvePasswordChangeAuditScope({ tenantMembers: [], storeMembers: [] })).toBeNull();
  });
});

describe("generic password change failure", () => {
  const compare = async (password: string, hash: string) => hash === `hashed:${password}`;

  it("maps every failure to the same generic redirect", async () => {
    const base = {
      current: "CurrentPass123!",
      next: "NewStrongPass1234!",
      confirm: "NewStrongPass1234!",
      username: "admin",
      currentPasswordHash: "hashed:CurrentPass123!",
      compare,
    };
    const failures = [
      await evaluateV2PasswordChange({ ...base, next: null }),
      await evaluateV2PasswordChange({ ...base, confirm: "MismatchPass123!" }),
      await evaluateV2PasswordChange({ ...base, next: "short", confirm: "short" }),
      await evaluateV2PasswordChange({ ...base, current: "WrongPass123!" }),
    ];
    for (const failure of failures) {
      expect(failure.allowed).toBe(false);
      expect(PASSWORD_CHANGE_INVALID_REDIRECT).toBe("/account/v2-password?invalid=1");
      expect(PASSWORD_CHANGE_INVALID_REDIRECT).not.toContain("username");
      expect(PASSWORD_CHANGE_INVALID_REDIRECT).not.toContain("reason");
    }
  });
});

describe("page wiring (source contract)", () => {
  const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");

  it("checks the compare-and-set count before auditing and signing out", () => {
    const updateIndex = source.indexOf("updateMany(");
    const countCheckIndex = source.indexOf("updated.count === 0");
    const auditIndex = source.indexOf("writePasswordChangedAudit(staff)");
    const signOutIndex = source.indexOf("await signOut({ redirectTo:", auditIndex);
    expect(updateIndex).toBeGreaterThan(-1);
    expect(countCheckIndex).toBeGreaterThan(updateIndex);
    expect(auditIndex).toBeGreaterThan(countCheckIndex);
    expect(signOutIndex).toBeGreaterThan(auditIndex);
  });

  it("uses the shared policy and audit helpers", () => {
    expect(source).toContain("evaluateV2PasswordChange");
    expect(source).toContain("PASSWORD_CHANGE_AUDIT_ACTION");
    expect(source).toContain("resolvePasswordChangeAuditScope");
    expect(source).not.toContain('"use client"');
  });

  it("reports audit degradation as structured events, not console output", () => {
    expect(source).not.toMatch(/console\.(warn|error|log)\(/);
    expect(source).toContain('event: "auth.password.changed"');
    expect(source).toContain('reason: "audit_scope_missing"');
    expect(source).toContain('reason: "audit_write_failed"');
    expect(source).toContain("fingerprintAccount(staff.username)");
    // The database error must never reach the logger (connection details).
    expect(source).not.toContain("catch (error)");
  });
});
