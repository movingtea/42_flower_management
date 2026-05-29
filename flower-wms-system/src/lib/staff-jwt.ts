import type { StaffRoleName } from "@/lib/staff-role";
import { createHmac, timingSafeEqual } from "crypto";

const DEFAULT_EXPIRES_SEC = 60 * 60 * 8;

export type StaffJwtPayload = {
  sub: string;
  role: StaffRoleName;
  exp: number;
  iat: number;
};

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(input: string): Buffer {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (padded.length % 4)) % 4;
  return Buffer.from(padded + "=".repeat(padLen), "base64");
}

function getJwtSecret(): string {
  const secret = process.env.STAFF_JWT_SECRET?.trim();
  if (!secret) {
    throw new Error("STAFF_JWT_SECRET 未配置");
  }
  return secret;
}

export function signStaffToken(
  staffId: string,
  role: StaffRoleName,
  expiresInSec = DEFAULT_EXPIRES_SEC
): string {
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(
    JSON.stringify({
      sub: staffId,
      role,
      iat: now,
      exp: now + expiresInSec,
    })
  );
  const signature = createHmac("sha256", getJwtSecret())
    .update(`${header}.${payload}`)
    .digest();
  return `${header}.${payload}.${base64UrlEncode(signature)}`;
}

export function verifyStaffToken(token: string): StaffJwtPayload | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;

    const [header, payload, signature] = parts;
    const expected = createHmac("sha256", getJwtSecret())
      .update(`${header}.${payload}`)
      .digest();
    const actual = base64UrlDecode(signature);

    if (
      expected.length !== actual.length ||
      !timingSafeEqual(expected, actual)
    ) {
      return null;
    }

    const decoded = JSON.parse(
      base64UrlDecode(payload).toString("utf8")
    ) as StaffJwtPayload;

    if (
      typeof decoded.sub !== "string" ||
      typeof decoded.role !== "string" ||
      typeof decoded.exp !== "number"
    ) {
      return null;
    }

    if (decoded.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    return decoded;
  } catch {
    return null;
  }
}
