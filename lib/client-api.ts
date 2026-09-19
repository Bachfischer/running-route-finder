// Shared browser transport: bounded waits and readable errors even if a proxy
// returns HTML instead of the API's JSON error envelope.
export async function requestJson<T>(
  url: string,
  init: RequestInit = {},
  timeoutMs = 45000,
  fetcher: typeof fetch = fetch,
): Promise<T> {
  const signal = AbortSignal.any([
    AbortSignal.timeout(timeoutMs),
    ...(init.signal ? [init.signal] : []),
  ]);
  try {
    const response = await fetcher(url, { ...init, signal });
    let data;
    try {
      data = await response.json();
    } catch {
      throw Error(
        "The service returned an incomplete response. Please try again.",
      );
    }
    if (!response.ok) {
      const message =
        typeof data?.error === "string"
          ? data.error.slice(0, 300)
          : "The service is unavailable. Please try again.";
      const retry = Number(response.headers.get("retry-after"));
      throw Error(
        response.status === 429 && retry > 0 && retry <= 300
          ? `${message} Try again in ${Math.ceil(retry)} seconds.`
          : message,
      );
    }
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw Error("The service returned invalid data. Please try again.");
    return data;
  } catch (error) {
    if (signal.aborted) {
      if (init.signal?.aborted) throw init.signal.reason;
      throw Error("The request took too long. Please try again.");
    }
    if (error instanceof TypeError)
      throw Error(
        "Could not reach the service. Check your connection and try again.",
      );
    throw error;
  }
}
