import { test } from 'node:test';
import assert from 'node:assert/strict';
import { coworkerPrompt, singularAudienceName } from '../tools/rtcdp-audiences/coworker.js';

test('builds the Coworker prompt with the singular audience name', () => {
  assert.equal(
    coworkerPrompt('Fitness Fuel Seekers'),
    "Tell me more about the CDP Audience 'Fitness Fuel Seeker' including the persona rules from Experience Context. ",
  );
});

test('singularises the head noun and keeps qualifiers', () => {
  const cases = {
    'Espresso Enthusiasts': 'Espresso Enthusiast',
    'MyBarista Subscribers – Active': 'MyBarista Subscriber – Active',
    'Lapsed Subscribers (90 days)': 'Lapsed Subscriber (90 days)',
    'High-Value Customers (Top 10% CLV)': 'High-Value Customer (Top 10% CLV)',
    'Cart Abandoners – Last 7 Days': 'Cart Abandoner – Last 7 Days',
    'Home Baristas – Equipment Browsers': 'Home Barista – Equipment Browsers',
    'Coffee Families': 'Coffee Family',
    'Gift Boxes': 'Gift Box',
    'Busy People': 'Busy Person',
  };
  Object.entries(cases).forEach(([plural, singular]) => {
    assert.equal(singularAudienceName(plural), singular);
  });
});

test('leaves names that are already singular unchanged', () => {
  ['Loyalty Gold Tier', 'Decaf & Tea Preference (CRM import)', 'Fitness Status', 'Small Business'].forEach((name) => {
    assert.equal(singularAudienceName(name), name);
  });
});
