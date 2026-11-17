// Configuration + data access for Real-Time CDP audiences, via the App Builder proxy action
// in /app-builder, which calls the AEP Segmentation Audiences API server-side.
import { DEMO_AUDIENCES } from './demo-data.js';

const PAGE_SIZE = 100;
const MAX_AUDIENCES = 1000;

export const MODES = ['proxy', 'demo'];

export const DEFAULT_CONFIG = {
  mode: '', // proxy | demo; empty = proxy when a proxyUrl is configured, else demo
  sandbox: 'prod',
  proxyUrl: '',
};

const storageKey = (org, site) => `rtcdp-audiences:${org || '-'}/${site || '-'}`;

/** Reads the optional `rtcdp` sheet (key/value rows) from the site's DA config. */
export async function loadSiteConfig({ org, site, fetchFn }) {
  if (!org || !site || !fetchFn) return {};
  try {
    const resp = await fetchFn(`https://admin.da.live/config/${org}/${site}/`);
    if (!resp.ok) return {};
    const json = await resp.json();
    const rows = json?.rtcdp?.data || [];
    return Object.fromEntries(rows
      .filter((r) => r.key && r.value !== undefined && r.value !== '')
      .map((r) => [r.key.trim(), String(r.value).trim()]));
  } catch {
    return {};
  }
}

export function loadLocalConfig(org, site) {
  try {
    return JSON.parse(localStorage.getItem(storageKey(org, site))) || {};
  } catch {
    return {};
  }
}

export function saveLocalConfig(org, site, { mode, sandbox, proxyUrl }) {
  localStorage.setItem(storageKey(org, site), JSON.stringify({ mode, sandbox, proxyUrl }));
}

function evaluationType(info = {}) {
  if (info.synchronous?.enabled) return 'edge';
  if (info.continuous?.enabled) return 'streaming';
  if (info.batch?.enabled) return 'batch';
  return null;
}

function toMillis(value) {
  if (!value) return null;
  // The API mixes ms and µs timestamps.
  return value > 1e14 ? Math.round(value / 1000) : value;
}

export function normalizeAudience(raw) {
  const profiles = raw.metrics?.data?.totalProfiles ?? raw.metrics?.totalProfiles ?? null;
  return {
    id: raw.id,
    audienceId: raw.audienceId || raw.id,
    name: raw.name || '(unnamed audience)',
    description: raw.description || '',
    expression: raw.expression?.value || '',
    profiles: typeof profiles === 'number' ? profiles : null,
    evaluation: evaluationType(raw.evaluationInfo),
    origin: raw.originName || raw.type || '',
    namespace: raw.namespace || '',
    state: raw.lifecycleState || 'published',
    labels: raw.labels || [],
    mergePolicyId: raw.mergePolicyId || '',
    updated: toMillis(raw.updateTime) || (raw.updateEpoch ? raw.updateEpoch * 1000 : null),
  };
}

async function readError(resp) {
  let detail = '';
  try {
    const body = await resp.json();
    detail = body.detail || body.title || body.message || body.error_description || '';
  } catch { /* non-JSON body */ }
  const hints = {
    401: 'The proxy rejected your Experience Workspace sign-in. Try reloading Experience Workspace.',
    403: 'The proxy is not allowed to read audiences in this sandbox.',
    404: 'Endpoint not found. Check the proxy URL.',
  };
  return `${resp.status} ${resp.statusText || ''} ${detail || hints[resp.status] || ''}`.trim();
}

/**
 * Loads all audiences for the configured mode.
 * @returns {Promise<{audiences: object[], source: string}>}
 */
export async function fetchAudiences(config, { token, signal } = {}) {
  if (config.mode === 'demo') {
    await new Promise((r) => { setTimeout(r, 300); });
    return { audiences: DEMO_AUDIENCES.map(normalizeAudience), source: 'Demo data' };
  }

  if (!config.proxyUrl) throw new Error('No proxy URL configured. Add one in Settings or in the site config rtcdp sheet.');
  if (!token) throw new Error('Not signed in. Open the panel inside Experience Workspace to load live audiences.');
  // Only standard headers, so the App Builder web action's default CORS preflight accepts them.
  const headers = { Authorization: `Bearer ${token}` };

  const all = [];
  let start = 0;
  while (all.length < MAX_AUDIENCES) {
    const url = new URL(config.proxyUrl);
    url.searchParams.set('limit', PAGE_SIZE);
    url.searchParams.set('start', start);
    url.searchParams.set('sandbox', config.sandbox || 'prod');
    // eslint-disable-next-line no-await-in-loop
    const resp = await fetch(url, { headers, signal });
    // eslint-disable-next-line no-await-in-loop
    if (!resp.ok) throw new Error(await readError(resp));
    // eslint-disable-next-line no-await-in-loop
    const json = await resp.json();
    const children = json.children || json.audiences || [];
    all.push(...children);
    const total = json._page?.totalCount;
    const next = json._page?.next;
    if (!children.length || children.length < PAGE_SIZE || (total && all.length >= total)) break;
    // Prefer the API's own cursor; fall back to offset paging.
    const nextStart = next !== undefined && next !== null && next !== '' ? Number(next) : start + PAGE_SIZE;
    if (!(nextStart > start)) break;
    start = nextStart;
  }

  return {
    audiences: all.map(normalizeAudience),
    source: `Real-Time CDP · ${config.sandbox}`,
  };
}
