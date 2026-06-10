import { RecommendationSlotsManager } from "@/app/cms/recommendations/RecommendationSlotsManager";

export const dynamic = "force-dynamic";

export default function CmsRecommendationsPage() {
  return (
    <div>
      <header className="mb-8">
        <h2 className="text-2xl font-semibold text-rose-900">推荐位配置</h2>
        <p className="mt-1 text-sm text-zinc-500">
          首页与场景推荐 — 人工配置小程序展示商品
        </p>
      </header>
      <RecommendationSlotsManager />
    </div>
  );
}
