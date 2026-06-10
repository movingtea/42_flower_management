type Props = {
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  loadingText?: string;
};

export function PageLoading({
  text = "正在加载…",
}: {
  text?: string;
}) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-12 text-center text-sm text-zinc-500 shadow-sm">
      {text}
    </div>
  );
}

export function PageError({ error, onRetry }: Props) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center text-sm text-red-700 shadow-sm">
      <p>{error ?? "加载失败，请稍后重试。"}</p>
      {onRetry ? (
        <button
          type="button"
          className="mt-4 rounded-lg bg-red-700 px-4 py-2 text-white hover:bg-red-800"
          onClick={onRetry}
        >
          重新加载
        </button>
      ) : null}
    </div>
  );
}
