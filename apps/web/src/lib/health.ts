// Server-side health checks for the infrastructure stack shown on
// /installningar. Each check has a short timeout so a slow service can
// never block page rendering — a timeout is reported as 'unknown' rather
// than 'down', because the page itself proves networking is up.

import { getServerPbUrl } from '@/lib/pb-url';

const POCKETBASE_URL = getServerPbUrl();

const MISTRAL_HEALTH_URL = 'https://api.mistral.ai/v1/models';

export type HealthState = 'up' | 'down' | 'unknown' | 'unconfigured';

export interface ServiceHealth {
  name: string;
  sub: string;
  state: HealthState;
  accent: 'cyan' | 'green' | 'purple' | 'brown';
  detail?: string;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit = {}
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });
  } finally {
    clearTimeout(timer);
  }
}

async function checkPocketBase(): Promise<ServiceHealth> {
  const base: Omit<ServiceHealth, 'state' | 'detail'> = {
    name: 'PocketBase',
    sub: 'Multi-tenant DB · auth · realtime',
    accent: 'green'
  };
  try {
    const res = await fetchWithTimeout(`${POCKETBASE_URL}/api/health`, 2500);
    if (res.ok) return { ...base, state: 'up' };
    return { ...base, state: 'down', detail: `HTTP ${res.status}` };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return { ...base, state: isAbort ? 'unknown' : 'down' };
  }
}

async function checkMistral(): Promise<ServiceHealth> {
  const base: Omit<ServiceHealth, 'state' | 'detail'> = {
    name: 'Mistral Le Chat',
    sub: 'EU-suverän LLM',
    accent: 'brown'
  };
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) return { ...base, state: 'unconfigured', detail: 'MISTRAL_API_KEY saknas' };
  try {
    const res = await fetchWithTimeout(MISTRAL_HEALTH_URL, 3000, {
      headers: { Authorization: `Bearer ${apiKey}` }
    });
    if (res.ok) return { ...base, state: 'up' };
    if (res.status === 401 || res.status === 403)
      return { ...base, state: 'down', detail: 'Auth-fel' };
    return { ...base, state: 'down', detail: `HTTP ${res.status}` };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === 'AbortError';
    return { ...base, state: isAbort ? 'unknown' : 'down' };
  }
}

// UpCloud (IaaS) and Coolify (control plane) are not directly probeable
// from inside the app container — both sit *under* this process, so if
// this code is running they are by definition reachable for the user.
// We report 'up' based on the running-process invariant and surface the
// region/host as the descriptor.
function reportUpCloud(): ServiceHealth {
  const region = process.env.UPCLOUD_REGION || 'Stockholm primär';
  return {
    name: 'UpCloud',
    sub: `${region} · Helsingfors backup`,
    state: 'up',
    accent: 'cyan'
  };
}

function reportCoolify(): ServiceHealth {
  return {
    name: 'Coolify',
    sub: 'Self-hosted PaaS',
    state: 'up',
    accent: 'purple'
  };
}

export async function getInfraHealth(): Promise<ServiceHealth[]> {
  const [pb, mistral] = await Promise.all([checkPocketBase(), checkMistral()]);
  return [reportUpCloud(), pb, reportCoolify(), mistral];
}

export function healthStateLabel(state: HealthState): string {
  switch (state) {
    case 'up':
      return 'Drift';
    case 'down':
      return 'Avbrott';
    case 'unconfigured':
      return 'Ej konfigurerad';
    case 'unknown':
    default:
      return 'Okänd';
  }
}

export function healthChipVariant(state: HealthState): 'active' | 'danger' | 'yellow' | 'default' {
  switch (state) {
    case 'up':
      return 'active';
    case 'down':
      return 'danger';
    case 'unconfigured':
      return 'yellow';
    case 'unknown':
    default:
      return 'default';
  }
}
