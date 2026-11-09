const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export async function waitForCollections(expectedNames, readLiveNames, options = {}) {
  const timeoutMs = Math.max(0, options.timeoutMs ?? 0);
  const pollIntervalMs = Math.max(1, options.pollIntervalMs ?? 15_000);
  const now = options.now ?? Date.now;
  const pause = options.sleep ?? sleep;
  const deadline = now() + timeoutMs;
  let liveNames = new Set();
  let lastError = null;

  while (true) {
    try {
      liveNames = await readLiveNames();
      lastError = null;
    } catch (error) {
      lastError = error;
      options.onError?.(error);
    }

    const missing = expectedNames.filter((name) => !liveNames.has(name));
    if (!lastError && missing.length === 0) {
      return { liveNames, missing, timedOut: false, lastError: null };
    }

    const remainingMs = deadline - now();
    if (remainingMs <= 0) {
      return { liveNames, missing, timedOut: timeoutMs > 0, lastError };
    }

    if (!lastError) options.onPending?.(missing);
    await pause(Math.min(pollIntervalMs, remainingMs));
  }
}
