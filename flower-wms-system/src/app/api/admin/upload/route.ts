import { isResponse, requirePermission } from "@/lib/api-auth";
import {
  auditImageUpload,
  handleAdminImageUpload,
} from "@/lib/storage/upload-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/admin/upload
 * @deprecated 请使用 POST /api/admin/uploads/image 并传 module
 * 兼容旧 CMS 调用：默认 module=cms
 */
export async function POST(request: Request) {
  const staff = await requirePermission("cms:write");
  if (isResponse(staff)) return staff;

  const response = await handleAdminImageUpload(request, {
    defaultModule: "cms",
  });

  if (response.ok) {
    try {
      const json = (await response.clone().json()) as {
        success?: boolean;
        data?: { objectKey?: string; size?: number };
      };
      if (json.success && json.data?.objectKey) {
        auditImageUpload(staff, {
          objectKey: json.data.objectKey,
          module: "cms",
          size: json.data.size ?? 0,
        });
      }
    } catch {
      // ignore audit errors
    }
  }

  return response;
}
