type MetricCardProps = {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "warning" | "danger";
};

const toneStyles = {
  default: "border-zinc-200 bg-white text-zinc-900",
  success: "border-emerald-200 bg-emerald-50/60 text-emerald-900",
  warning: "border-amber-200 bg-amber-50/60 text-amber-900",
  danger: "border-red-200 bg-red-50/60 text-red-900",
};

export function MetricCard({
  label,
  value,
  hint,
  tone = "default",
}: MetricCardProps) {
  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${toneStyles[tone]}`}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
      {hint ? (
        <p className="mt-1 text-xs text-zinc-500">{hint}</p>
      ) : null}
    </div>
  );
}
