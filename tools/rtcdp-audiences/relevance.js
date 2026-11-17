// Pure helpers to match RTCDP audiences against the content of the page being edited.

const STOPWORDS = new Set(`a about above after again all also an and any are as at be because been
before being below between both but by can could did do does doing down during each few for from
further get got had has have having here how i if in into is it its just last least less let like
made make many may me more most much must my new no nor not now of off on once only or other our out
over own per same see she should so some such than that the their them then there these they this
those through to too under until up us very via was we were what when where which while who whom why
will with within would you your yours day days week weeks month months year years count true false
exists occurs timestamp name contains before during equals one two three four five least sure
page pages www http https com html read more learn click here home main`.split(/\s+/));

const SUFFIXES = ['ations', 'ation', 'ings', 'ing', 'ers', 'er', 'ies', 'es', 's'];

// Words that describe how an audience behaves rather than what it is interested in.
const BEHAVIOUR_WORDS = `active inactive browse browsed browser browsers bought buy buyer buyers purchase
purchased purchases customer customers user users member members visitor visitors visit visited
view viewed twice times enthusiast enthusiasts product products target targeted lapsed former
cancelled canceled paused win back segment audience profile profiles people qualified recent
recently returning repeat engaged session sessions event events opened clicked`.split(/\s+/);

export function stem(word) {
  let w = word.toLowerCase();
  // eslint-disable-next-line no-restricted-syntax
  for (const suffix of SUFFIXES) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) {
      w = w.slice(0, -suffix.length) + (suffix === 'ies' ? 'y' : '');
      break;
    }
  }
  return w;
}

const BEHAVIOUR = new Set(BEHAVIOUR_WORDS.map(stem));

export function tokenize(text = '') {
  return String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
}

function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  return i;
}

export function termsMatch(a, b) {
  if (a === b) return true;
  return a.length >= 6 && b.length >= 6 && commonPrefix(a, b) >= 6;
}

/**
 * Builds a weighted term map from page fields.
 * @param {{title?: string, headings?: string[], keywords?: string[], description?: string,
 *   body?: string}} page
 * @returns {Map<string, {weight: number, label: string}>}
 */
export function buildPageTerms(page) {
  const terms = new Map();
  const add = (text, weight, cap = Infinity) => {
    const seen = new Map();
    tokenize(text).forEach((word) => {
      const key = stem(word);
      const n = (seen.get(key) || 0) + 1;
      seen.set(key, n);
      if (n > cap) return;
      const entry = terms.get(key) || { weight: 0, label: word };
      entry.weight += weight;
      terms.set(key, entry);
    });
  };
  add(page.title, 3);
  (page.headings || []).forEach((h) => add(h, 2));
  (page.keywords || []).forEach((k) => add(k, 3));
  add(page.description, 2);
  add(page.body, 1, 3);
  return terms;
}

export function topTerms(terms, limit = 8) {
  return [...terms.values()]
    .sort((a, b) => b.weight - a.weight)
    .slice(0, limit)
    .map((t) => t.label);
}

function audienceTerms(aud) {
  const terms = new Map();
  const add = (text, weight) => tokenize(text).forEach((word) => {
    const key = stem(word);
    const prev = terms.get(key);
    if (!prev || prev.weight < weight) terms.set(key, { weight, label: word });
  });
  add(aud.description, 1);
  // Only quoted literals from PQL carry business meaning; attribute paths are noise.
  const literals = (aud.expression || '').match(/"([^"]+)"/g) || [];
  literals.forEach((l) => add(l, 1));
  add(aud.name, 2);
  return terms;
}

/**
 * Scores audiences against page terms. Terms shared by many audiences are down-weighted
 * (IDF) so generic brand words like "coffee" don't dominate.
 * @returns {Array<{audience: object, score: number, relevance: 'high'|'medium'|'low'|null,
 *   matches: string[], topics: Array<{label: string, onPage: boolean}>, gaps: string[]}>}
 *   sorted by score, descending
 */
export function rankAudiences(audiences, pageTerms) {
  const perAudience = audiences.map((a) => audienceTerms(a));
  const df = new Map();
  perAudience.forEach((terms) => terms.forEach((_, key) => df.set(key, (df.get(key) || 0) + 1)));
  const n = audiences.length || 1;

  const scored = audiences.map((audience, i) => {
    let score = 0;
    const matches = new Set();
    const topics = [];
    perAudience[i].forEach(({ weight: aWeight, label }, aKey) => {
      let best = 0;
      pageTerms.forEach(({ weight: pWeight }, pKey) => {
        if (termsMatch(aKey, pKey)) best = Math.max(best, pWeight);
      });
      const idf = Math.log(1 + n / df.get(aKey));
      if (!BEHAVIOUR.has(aKey)) topics.push({ label, onPage: best > 0, rank: aWeight * idf });
      if (best > 0) {
        score += Math.min(best, 6) * aWeight * idf;
        matches.add(label);
      }
    });
    topics.sort((a, b) => b.rank - a.rank);
    return {
      audience,
      score,
      matches: [...matches],
      // What this audience is about, most distinctive first, and which of those the page lacks.
      topics: topics.slice(0, 8).map(({ label, onPage }) => ({ label, onPage })),
      gaps: topics.filter((t) => !t.onPage).slice(0, 5).map((t) => t.label),
    };
  });

  const max = Math.max(0, ...scored.map((s) => s.score));
  scored.forEach((s) => {
    const ratio = max ? s.score / max : 0;
    if (ratio < 0.1) s.relevance = null;
    else if (ratio >= 0.6) s.relevance = 'high';
    else if (ratio >= 0.3) s.relevance = 'medium';
    else s.relevance = 'low';
  });
  return scored.sort((a, b) => b.score - a.score);
}

/**
 * Topics that the page's strong/good-match audiences care about but the page never mentions,
 * ordered by how many of those audiences share them.
 */
export function contentGaps(ranked, limit = 6) {
  const counts = new Map();
  ranked
    .filter((r) => r.relevance === 'high' || r.relevance === 'medium')
    .forEach((r) => r.gaps.forEach((g) => counts.set(g, (counts.get(g) || 0) + 1)));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([label, audiences]) => ({ label, audiences }));
}

/** Extracts page fields from a DA/EDS document (browser only: needs a Document). */
export function extractPage(doc) {
  const text = (el) => el?.textContent?.replace(/\s+/g, ' ').trim() || '';
  const meta = {};
  doc.querySelectorAll('.metadata > div').forEach((row) => {
    const [k, v] = row.children;
    if (k && v) meta[text(k).toLowerCase()] = text(v);
  });
  const metaBlocks = doc.querySelectorAll('.metadata');
  const clone = doc.body.cloneNode(true);
  clone.querySelectorAll('.metadata').forEach((m) => m.remove());
  return {
    title: meta.title || text(doc.querySelector('h1')),
    headings: [...doc.querySelectorAll('h2, h3')].map(text).filter(Boolean),
    keywords: (meta.keywords || meta.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
    description: meta.description || '',
    body: text(clone),
    hasMetadata: metaBlocks.length > 0,
  };
}
