import bcrypt from "bcryptjs";
import NextAuth, { type User } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import {
  authConfig,
  LEGACY_CREDENTIALS_PROVIDER_ID,
  V2_CREDENTIALS_PROVIDER_ID,
} from "@/auth.config";
import { Role } from "@/generated/prisma/enums";
import {
  createLoginThrottle,
  guardCredentialsLogin,
  resolveLoginThrottlePolicy,
  type LoginAttemptProvider,
  type LoginAttemptReason,
  type LoginThrottle,
  type LoginVerifyResult,
  type RetryAfterSecondsBucket,
  type ThrottleScope,
} from "@/lib/auth-security";
import { prisma } from "@/lib/prisma";
import { logEvent, type LogLevel } from "@/lib/observability/logger";
import { fingerprintAccount } from "@/lib/observability/redact";
import { resolveStaffTenantContext } from "@/services/tenant";

type CredentialsInput = Partial<Record<"username" | "password", unknown>>;

/**
 * One process-wide throttle. The policy is read from the documented E3 env
 * contract (`LOGIN_THROTTLE_*`, `TRUSTED_PROXY_HOPS`) at startup; the throttle
 * is disabled unless `LOGIN_THROTTLE_ENABLED=true` is approved for the
 * environment. The store is a bounded in-memory map - see
 * docs/sprint-e3-credential-governance.md for the multi-instance limitation.
 */
const loginThrottle: LoginThrottle = createLoginThrottle({
  policy: resolveLoginThrottlePolicy(),
});

function readCredentials(credentials: CredentialsInput | undefined) {
  return {
    username:
      typeof credentials?.username === "string"
        ? credentials.username.trim()
        : "",
    password:
      typeof credentials?.password === "string" ? credentials.password : "",
  };
}

/**
 * Emit one auth.login.attempt event for either provider. The account is only
 * ever represented by its HMAC fingerprint (see fingerprintAccount), so a log
 * line can never leak a username, password, hash or request body.
 */
function logLoginAttempt(input: {
  provider: LoginAttemptProvider;
  outcome: "success" | "failure";
  reason: LoginAttemptReason;
  username: string;
  error?: unknown;
}): void {
  const level: LogLevel =
    input.outcome === "success"
      ? "info"
      : input.reason === "internal_error"
        ? "error"
        : "warn";
  logEvent({
    level,
    event: "auth.login.attempt",
    fields: {
      outcome: input.outcome,
      provider: input.provider,
      reason: input.reason,
      accountFingerprint: fingerprintAccount(input.username),
    },
    ...(input.error === undefined ? {} : { error: input.error }),
  });
}

/** Stable auth.login.throttled event from the shared E3 event whitelist. */
function logLoginThrottled(input: {
  provider: LoginAttemptProvider;
  scope: ThrottleScope;
  retryAfterSecondsBucket: RetryAfterSecondsBucket;
}): void {
  logEvent({
    level: "warn",
    event: "auth.login.throttled",
    fields: {
      provider: input.provider,
      scope: input.scope,
      retryAfterSecondsBucket: input.retryAfterSecondsBucket,
    },
  });
}

/**
 * Verify a legacy credential against the V1 database only.
 * Returns a typed result so the shared throttle can count failures without
 * changing the external `null` outcome.
 */
async function verifyLegacyLogin(
  username: string,
  password: string,
): Promise<LoginVerifyResult<User>> {
  if (!username || !password) {
    return { outcome: "failure", reason: "missing_credentials" };
  }
  try {
    const staff = await prisma.staffUser.findUnique({
      where: { username },
    });
    if (!staff) return { outcome: "failure", reason: "unknown_user" };
    if (!staff.isActive) return { outcome: "failure", reason: "inactive" };

    const ok = await bcrypt.compare(password, staff.passwordHash);
    if (!ok) return { outcome: "failure", reason: "wrong_password" };

    const tenantContext = await resolveStaffTenantContext(
      staff.id,
      staff.role as Role,
    );

    return {
      outcome: "success",
      value: {
        id: staff.id,
        name: staff.displayName ?? staff.username,
        email: staff.username,
        username: staff.username,
        role: staff.role as Role,
        source: "legacy",
        defaultTenantId: tenantContext.defaultTenantId,
        currentTenantId: tenantContext.currentTenantId,
        tenantRole: tenantContext.tenantRole,
      },
    };
  } catch (error) {
    return { outcome: "error", error };
  }
}

