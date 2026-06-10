/** 商品运营标签 normalize — 前台统一 { key, label }[] */
export type ProductTagDisplay = { key: string; label: string };

export function normalizeTagDisplayList(raw: unknown): ProductTagDisplay[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      if (typeof item === 'string') {
        const key = item.trim();
        return key ? { key, label: key } : null;
      }
      if (item && typeof item === 'object') {
        const obj = item as { key?: string; label?: string };
        const key = (obj.key ?? obj.label ?? '').trim();
        if (!key) return null;
        return { key, label: (obj.label ?? key).trim() || key };
      }
      return null;
    })
    .filter((t): t is ProductTagDisplay => t !== null);
}
