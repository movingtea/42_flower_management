import type { SampleOption } from "../samples/_components/SampleEditors";

/**
 * Fuzzy matching for the sample-plan creation drawer's main-sample picker.
 *
 * The picker searches sample code, sample name and the flower three-level
 * classification. Matching is case-insensitive, ignores whitespace and common
 * separators, and treats every whitespace-separated query token as an AND
 * condition. It is presentation-only: it never changes which samples are
 * eligible, nor any reuse or cost number.
 */

function fold(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s\-_·・/\\]+/gu, "");
}

function classificationText(sample: SampleOption): string {
  return (sample.classifications ?? [])
    .flatMap((classification) => [
      classification.flowerVariety ?? "",
      classification.color ?? "",
      classification.flowerProductName ?? "",
    ])
    .join(" ");
}

export function sampleSearchHaystack(sample: SampleOption): string {
  return fold([sample.code, sample.name, classificationText(sample)].join(" "));
}

export function matchesSampleQuery(sample: SampleOption, query: string): boolean {
  const tokens = query.split(/\s+/u).map(fold).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = sampleSearchHaystack(sample);
  return tokens.every((token) => haystack.includes(token));
}

export function filterSampleOptions(
  samples: readonly SampleOption[],
  query: string,
  limit?: number,
): SampleOption[] {
  const matched = samples.filter((sample) => matchesSampleQuery(sample, query));
  if (typeof limit !== "number") return matched;
  return matched.slice(0, Math.max(0, limit));
}