/**
 * Verify a v2 credential against the V2 database only. The v2 stack is loaded
 * lazily so a broken V2_DATABASE_URL never breaks the legacy login provider.
 */
async function verifyV2Login(
  username: string,
  password: string,
): Promise<LoginVerifyResult<User>> {
  if (!username || !password) {
    return { outcome: "failure", reason: "missing_credentials" };
  }
  try {
    const [{ authenticateV2Staff }, { v2db }] = await Promise.all([
      import("@/v2/auth"),
      import("@/v2/db"),
    ]);

    // authenticateV2Staff returns null for several rejection classes; the
    // loader captures only whether the account exists and is active so the
    // internal log reason can stay meaningful without a second bcrypt run.
    let loadedStaffActive: boolean | null = null;

    const principal = await authenticateV2Staff(
      { username, password },
      async (candidateUsername) => {
        const staff = await v2db.staffUser.findUnique({
          where: { username: candidateUsername },
          include: {
            tenantMembers: true,
            storeMembers: { include: { store: true } },
          },
        });
        loadedStaffActive = staff ? staff.active : null;
        return staff;
      },
    );
    if (!principal) {
      return {
        outcome: "failure",
        reason:
          loadedStaffActive === null
            ? "unknown_user"
            : loadedStaffActive === false
              ? "inactive"
              : "wrong_password",
      };
    }

    return {
      outcome: "success",
      value: {
        id: principal.id,
        name: principal.displayName ?? principal.username,
        email: principal.username,
        username: principal.username,
        role: principal.sessionRole,
        source: "v2",
        v2BootstrapSession: principal.mustChangePassword,
        defaultTenantId: null,
        currentTenantId: null,
        tenantRole: null,
      },
    };
  } catch (error) {
    return { outcome: "error", error };
  }
}

async function authorizeLegacy(
  credentials: CredentialsInput | undefined,
  request: Request,
): Promise<User | null> {
  const { username, password } = readCredentials(credentials);
  return guardCredentialsLogin<User>({
    provider: "legacy",
    username,
    request,
    throttle: loginThrottle,
    hasPassword: password.length > 0,
    verify: () => verifyLegacyLogin(username, password),
    onAttempt: ({ outcome, reason, error }) =>
      logLoginAttempt({ provider: "legacy", outcome, reason, username, error }),
    onThrottled: ({ scope, retryAfterSecondsBucket }) =>
      logLoginThrottled({ provider: "legacy", scope, retryAfterSecondsBucket }),
    onStoreError: () =>
      logLoginAttempt({
        provider: "legacy",
        outcome: "failure",
        reason: "store_error",
        username,
      }),
  });
}

async function authorizeV2(
  credentials: CredentialsInput | undefined,
  request: Request,
): Promise<User | null> {
  const { username, password } = readCredentials(credentials);
  return guardCredentialsLogin<User>({
    provider: "v2",
    username,
    request,
    throttle: loginThrottle,
    hasPassword: password.length > 0,
    verify: () => verifyV2Login(username, password),
    onAttempt: ({ outcome, reason, error }) =>
      logLoginAttempt({ provider: "v2", outcome, reason, username, error }),
    onThrottled: ({ scope, retryAfterSecondsBucket }) =>
      logLoginThrottled({ provider: "v2", scope, retryAfterSecondsBucket }),
    onStoreError: () =>
      logLoginAttempt({
        provider: "v2",
        outcome: "failure",
        reason: "store_error",
        username,
      }),
  });
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      id: LEGACY_CREDENTIALS_PROVIDER_ID,
      name: "Credentials",
      credentials: {
        username: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" },
      },
      authorize: authorizeLegacy,
    }),
    Credentials({
      id: V2_CREDENTIALS_PROVIDER_ID,
      name: "V2 Credentials",
      credentials: {
        username: { label: "用户名", type: "text" },
        password: { label: "密码", type: "password" },
      },
      authorize: authorizeV2,
    }),
  ],
});
