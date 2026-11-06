export type V2Feedback = {
  message?: string;
  error?: string;
};

function singleValue(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Feedback banners only support the single string values written by v2 server actions. */
export function readV2Feedback(params: {
  message?: string | string[];
  error?: string | string[];
}): V2Feedback {
  return {
    message: singleValue(params.message),
    error: singleValue(params.error),
  };
}
