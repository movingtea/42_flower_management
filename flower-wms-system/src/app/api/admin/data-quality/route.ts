import { jsonError, jsonSuccess } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { getDataQualityReport } from "@/services/data-quality";
import type {
  DataQualityDomain,
  DataQualitySeverity,
} from "@/services/data-quality-pure";

export const dynamic = "force-dynamic";

function parseSeverity(value: string | null): DataQualitySeverity | null {
  if (!value) return null;
  if (value === "CRITICAL" || value === "WARNING" || value === "SUGGESTION") {
    return value;
  }
  return null;
}

function parseDomain(value: string | null): DataQualityDomain | null {
  if (!value) return null;
  const domains: DataQualityDomain[] = [
    "WMS",
    "CMS",
    "MINIPROGRAM",
    "ORDER",
    "CRM",
    "REPORT",
    "SYSTEM",
  ];
  return domains.includes(value as DataQualityDomain)
    ? (value as DataQualityDomain)
    : null;
}

/** GET：数据质量检查 */
export async function GET(request: Request) {
  try {
    const staff = await requirePermission("business:read");
    if (isResponse(staff)) return staff;

    const { searchParams } = new URL(request.url);
    const severity = parseSeverity(searchParams.get("severity"));
    const domain = parseDomain(searchParams.get("domain"));
    const page = Number(searchParams.get("page") ?? "1");
    const pageSize = Number(searchParams.get("pageSize") ?? "50");

    const result = await getDataQualityReport({
      severity,
      domain,
      page: Number.isFinite(page) ? page : 1,
      pageSize: Number.isFinite(pageSize) ? pageSize : 50,
    });

    return jsonSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "数据质量检查失败";
    return jsonError(message, 500);
  }
}
