/**
 * fetch for the Supabase clients, retrying a read once when it fails before
 * any response arrives. This happens when a kept-alive connection was closed
 * by the other side while idle ("fetch failed"). Writes are never retried,
 * since they might already have been applied.
 */
export const resilientFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  try {
    return await fetch(input, init);
  } catch (error) {
    if ((method !== "GET" && method !== "HEAD") || init?.signal?.aborted) throw error;
    await new Promise((resolve) => setTimeout(resolve, 150));
    return fetch(input, init);
  }
};
