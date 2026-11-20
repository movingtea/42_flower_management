/**
 * Explicit outcome of a V2 drawer form submission.
 *
 * Drawer actions never redirect for feedback: a success result closes the
 * drawer, refreshes the current list and shows the message; a failure result
 * keeps the drawer (and the user's input) open and renders the error inline.
 * Inline row actions keep the existing `?message=` / `?error=` redirect
 * contract until that migration lands.
 */
export type V2ActionSuccess = {
  ok: true;
  message: string;
};

export type V2ActionFailure = {
  ok: false;
  error: string;
};

export type V2ActionResult = V2ActionSuccess | V2ActionFailure;

/** Next.js redirect/notFound control flow must be rethrown, never shown as form feedback. */
export function isV2ControlFlowError(cause: unknown): boolean {
  return typeof cause === "object" && cause !== null && "digest" in cause;
}

export function v2ActionErrorMessage(cause: unknown, fallback = "操作失败"): string {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

/**
 * Runs a drawer mutation and turns ordinary errors into an inline result.
 * Framework control flow (`NEXT_REDIRECT`, `NEXT_NOT_FOUND`) is rethrown so
 * Next.js can finish the navigation.
 */
export async function runV2DrawerAction(
  operation: () => Promise<string | void>,
  fallbackMessage: string,
): Promise<V2ActionResult> {
  try {
    const message = await operation();
    return { ok: true, message: message || fallbackMessage };
  } catch (cause) {
    if (isV2ControlFlowError(cause)) throw cause;
    return { ok: false, error: v2ActionErrorMessage(cause) };
  }
}
