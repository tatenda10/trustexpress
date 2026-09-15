/**
 * Helpers for transient API failures so screens can retry quietly
 * instead of immediately showing blocking network alerts.
 */

export function isTransientNetworkError(error) {
  const status = Number(error?.status);
  if (!Number.isFinite(status) || status === 0) return true;
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('network error')
    || message.includes('timed out')
    || message.includes('timeout')
    || message.includes('connection')
  );
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withNetworkRetry(task, {
  retries = 2,
  delayMs = 650,
  shouldRetry = isTransientNetworkError,
} = {}) {
  let lastError;
  const attempts = Math.max(0, Number(retries) || 0) + 1;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt >= attempts - 1 || !shouldRetry(error)) {
        throw error;
      }
      await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastError;
}
