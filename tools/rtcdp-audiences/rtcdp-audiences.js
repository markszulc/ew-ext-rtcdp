// eslint-disable-next-line import/no-unresolved
import DA_SDK from 'https://da.live/nx/utils/sdk.js';
import {
  DEFAULT_CONFIG, MODES, fetchAudiences, loadLocalConfig, loadSiteConfig, saveLocalConfig,
} from './rtcdp-api.js';
import {
  buildPageTerms, contentGaps, extractPage, rankAudiences, topTerms,
} from './relevance.js';
import { DEMO_PAGE_HTML } from './demo-data.js';
import loadSpectrum from './spectrum.js';

const SDK_TIMEOUT = 3000;

const state = {
  sdk: null,
  context: {},
  config: { ...DEFAULT_CONFIG },
  audiences: [],
  source: '',
  page: null,
  pageTerms: new Map(),
  ranked: [],
  tab: 'relevant',
  query: '',
  sort: 'relevance',
  loading: false,
  error: '',
};

const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const full = new Intl.NumberFormat();
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

function relativeTime(ms) {
  if (!ms) return 'unknown';
  const diff = (ms - Date.now()) / 1000;
  if (Math.abs(diff) < 3600) return 'just now';
  const units = [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
  const [unit, secs] = units.find(([, s]) => Math.abs(diff) >= s) || ['minute', 60];
  return rtf.format(Math.round(diff / secs), unit);
}

const EVALUATION = {
  edge: {
    label: 'Edge',
    variant: 'fuchsia',
    hint: 'Evaluated in real time on the Edge Network.',
    tip: 'Qualifies in real time, during the visit. A good fit for a personalised variant of this page.',
  },
  streaming: {
    label: 'Streaming',
    variant: 'seafoam',
    hint: 'Qualifies within minutes of new events.',
    tip: 'Qualifies within minutes. Write for the next step or the next visit, e.g. follow-up offers.',
  },
  batch: {
    label: 'Batch',
    variant: 'neutral',
    hint: 'Re-evaluated once every 24 hours.',
    tip: 'Refreshed daily. Write for known customers and their history rather than what they did this visit.',
  },
};
const STATE_LIGHT = {
  published: ['positive', 'Active'], active: ['positive', 'Active'],
  draft: ['neutral', 'Draft'], inactive: ['notice', 'Inactive'], deleted: ['negative', 'Deleted'],
};
const RELEVANCE = {
  high: ['positive', 'Strong match'], medium: ['informative', 'Good match'], low: ['neutral', 'Weak match'],
};

/* ---------- Feedback ---------- */

function toast(message, variant = 'positive') {
  const t = $('#toast');
  t.variant = variant;
  t.textContent = message;
  t.open = false;
  requestAnimationFrame(() => { t.open = true; });
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = Object.assign(document.createElement('textarea'), { value: text, readOnly: true });
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}

/* ---------- Rendering ---------- */

function renderHeader() {
  const light = $('#source');
  const { mode } = state.config;
  if (state.error) {
    light.variant = 'negative';
    light.textContent = 'Not connected';
  } else if (mode === 'demo') {
    light.variant = 'notice';
    light.textContent = 'Demo data';
  } else {
    light.variant = state.loading ? 'neutral' : 'positive';
    light.textContent = state.source || mode;
  }
}

function renderPage() {
  const el = $('#page-context');
  const { context, page } = state;
  const path = context.path || (state.sdk ? '' : '/demo/espresso-at-home');
  const terms = topTerms(state.pageTerms, 8);
  const gaps = state.loading || state.error ? [] : contentGaps(state.ranked);
  el.innerHTML = `
    <div class="page-row">
      <span class="detail">Editing</span>
      <span class="page-path" title="${esc(path)}">${esc(path || 'Unknown page')}</span>
    </div>
    ${page?.title ? `<h2 class="heading heading-xs">${esc(page.title)}</h2>` : ''}
    ${terms.length
    ? `<sp-tags aria-label="Detected page topics">${terms.map((t) => `<sp-tag size="s">${esc(t)}</sp-tag>`).join('')}</sp-tags>`
    : '<p class="body subdued">No topics detected yet. Add a heading or some copy.</p>'}
    ${gaps.length ? `
    <sp-divider size="s"></sp-divider>
    <span class="detail">Matching audiences also care about</span>
    <sp-tags aria-label="Topics missing from this page">${gaps.map((g) => `
      <sp-tag size="s" title="Not mentioned on this page · ${g.audiences} matching audience${g.audiences === 1 ? '' : 's'}">
        <sp-icon-add-circle slot="icon"></sp-icon-add-circle>${esc(g.label)}
      </sp-tag>`).join('')}
    </sp-tags>
    <sp-help-text size="s">Not mentioned on this page yet. Consider covering them.</sp-help-text>` : ''}`;
}

function filteredAudiences() {
  const q = state.query.trim().toLowerCase();
  let list = state.ranked;
  if (state.tab === 'relevant') list = list.filter((r) => r.relevance);
  if (q) {
    list = list.filter(({ audience: a }) => `${a.name} ${a.description} ${a.audienceId}`.toLowerCase().includes(q));
  }
  const sorters = {
    relevance: (a, b) => b.score - a.score || (b.audience.profiles ?? 0) - (a.audience.profiles ?? 0),
    size: (a, b) => (b.audience.profiles ?? -1) - (a.audience.profiles ?? -1),
    name: (a, b) => a.audience.name.localeCompare(b.audience.name),
    updated: (a, b) => (b.audience.updated ?? 0) - (a.audience.updated ?? 0),
  };
  return [...list].sort(sorters[state.sort] || sorters.relevance);
}

function topicsHtml(topics) {
  if (!topics?.length) return '';
  const shown = topics.slice(0, 7);
  const group = (label, items, icon, hint) => (items.length ? `
    <div class="topic-group">
      <span class="detail">${label}</span>
      <sp-tags aria-label="${label}">${items.map((t) => `
        <sp-tag size="s" title="${hint}"><sp-icon-${icon} slot="icon"></sp-icon-${icon}>${esc(t.label)}</sp-tag>`).join('')}
      </sp-tags>
    </div>` : '');
  return group('On this page', shown.filter((t) => t.onPage), 'checkmark-circle', 'Already on this page')
    + group('Cares about, not on the page yet', shown.filter((t) => !t.onPage), 'add-circle', 'Not on this page yet');
}

function cardHtml({
  audience: a, relevance, topics,
}, maxProfiles) {
  const evalInfo = EVALUATION[a.evaluation];
  const [lightVariant, lightLabel] = STATE_LIGHT[a.state?.toLowerCase()] || ['neutral', a.state];
  const pct = a.profiles && maxProfiles ? Math.max(1, Math.round((a.profiles / maxProfiles) * 100)) : 0;
  const rel = RELEVANCE[relevance];
  return `
  <article class="card" data-id="${esc(a.id)}">
    <header class="card-head">
      <h3 class="heading heading-xxs">${esc(a.name)}</h3>
      ${rel ? `<sp-badge size="s" variant="${rel[0]}">${rel[1]}</sp-badge>` : ''}
    </header>
    ${a.description ? `<p class="body subdued">${esc(a.description)}</p>` : ''}
    <div class="size" title="${a.profiles === null ? 'Size not available' : `${full.format(a.profiles)} profiles`}">
      <span class="heading heading-s">${a.profiles === null ? '—' : compact.format(a.profiles)}</span>
      <span class="body subdued">profiles</span>
    </div>
    ${a.profiles === null ? '' : `<sp-meter size="s" progress="${pct}" label="Size vs. largest audience"></sp-meter>`}
    ${topicsHtml(topics)}
    ${evalInfo ? `<div class="tip"><sp-icon-clock size="s"></sp-icon-clock><p class="body subdued">${esc(evalInfo.tip)}</p></div>` : ''}
    <div class="card-meta">
      <sp-status-light size="s" variant="${lightVariant}">${esc(lightLabel)}</sp-status-light>
      ${evalInfo ? `<sp-badge size="s" variant="${evalInfo.variant}" title="${esc(evalInfo.hint)}">${evalInfo.label}</sp-badge>` : ''}
      <span class="body subdued">Updated ${relativeTime(a.updated)}</span>
    </div>
    <sp-accordion size="s" allow-multiple>
      <sp-accordion-item label="Details">
        <dl class="body">
          <dt>Audience ID</dt><dd><code>${esc(a.audienceId)}</code></dd>
          <dt>Origin</dt><dd>${esc(a.origin.replace(/_/g, ' ').toLowerCase())}</dd>
          ${a.namespace ? `<dt>Namespace</dt><dd>${esc(a.namespace)}</dd>` : ''}
          ${a.mergePolicyId ? `<dt>Merge policy</dt><dd><code>${esc(a.mergePolicyId)}</code></dd>` : ''}
          ${a.labels.length ? `<dt>Data usage labels</dt><dd>${a.labels.map(esc).join(', ')}</dd>` : ''}
          ${a.expression ? `<dt>Rule (PQL)</dt><dd><code class="pql">${esc(a.expression)}</code></dd>` : ''}
        </dl>
      </sp-accordion-item>
    </sp-accordion>
    <sp-action-group size="s" class="card-actions">
      <sp-action-button size="s" data-action="copy-brief" label="Copy audience brief">
        <sp-icon-text slot="icon"></sp-icon-text>Copy brief
      </sp-action-button>
      <sp-action-button size="s" quiet data-action="copy" label="Copy audience ID">
        <sp-icon-copy slot="icon"></sp-icon-copy>Copy ID
      </sp-action-button>
    </sp-action-group>
  </article>`;
}

function renderList() {
  const list = $('#list');
  const summary = $('#summary');
  $('#toolbar').hidden = state.loading || !!state.error;
  if (state.loading) {
    summary.textContent = '';
    list.innerHTML = '<div class="center"><sp-progress-circle indeterminate size="m" label="Loading audiences"></sp-progress-circle><p class="body subdued">Loading audiences…</p></div>';
    return;
  }
  if (state.error) {
    summary.textContent = '';
    list.innerHTML = `
      <sp-alert-banner variant="negative" open>Couldn't load audiences. ${esc(state.error)}</sp-alert-banner>
      <sp-button-group size="s">
        <sp-button size="s" variant="secondary" data-action="open-settings">Settings</sp-button>
        <sp-button size="s" variant="secondary" treatment="outline" data-action="use-demo">Use demo data</sp-button>
      </sp-button-group>`;
    return;
  }

  const items = filteredAudiences();
  const maxProfiles = Math.max(0, ...state.audiences.map((a) => a.profiles ?? 0));
  if (state.tab === 'relevant') {
    const reach = items.reduce((sum, r) => sum + (r.audience.profiles ?? 0), 0);
    summary.innerHTML = items.length
      ? `${items.length} of ${state.audiences.length} audiences relate to this page · <span title="Audiences can overlap">up to ${compact.format(reach)} profiles</span>`
      : '';
  } else {
    summary.textContent = `${items.length} audience${items.length === 1 ? '' : 's'}`;
  }

  if (!items.length) {
    list.innerHTML = state.tab === 'relevant' && !state.query
      ? `<sp-illustrated-message heading="No matching audiences yet">
          <span slot="description">Nothing in this page's copy lines up with an audience name or rule. Add more descriptive headings, or browse <sp-link href="#" data-action="show-all">all audiences</sp-link>.</span>
        </sp-illustrated-message>`
      : `<sp-illustrated-message heading="No results">
          <span slot="description">No audiences match your search.</span>
        </sp-illustrated-message>`;
    return;
  }
  list.innerHTML = items.map((r) => cardHtml(r, maxProfiles)).join('');
}

function render() {
  renderHeader();
  renderPage();
  renderList();
}

/* ---------- Data ---------- */

function rerank() {
  state.ranked = rankAudiences(state.audiences, state.pageTerms);
}

function setPageHtml(html) {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  state.page = extractPage(doc);
  state.pageTerms = buildPageTerms(state.page);
  rerank();
  renderPage();
  if (!state.loading) renderList();
}

let pageTimer;
function onLiveDocument({ html }) {
  clearTimeout(pageTimer);
  pageTimer = setTimeout(() => setPageHtml(html), 600);
}

async function loadPageContent() {
  const { sdk, context } = state;
  if (!sdk) {
    setPageHtml(DEMO_PAGE_HTML);
    return;
  }
  try {
    sdk.actions.subscribeLiveDocument(onLiveDocument);
    return;
  } catch (e) {
    console.info('[rtcdp] Live document unavailable, falling back to saved source', e);
  }
  const { org, repo, path = '' } = context;
  if (!org || !repo || !path) return;
  try {
    const file = path.endsWith('.html') ? path : `${path}.html`;
    const resp = await sdk.actions.daFetch(`https://admin.da.live/source/${org}/${repo}${file}`);
    if (resp.ok) setPageHtml(await resp.text());
  } catch (e) {
    console.info('[rtcdp] Could not read page source', e);
  }
}

let abort;
async function loadAudiences() {
  abort?.abort();
  abort = new AbortController();
  state.loading = true;
  state.error = '';
  render();
  try {
    const { audiences, source } = await fetchAudiences(state.config, {
      token: state.sdk?.token,
      signal: abort.signal,
    });
    state.audiences = audiences;
    state.source = source;
    rerank();
  } catch (e) {
    if (e.name === 'AbortError') return;
    state.error = e.message === 'Failed to fetch'
      ? 'Network error. Check the proxy URL, and that the App Builder action is deployed as a web action.'
      : e.message;
    state.audiences = [];
    state.ranked = [];
  }
  state.loading = false;
  render();
}

/* ---------- Actions ---------- */

function buildBrief({ audience: a, topics }) {
  const evalInfo = EVALUATION[a.evaluation];
  const onPage = topics.filter((t) => t.onPage).map((t) => t.label);
  const missing = topics.filter((t) => !t.onPage).map((t) => t.label);
  return [
    `Audience: ${a.name}`,
    a.description && `Who: ${a.description}`,
    a.profiles !== null && `Size: ${full.format(a.profiles)} profiles`,
    topics.length && `Cares about: ${topics.map((t) => t.label).join(', ')}`,
    onPage.length && `Already on the page: ${onPage.join(', ')}`,
    missing.length && `Not on the page yet: ${missing.join(', ')}`,
    evalInfo && `Timing: ${evalInfo.tip}`,
    `Audience ID: ${a.audienceId}`,
  ].filter(Boolean).join('\n');
}

async function onListClick(e) {
  const target = e.target.closest('[data-action]');
  if (!target) return;
  const { action } = target.dataset;
  if (action === 'show-all') {
    e.preventDefault();
    $('#tabs').selected = 'all';
    state.tab = 'all';
    renderList();
    return;
  }
  if (action === 'open-settings') { openSettings(); return; } // eslint-disable-line no-use-before-define
  if (action === 'use-demo') {
    state.config = { ...state.config, mode: 'demo' };
    loadAudiences();
    return;
  }
  const id = target.closest('.card')?.dataset.id;
  const item = state.ranked.find((r) => r.audience.id === id);
  if (!item) return;
  if (action === 'copy') {
    toast(await copyText(item.audience.audienceId) ? 'Audience ID copied' : 'Copy blocked by the browser');
  } else if (action === 'copy-brief') {
    toast(await copyText(buildBrief(item)) ? 'Audience brief copied' : 'Copy blocked by the browser');
  }
}

/* ---------- Settings ---------- */

const SETTING_FIELDS = ['sandbox', 'proxyUrl'];

function syncSettingsVisibility() {
  const mode = $('#set-mode').value;
  document.querySelectorAll('[data-modes]').forEach((el) => {
    el.hidden = !el.dataset.modes.split(' ').includes(mode);
  });
}

function openSettings() {
  $('#settings').hidden = false;
  $('#set-mode').value = state.config.mode;
  SETTING_FIELDS.forEach((f) => { $(`#set-${f}`).value = state.config[f] || ''; });
  syncSettingsVisibility();
  $('#settings-toggle').selected = true;
}

function closeSettings() {
  $('#settings').hidden = true;
  $('#settings-toggle').selected = false;
}

function saveSettings() {
  const next = { mode: $('#set-mode').value };
  SETTING_FIELDS.forEach((f) => { next[f] = $(`#set-${f}`).value.trim(); });
  state.config = { ...state.config, ...next };
  saveLocalConfig(state.context.org, state.context.site, state.config);
  closeSettings();
  loadAudiences();
}

/* ---------- Boot ---------- */

async function initTheme() {
  const theme = $('#theme');
  try {
    await loadSpectrum();
  } catch (e) {
    console.error('[rtcdp] Spectrum Web Components failed to load', e);
    return;
  }
  // Attributes are applied after fragment registration so <sp-theme> adopts the styles.
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const apply = () => { theme.color = dark.matches ? 'dark' : 'light'; };
  theme.system = 'spectrum-two';
  theme.scale = 'medium';
  apply();
  dark.addEventListener('change', apply);
}

async function connectSdk() {
  const timeout = new Promise((r) => { setTimeout(() => r(null), SDK_TIMEOUT); });
  return Promise.race([DA_SDK, timeout]);
}

function bindEvents() {
  $('#list').addEventListener('click', onListClick);
  $('#tabs').addEventListener('change', (e) => {
    state.tab = e.target.selected;
    const sort = $('#sort');
    if (state.tab === 'all' && state.sort === 'relevance') { state.sort = 'size'; sort.value = 'size'; }
    if (state.tab === 'relevant') { state.sort = 'relevance'; sort.value = 'relevance'; }
    renderList();
  });
  const search = $('#search');
  search.addEventListener('submit', (e) => e.preventDefault());
  search.addEventListener('input', () => { state.query = search.value; renderList(); });
  search.addEventListener('reset', () => { state.query = ''; renderList(); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; renderList(); });
  $('#refresh').addEventListener('click', loadAudiences);
  $('#settings-toggle').addEventListener('click', () => {
    if ($('#settings').hidden) openSettings(); else closeSettings();
  });
  $('#set-mode').addEventListener('change', syncSettingsVisibility);
  $('#settings-save').addEventListener('click', saveSettings);
  $('#settings-cancel').addEventListener('click', closeSettings);
}

(async function init() {
  initTheme();
  bindEvents();
  state.loading = true;
  render();

  const sdk = await connectSdk();
  if (sdk) {
    state.sdk = sdk;
    state.context = { ...sdk.context, site: sdk.context?.site || sdk.context?.repo };
  } else {
    $('#standalone').hidden = false;
  }

  const { org, site } = state.context;
  const siteConfig = await loadSiteConfig({ org, site, fetchFn: sdk?.actions?.daFetch });
  state.config = {
    ...DEFAULT_CONFIG,
    ...siteConfig,
    ...loadLocalConfig(org, site),
  };
  // Live data whenever a proxy is configured, unless explicitly set to demo.
  if (!MODES.includes(state.config.mode)) state.config.mode = state.config.proxyUrl ? 'proxy' : 'demo';

  await Promise.all([loadPageContent(), loadAudiences()]);
}());
