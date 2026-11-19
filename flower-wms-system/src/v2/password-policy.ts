/**
 * Single source of truth for the V2 password policy.
 *
 * Sprint E3.5 only names the existing constants; it does not tighten them. The
 * current rules stay:
 * - bootstrap / first-login change: at least 16 characters, at most 72 UTF-8
 *   bytes, must not contain the username, at least 8 distinct characters.
 * - administrator reset for a normal V2 staff member: at least 8 characters
 *   (`V2_STAFF_RESET_PASSWORD_MIN_LENGTH`). The reset implementation still
 *   lives in `src/v2/services/staff-management.ts`; this export records the
 *   current contract so the policy fork is visible instead of implicit.
 * - legacy V1 reset keeps its historical 6-character rule. V1 is out of scope
 *   for this policy module and must not inherit the V2 rules.
 *
 * The known default candidates are shared with the read-only startup check
 * (`scripts/check-v2-credential-governance.mjs`); a test keeps the two lists in
 * sync so the credential checks cannot silently drift apart.
 */

export const V2_BOOTSTRAP_PASSWORD_MIN_LENGTH = 16;

/** Administrator reset minimum for normal (non-bootstrap) V2 staff. */
export const V2_STAFF_RESET_PASSWORD_MIN_LENGTH = 8;

/** bcrypt only consumes the first 72 bytes; longer inputs are rejected. */
export const V2_PASSWORD_MAX_BYTES = 72;

/** Guards against `aaaaaaaaaaaaaaaa`-style passwords. */
export const V2_PASSWORD_MIN_UNIQUE_CHARS = 8;

/**
 * Small list of well-known default passwords. The startup check also compares
 * each active account's own username, which covers `admin/admin` style custom
 * defaults without storing or logging any credential.
 */
export const KNOWN_DEFAULT_PASSWORD_CANDIDATES = [
  "admin",
  "password",
  "123456",
  "12345678",
  "admin123",
  "flower",
  "flower123",
  "changeme",
] as const;

export type KnownDefaultPasswordCandidate =
  (typeof KNOWN_DEFAULT_PASSWORD_CANDIDATES)[number];

export function isStrongV2Password(password: string, username: string): boolean {
  return password.trim().length >= V2_BOOTSTRAP_PASSWORD_MIN_LENGTH &&
    Buffer.byteLength(password, "utf8") <= V2_PASSWORD_MAX_BYTES &&
    !password.toLowerCase().includes(username.toLowerCase()) &&
    new Set(password).size >= V2_PASSWORD_MIN_UNIQUE_CHARS;
}

export type V2PasswordChangeFailureReason =
  | "missing_fields"
  | "confirmation_mismatch"
  | "weak_password"
  | "current_password_mismatch"
  | "password_reuse";

export type V2PasswordChangeDecision =
  | { allowed: true; nextPassword: string }
  | { allowed: false; reason: V2PasswordChangeFailureReason };

export type EvaluateV2PasswordChangeInput = {
  current: unknown;
  next: unknown;
  confirm: unknown;
  username: string;
  currentPasswordHash: string;
  /** Injected so the decision is testable without bcrypt or a database. */
  compare: (password: string, hash: string) => Promise<boolean>;
};

/**
 * Decide whether a first-login password change is allowed.
 *
 * The page maps every failure to one generic message; the reason exists for
 * internal checks and tests only and must not be rendered to the user.
 * Behaviour deliberately matches the historical inline checks: field presence,
 * confirmation, strength, current password, and password reuse.
 */
export async function evaluateV2PasswordChange(
  input: EvaluateV2PasswordChangeInput
): Promise<V2PasswordChangeDecision> {
  if (typeof input.current !== "string" || typeof input.next !== "string") {
    return { allowed: false, reason: "missing_fields" };
  }
  if (input.next !== input.confirm) {
    return { allowed: false, reason: "confirmation_mismatch" };
  }
  const next = input.next;
  if (!isStrongV2Password(next, input.username)) {
    return { allowed: false, reason: "weak_password" };
  }
  if (!(await input.compare(input.current, input.currentPasswordHash))) {
    return { allowed: false, reason: "current_password_mismatch" };
  }
  if (await input.compare(next, input.currentPasswordHash)) {
    return { allowed: false, reason: "password_reuse" };
  }
  return { allowed: true, nextPassword: next };
}
