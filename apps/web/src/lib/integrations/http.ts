import 'server-only';

// Thin fetch wrapper for integration HTTP calls. Same philosophy as
// lib/ai/mistral.ts: no npm SDK, plain fetch + JSON, server-only.
// Adds: bounded timeout, one retry on 429/5xx, and PII-free error
// messages so they can be logged in integration_sync_runs.error_message
// per CLAUDE.md § 10.3.

const DEFAULT_TIMEOUT_MS = 20_000;

export interface IntegrationFetchOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  timeoutMs?: number;
}

export class IntegrationFetchError extends Error {
  status: number;
  bodySnippet: string;
  constructor(status: number, message: string, bodySnippet: string) {
    super(message);
    this.status = status;
    this.bodySnippet = bodySnippet;
  }
}

function buildUrl(baseUrl: string, path: string, query?: IntegrationFetchOptions['query']) {
  const url = new URL(path.startsWith('http') ? path : `${baseUrl}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

async function doFetch(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createFetchClient(baseUrl: string, defaultHeaders: Record<string, string>) {
  return async function request<T = unknown>(
    path: string,
    options: IntegrationFetchOptions = {}
  ): Promise<T> {
    const url = buildUrl(baseUrl, path, options.query);
    const headers = {
      Accept: 'application/json',
      ...defaultHeaders,
      ...(options.headers || {})
    };
    const init: RequestInit = {
      method: options.method ?? 'GET',
      headers
    };
    if (options.body !== undefined) {
      (init.headers as Record<string, string>)['Content-Type'] = 'application/json';
      init.body = JSON.stringify(options.body);
    }

    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    let response = await doFetch(url, init, timeoutMs);

    // Single retry on transient errors.
    if (response.status === 429 || (response.status >= 500 && response.status < 600)) {
      await new Promise((r) => setTimeout(r, 1000));
      response = await doFetch(url, init, timeoutMs);
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new IntegrationFetchError(
        response.status,
        `HTTP ${response.status}`,
        text.slice(0, 300)
      );
    }

    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  };
}
