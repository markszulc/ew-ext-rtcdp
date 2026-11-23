/*
 * RTCDP audiences proxy for the Experience Workspace "Audience Insights" panel.
 *
 * GET ?sandbox=prod&limit=100&start=0
 *   Authorization: Bearer <the editor's Experience Workspace IMS token>
 *
 * 1. Validates the caller's IMS token (and optionally its client ID and request origin).
 * 2. Gets a server-to-server OAuth token for Experience Platform (cached while valid).
 * 3. Calls the AEP Segmentation Audiences API and returns a trimmed response:
 *    { children: [...], _page: { totalCount, next } }
 */

const IMS = 'https://ims-na1.adobelogin.com';
const AUDIENCES_API = 'https://platform.adobe.io/data/core/ups/audiences';
const DEFAULT_SCOPES = 'openid,AdobeID,read_organizations,additional_info.projectedProductContext,session';

let serviceToken = null; // { value, expires }

const list = (value) => String(value || '').split(',').map((s) => s.trim()).filter(Boolean);

// Adobe I/O Runtime adds `Access-Control-Allow-Origin: *` to web action responses. Setting it here
// too produces "*,*", which browsers reject. ALLOWED_ORIGINS is enforced server-side below.
function respond(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': statusCode === 200 ? 'private, max-age=60' : 'no-store',
    },
    body,
  };
}

function tokenClaims(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

async function validateCaller(token, params) {
  const claims = tokenClaims(token);
  if (!claims?.client_id) return false;
  const allowedClients = list(params.ALLOWED_CLIENT_IDS);
  if (allowedClients.length && !allowedClients.includes(claims.client_id)) return false;
  const url = new URL(`${IMS}/ims/validate_token/v1`);
  url.searchParams.set('type', 'access_token');
  url.searchParams.set('client_id', claims.client_id);
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) return false;
  const json = await resp.json();
  return json.valid === true;
}

async function getServiceToken(params) {
  if (serviceToken && serviceToken.expires > Date.now() + 60000) return serviceToken.value;
  const resp = await fetch(`${IMS}/ims/token/v3`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: params.AEP_CLIENT_ID,
      client_secret: params.AEP_CLIENT_SECRET,
      scope: params.AEP_SCOPES || DEFAULT_SCOPES,
    }),
  });
  if (!resp.ok) throw new Error(`IMS token request failed: ${resp.status}`);
  const json = await resp.json();
  serviceToken = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
  return serviceToken.value;
}

const trim = (a) => ({
  id: a.id,
  audienceId: a.audienceId,
  name: a.name,
  description: a.description,
  expression: a.expression,
  metrics: a.metrics,
  evaluationInfo: a.evaluationInfo,
  originName: a.originName,
  type: a.type,
  namespace: a.namespace,
  lifecycleState: a.lifecycleState,
  labels: a.labels,
  mergePolicyId: a.mergePolicyId,
  updateTime: a.updateTime,
  updateEpoch: a.updateEpoch,
});

async function main(params) {
  const headers = params.__ow_headers || {};
  const origin = headers.origin || '';
  const allowedOrigins = list(params.ALLOWED_ORIGINS);
  if (allowedOrigins.length && !allowedOrigins.includes(origin)) {
    return respond(403, { error: 'Origin not allowed' });
  }

  if (!params.AEP_CLIENT_ID || !params.AEP_CLIENT_SECRET || !params.AEP_ORG_ID) {
    return respond(500, { error: 'Proxy is missing AEP_CLIENT_ID, AEP_CLIENT_SECRET or AEP_ORG_ID' });
  }

  const auth = headers.authorization || '';
  const callerToken = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!callerToken) {
    return respond(401, { error: 'Missing Adobe IMS token (expected "Authorization: Bearer <token>")' });
  }
  if (!(await validateCaller(callerToken, params).catch(() => false))) {
    return respond(401, { error: 'Invalid or expired Adobe IMS token, or its client ID is not allowed' });
  }

  const sandbox = String(params.sandbox || 'prod');
  const allowedSandboxes = list(params.ALLOWED_SANDBOXES || 'prod');
  if (!allowedSandboxes.includes(sandbox)) {
    return respond(403, { error: `Sandbox "${sandbox}" is not allowed` });
  }
  const limit = Math.min(100, Math.max(1, parseInt(params.limit, 10) || 100));
  const start = Math.max(0, parseInt(params.start, 10) || 0);

  try {
    const token = await getServiceToken(params);
    const url = new URL(AUDIENCES_API);
    url.searchParams.set('limit', limit);
    url.searchParams.set('start', start);
    url.searchParams.set('sort', 'updateTime:desc');
    const resp = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        'x-api-key': params.AEP_CLIENT_ID,
        'x-gw-ims-org-id': params.AEP_ORG_ID,
        'x-sandbox-name': sandbox,
        Accept: 'application/json',
      },
    });
    if (!resp.ok) {
      const status = [401, 403, 404].includes(resp.status) ? resp.status : 502;
      let detail = '';
      try {
        const err = await resp.json();
        detail = err.detail || err.title || err.message || err.error_description || '';
      } catch { /* non-JSON body */ }
      return respond(status, {
        error: `Experience Platform returned ${resp.status}${detail ? `: ${String(detail).slice(0, 300)}` : ''}`,
      });
    }
    const json = await resp.json();
    return respond(200, {
      children: (json.children || []).map(trim),
      _page: { totalCount: json._page?.totalCount, next: json._page?.next },
    });
  } catch (e) {
    return respond(502, { error: e.message });
  }
}

module.exports = { main, resetCache: () => { serviceToken = null; } };
