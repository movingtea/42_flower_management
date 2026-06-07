"use client";

export const WIKI_TABLE_CELL_MAX_CHARS = 20;

export function truncateTableText(
  text: string,
  maxLength = WIKI_TABLE_CELL_MAX_CHARS
): { display: string; full: string; truncated: boolean } {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) {
    return { display: trimmed, full: trimmed, truncated: false };
  }
  return {
    display: `${trimmed.slice(0, maxLength)}…`,
    full: trimmed,
    truncated: true,
  };
}

type Props = {
  text: string;
  className?: string;
  maxLength?: number;
};

/** 表格单元格：最多 maxLength 字，在列宽内自动换行；超出字数悬停 title 看全文 */
export function WikiTableTruncatedText({
  text,
  className = "",
  maxLength = WIKI_TABLE_CELL_MAX_CHARS,
}: Props) {
  const { display, full, truncated } = truncateTableText(text, maxLength);

  return (
    <span
      className={`block w-full break-words whitespace-normal leading-relaxed ${className}`}
      title={truncated ? full : undefined}
    >
      {display}
    </span>
  );
}
