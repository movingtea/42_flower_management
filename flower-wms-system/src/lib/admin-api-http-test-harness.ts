/**
 * Admin API HTTP smoke 辅助：构造 StaffSession fixture。
 * 配合 api-auth.setStaffSessionOverrideForTests 使用。
 */
import { Role } from "@/generated/prisma/enums";
import type { StaffSession } from "@/lib/api-auth";

const TEST_STAFF_ID = "smoke-permission-test-staff-id";

export function staffFixture(role: Role): StaffSession {
  return {
    id: TEST_STAFF_ID,
    username: `smoke_${role.toLowerCase()}`,
    role,
  };
}

export const STAFF_FIXTURES = {
  storeAdmin: staffFixture(Role.STORE_ADMIN),
  warehouseManager: staffFixture(Role.WAREHOUSE_MANAGER),
  storeOperator: staffFixture(Role.STORE_OPERATOR),
  florist: staffFixture(Role.FLORIST),
  itAdmin: staffFixture(Role.IT_ADMIN),
} as const;

export async function readResponseStatus(res: Response): Promise<number> {
  return res.status;
}

export async function assertResponseStatus(
  res: Response,
  expected: number,
  label: string
): Promise<void> {
  if (res.status !== expected) {
    let body = "";
    try {
      body = JSON.stringify(await res.json());
    } catch {
      body = "(non-json body)";
    }
    throw new Error(
      `${label}: expected HTTP ${expected}, got ${res.status} body=${body}`
    );
  }
}

export function assertNotAuthBlocked(
  status: number,
  label: string
): void {
  if (status === 401 || status === 403) {
    throw new Error(
      `${label}: expected to pass auth boundary, got HTTP ${status}`
    );
  }
}
