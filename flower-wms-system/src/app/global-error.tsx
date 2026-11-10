"use client";

/**
 * Global error boundary (Sprint E3.3).
 *
 * This is the last-resort fallback for errors thrown in the root layout or in a
 * route that has no closer `error.tsx`. It must be a Client Component and must
 * render its own `<html>`/`<body>` because it replaces the root layout.
 *
 * Safety contract:
 * - the internal error message and stack are never rendered (they can contain
 *   request input or infrastructure details), only Next.js' correlation
 *   `digest`, which maps to the sanitized server-side `error.server` event;
 * - no per-route `error.tsx` files are added, so existing page error UI is
 *   unchanged.
 */
type GlobalErrorProps = {
  error: Error & { digest?: string };
  /** Next.js 16.2+ retry callback (replaces the earlier `reset` prop). */
  unstable_retry: () => void;
};

export default function GlobalError({
  error,
  unstable_retry,
}: GlobalErrorProps) {
  const digest =
    typeof error?.digest === "string" && error.digest.trim() !== ""
      ? error.digest
      : null;

  function retry(): void {
    if (typeof unstable_retry === "function") {
      unstable_retry();
      return;
    }
    // Defensive fallback for runtimes that expose the older `reset` prop only.
    if (typeof window !== "undefined") window.location.reload();
  }

  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
          background: "#f8fafc",
          color: "#0f172a",
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        }}
      >
        <main
          style={{
            maxWidth: "480px",
            width: "100%",
            padding: "32px",
            borderRadius: "16px",
            border: "1px solid #e2e8f0",
            background: "#ffffff",
            boxShadow: "0 10px 30px rgba(15, 23, 42, 0.08)",
            textAlign: "center",
          }}
        >
          <h1 style={{ margin: "0 0 12px", fontSize: "20px", lineHeight: 1.4 }}>
            页面暂时无法显示
          </h1>
          <p
            style={{
              margin: "0 0 16px",
              fontSize: "14px",
              lineHeight: 1.7,
              color: "#475569",
            }}
          >
            页面遇到意外问题，请稍后重试。如果问题持续出现，请把下方错误编号提供给管理员。
          </p>
          {digest === null ? null : (
            <p
              style={{
                margin: "0 0 24px",
                fontSize: "13px",
                lineHeight: 1.6,
                color: "#64748b",
              }}
            >
              错误编号：
              <code
                style={{
                  display: "inline-block",
                  padding: "2px 6px",
                  borderRadius: "6px",
                  background: "#f1f5f9",
                  fontFamily:
                    'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
                  wordBreak: "break-all",
                }}
              >
                {digest}
              </code>
            </p>
          )}
          <button
            type="button"
            onClick={retry}
            style={{
              appearance: "none",
              border: "none",
              borderRadius: "10px",
              padding: "10px 20px",
              fontSize: "14px",
              fontWeight: 600,
              color: "#ffffff",
              background: "#0f172a",
              cursor: "pointer",
            }}
          >
            重试
          </button>
        </main>
      </body>
    </html>
  );
}
