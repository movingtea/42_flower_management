/**
 * Synthetic accounts created by the default V2 seed's `roles` tier.
 * Password equals the username; the seed lives only in throw-away test databases.
 */
export type E2ERole = "admin" | "manager" | "buyer" | "sales" | "florist";

export const SEEDED_ACCOUNTS: Readonly<Record<E2ERole, { username: string; password: string }>> = {
  admin: { username: "admin", password: "admin" },
  manager: { username: "manager", password: "manager" },
  buyer: { username: "buyer", password: "buyer" },
  sales: { username: "sales", password: "sales" },
  florist: { username: "florist", password: "florist" },
};

export function seededAccount(role: E2ERole): { username: string; password: string } {
  return SEEDED_ACCOUNTS[role];
}
