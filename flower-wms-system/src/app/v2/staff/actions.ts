"use server";

import { redirect } from "next/navigation";
import { requireV2Store } from "@/v2/auth";
import { v2db } from "@/v2/db";
import {
  createStaffAccount,
  resetStaffPassword,
  setStaffActive,
  updateStaffRoles,
} from "@/v2/services/staff-management";

type StaffActor = Awaited<ReturnType<typeof requireV2Store>>;

function field(data: FormData, key: string): string {
  const value = data.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Passwords are intentionally not trimmed or otherwise normalized here. */
function passwordField(data: FormData): string {
  const value = data.get("password");
  return typeof value === "string" ? value : "";
}

function roleFields(data: FormData): string[] {
  return data
    .getAll("roles")
    .filter((value): value is string => typeof value === "string");
}

function errorMessage(cause: unknown, fallback = "操作失败"): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/**
 * Resolve the actor and tenant/store exclusively from the authenticated V2
 * session. A form can only name the target record and intended fields.
 */
async function requireStaffActor(): Promise<StaffActor> {
  try {
    return await requireV2Store("staff");
  } catch (cause) {
    redirect(`/v2?error=${encodeURIComponent(errorMessage(cause))}`);
  }
}

async function runStaffMutation(
  success: string,
  mutate: (actor: StaffActor) => Promise<void>
): Promise<void> {
  const actor = await requireStaffActor();
  const message = success;
  let error: string | null = null;
  try {
    await mutate(actor);
  } catch (cause) {
    error = errorMessage(cause);
  }

  const query = error
    ? `error=${encodeURIComponent(error)}`
    : `message=${encodeURIComponent(message)}`;
  redirect(`/v2/staff?${query}`);
}

export async function createStaffAccountAction(data: FormData): Promise<void> {
  await runStaffMutation("员工账号已创建", async (actor) => {
    await v2db.$transaction((tx) =>
      createStaffAccount(tx, {
        tenantId: actor.tenantId,
        storeId: actor.storeId,
        actorStaffId: actor.staffId,
        username: field(data, "username"),
        password: passwordField(data),
        displayName: field(data, "displayName"),
        roles: roleFields(data),
      })
    );
  });
}

export async function resetStaffPasswordAction(data: FormData): Promise<void> {
  await runStaffMutation("密码已重置", async (actor) => {
    await v2db.$transaction((tx) =>
      resetStaffPassword(tx, {
        tenantId: actor.tenantId,
        storeId: actor.storeId,
        actorStaffId: actor.staffId,
        targetStaffId: field(data, "targetStaffId"),
        password: passwordField(data),
      })
    );
  });
}

export async function setStaffActiveAction(data: FormData): Promise<void> {
  const active = field(data, "active");
  await runStaffMutation(active === "true" ? "员工已启用" : "员工已停用", async (actor) => {
    if (active !== "true" && active !== "false") {
      throw new Error("员工启用状态无效");
    }
    await v2db.$transaction((tx) =>
      setStaffActive(tx, {
        tenantId: actor.tenantId,
        storeId: actor.storeId,
        actorStaffId: actor.staffId,
        targetStaffId: field(data, "targetStaffId"),
        active: active === "true",
      })
    );
  });
}

export async function updateStaffRolesAction(data: FormData): Promise<void> {
  await runStaffMutation("员工角色已更新", async (actor) => {
    await v2db.$transaction((tx) =>
      updateStaffRoles(tx, {
        tenantId: actor.tenantId,
        storeId: actor.storeId,
        actorStaffId: actor.staffId,
        targetStaffId: field(data, "targetStaffId"),
        roles: roleFields(data),
      })
    );
  });
}
