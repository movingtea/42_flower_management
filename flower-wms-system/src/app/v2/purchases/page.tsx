import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

/**
 * Legacy compatibility entry point. `/v2/purchase-orders` is the single formal purchase UI;
 * this route only forwards its query string (requirementId/message/error and simple filters)
 * so old links keep working without rendering a second purchase implementation.
 */
export default async function PurchasesPage({ searchParams }: { searchParams: Promise<Search> }) {
  const params = await searchParams;
  const forwarded = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 0) forwarded.set(key, value);
  }
  const query = forwarded.toString();
  redirect(`/v2/purchase-orders${query ? `?${query}` : ""}`);
}
