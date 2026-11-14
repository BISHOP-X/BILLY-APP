// Bound stalled network reads as well as headers. Abort instead of leaving the
// auth mutex/account gate pending forever. Never automatically replay a write.
export function createBoundedFetch(fetcher: typeof fetch, timeoutMs = 30_000): typeof fetch {
  return async (input, init) => {
    const controller = new AbortController();
    const upstream = init?.signal;
    const abort = () => controller.abort(upstream?.reason);
    if (upstream?.aborted) abort();
    else upstream?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('Network timeout')), timeoutMs);
    try {
      const response = await fetcher(input, { ...init, signal: controller.signal });
      // Supabase responses are bounded JSON, not a streaming API. Keep the
      // deadline active while reading the body, not just until headers arrive.
      const body = await response.arrayBuffer();
      return new Response(response.status === 204 || response.status === 205 || response.status === 304 ? null : body, {
        status: response.status, statusText: response.statusText, headers: response.headers,
      });
    } finally {
      clearTimeout(timer);
      upstream?.removeEventListener('abort', abort);
    }
  };
}
