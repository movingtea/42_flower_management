import { jsonError } from "@/lib/api";
import { isResponse, requirePermission } from "@/lib/api-auth";
import { logEvent } from "@/lib/observability/logger";
import {
  renderMetrics,
  syncCronHeartbeatFromFile,
} from "@/lib/observability/metrics";

export const dynamic = "force-dynamic";

const NO_STORE = "no-store";
const PROMETHEUS_CONTENT_TYPE = "text/plain; version=0.0.4; charset=utf-8";

/**
 * GET：受保护的运行指标入口（Prometheus text exposition）。
 *
 * 复用现有 `requirePermission("business:read")` 鉴权，因此未登录返回既有 401
 * JSON、无权角色返回既有 403 JSON；指标内容不含库名、用户名或连接信息。
 * 渲染失败不影响业务请求，只返回 500 并记录 `metrics.render.failed`。
 */
export async function GET() {
  const staff = await requirePermission("business:read");
  if (isResponse(staff)) return staff;

  let body: string;
  try {
    // The cron process owns its own in-memory gauges; staging mounts the same
    // heartbeat volume so the web snapshot can report the last success/failures.
    syncCronHeartbeatFromFile();
    body = renderMetrics();
  } catch (err) {
    logEvent({
      level: "error",
      event: "metrics.render.failed",
      fields: { reason: "render_error" },
      error: err,
    });
    return jsonError("指标渲染失败", 500);
  }

  return new Response(body, {
    status: 200,
    headers: {
      "content-type": PROMETHEUS_CONTENT_TYPE,
      "cache-control": NO_STORE,
    },
  });
}
