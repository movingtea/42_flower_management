interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  variant?: "default" | "warning" | "success" | "danger";
}

const variantStyles = {
  default: "border-zinc-200 bg-white",
  warning: "border-amber-200 bg-amber-50",
  success: "border-emerald-200 bg-emerald-50",
  danger: "border-red-200 bg-red-50",
};

export function StatCard({
  label,
  value,
  hint,
  variant = "default",
}: StatCardProps) {
  return (
    <div
      className={`rounded-xl border p-5 shadow-sm ${variantStyles[variant]}`}
    >
      <p className="text-sm font-medium text-zinc-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold text-zinc-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-zinc-400">{hint}</p>}
    </div>
  );
}
