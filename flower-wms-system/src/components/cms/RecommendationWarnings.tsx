"use client";

type Props = {
  warnings: string[];
  title?: string;
};

export function RecommendationWarnings({
  warnings,
  title = "系统检测到以下风险，但不会自动阻止配置，请运营确认。",
}: Props) {
  if (!warnings.length) return null;

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="font-medium">{title}</p>
      <ul className="mt-2 space-y-1">
        {warnings.map((w) => (
          <li key={w}>· {w}</li>
        ))}
      </ul>
    </div>
  );
}
