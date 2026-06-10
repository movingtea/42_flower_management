export type AdminApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

export async function fetchAdminApi<T>(
  url: string,
  init?: RequestInit
): Promise<T> {
  const res = await fetch(url, init);
  const json = (await res.json()) as AdminApiResponse<T>;
  if (!res.ok || !json.success || json.data === undefined) {
    throw new Error(json.error ?? "请求失败，请稍后重试。");
  }
  return json.data;
}
