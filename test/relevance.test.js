import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildPageTerms, contentGaps, rankAudiences, stem, termsMatch,
} from '../tools/rtcdp-audiences/relevance.js';
import { normalizeAudience } from '../tools/rtcdp-audiences/rtcdp-api.js';
import { DEMO_AUDIENCES } from '../tools/rtcdp-audiences/demo-data.js';

const audiences = DEMO_AUDIENCES.map(normalizeAudience);

test('stemming lets plural and derived forms match', () => {
  assert.equal(stem('baristas'), 'barista');
  assert.ok(termsMatch(stem('subscribers'), stem('subscription')));
  assert.ok(termsMatch(stem('sustainability'), stem('sustainable')));
  assert.ok(!termsMatch(stem('cold'), stem('coffee')));
});

test('espresso page ranks espresso and subscription audiences highest', () => {
  const terms = buildPageTerms({
    title: 'Brew the perfect espresso at home',
    headings: ['Subscribe to MyBarista'],
    keywords: ['espresso', 'home barista'],
    body: 'Pick a grinder and an espresso machine.',
  });
  const ranked = rankAudiences(audiences, terms);
  const top3 = ranked.slice(0, 3).map((r) => r.audience.name);
  assert.ok(top3.includes('Espresso Enthusiasts'), top3.join());
  assert.equal(ranked[0].relevance, 'high');
  assert.ok(ranked[0].matches.length > 0);
  const unrelated = ranked.find((r) => r.audience.name.startsWith('Mobile App Users'));
  assert.equal(unrelated.score, 0);
  assert.equal(unrelated.relevance, null);
});

test('empty page yields no relevant audiences', () => {
  const ranked = rankAudiences(audiences, buildPageTerms({}));
  assert.ok(ranked.every((r) => r.score === 0 && r.relevance === null));
});

test('topics flag what is on the page and gaps skip behaviour words', () => {
  const terms = buildPageTerms({ title: 'Espresso grinders for home baristas' });
  const ranked = rankAudiences(audiences, terms);
  const baristas = ranked.find((r) => r.audience.name.startsWith('Home Baristas'));
  assert.ok(baristas.topics.some((t) => t.label === 'grinders' && t.onPage));
  assert.ok(baristas.gaps.includes('kettles'));
  assert.ok(!baristas.gaps.includes('browsed'));
  const gaps = contentGaps(ranked).map((g) => g.label);
  assert.ok(gaps.length > 0);
  assert.ok(!gaps.includes('espresso'));
});

test('normalizeAudience maps API fields defensively', () => {
  const a = normalizeAudience({
    id: 'x',
    name: 'N',
    evaluationInfo: { batch: { enabled: false }, continuous: { enabled: true } },
    updateTime: 1642745034000000, // microseconds
    expression: { value: 'a = "b"' },
  });
  assert.equal(a.evaluation, 'streaming');
  assert.equal(a.profiles, null);
  assert.equal(a.updated, 1642745034000);
  assert.equal(a.expression, 'a = "b"');
  assert.equal(a.audienceId, 'x');
});
