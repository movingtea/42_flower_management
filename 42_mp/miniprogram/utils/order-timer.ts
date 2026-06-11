const PENDING_PAYMENT_MS = 15 * 60 * 1000;

export function computeExpiresAtIso(createdAt: string): string {
  const created = new Date(createdAt).getTime();
  return new Date(created + PENDING_PAYMENT_MS).toISOString();
}

export function formatCountdownMmSs(remainingMs: number): string {
  const safe = Math.max(0, remainingMs);
  const totalSec = Math.floor(safe / 1000);
  const mm = String(Math.floor(totalSec / 60)).padStart(2, '0');
  const ss = String(totalSec % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

export function getPaymentRemainingMs(
  expiresAt: string | null | undefined,
  createdAt?: string
): number {
  const endMs = expiresAt
    ? new Date(expiresAt).getTime()
    : createdAt
      ? new Date(createdAt).getTime() + PENDING_PAYMENT_MS
      : 0;
  if (!endMs) return 0;
  return endMs - Date.now();
}

export function isPaymentExpired(
  expiresAt: string | null | undefined,
  createdAt?: string
): boolean {
  return getPaymentRemainingMs(expiresAt, createdAt) <= 0;
}
