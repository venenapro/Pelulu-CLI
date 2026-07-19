/**
 * Retry — retry logic for transient failures
 */
import { debug } from './logger.js';

export async function withRetry(fn, { maxRetries = 2, delay = 1000, backoff = 2 } = {}) {
  let lastError;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (i < maxRetries) {
        const wait = delay * Math.pow(backoff, i);
        debug(`Retry ${i + 1}/${maxRetries} after ${wait}ms: ${e.message}`);
        await new Promise(r => setTimeout(r, wait));
      }
    }
  }
  throw lastError;
}

export function isRetryable(error) {
  const retryable = ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'];
  return retryable.includes(error.code) || error.message?.includes('timeout');
}
