'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FZR_CATEGORIES, getCategory, normalizePlayerFields, mapFzrStatus } = require('../lib/fzr-catalogue');

test('launch catalogue contains the ten approved FZR categories', () => {
  assert.equal(FZR_CATEGORIES.length, 10);
  assert.equal(new Set(FZR_CATEGORIES.map(item => item.id)).size, 10);
});

test('category-specific fields are validated without forcing MLBB server fields on every game', () => {
  assert.deepEqual(normalizePlayerFields('blood_strike', { player_id: '12345' }), { player_id: '12345' });
  assert.deepEqual(normalizePlayerFields('codm_activision_in', { user_id: 'abc' }), { user_id: 'abc' });
  assert.deepEqual(normalizePlayerFields('genshin_impact_global', { player_id: '123', server: 'Asia' }), { player_id: '123', server: 'Asia' });
  assert.throws(() => normalizePlayerFields('genshin_impact_global', { player_id: '123', server: 'Mars' }), /valid Server/);
  assert.throws(() => normalizePlayerFields('mobile_legends_global', { player_id: '123' }), /Zone \/ Server ID is required/);
});

test('unknown categories are rejected instead of silently defaulting to MLBB Global', () => {
  assert.equal(getCategory('not_a_real_category'), null);
  assert.throws(() => normalizePlayerFields('not_a_real_category', { player_id: '123' }), /not enabled/);
});

test('supplier status mapping preserves cautious treatment of unknown statuses', () => {
  assert.equal(mapFzrStatus('created'), 'Processing');
  assert.equal(mapFzrStatus('processing'), 'Processing');
  assert.equal(mapFzrStatus('completed'), 'Completed');
  assert.equal(mapFzrStatus('refund'), 'Failed');
  assert.equal(mapFzrStatus('mystery_state'), 'Review Required');
});

test('MLBB Global restrictions identify restricted packs by their displayed denomination, not guessed supplier IDs', () => {
  const { getOfferRestriction } = require('../lib/fzr-catalogue');
  assert.match(getOfferRestriction('mobile_legends_global', 'supplier-unknown', '78+8 Diamonds'), /MY, SG, PH, ID or RU/);
  assert.match(getOfferRestriction('mobile_legends_global', 'weekly_pass', 'Weekly Pass'), /MY, SG, PH, ID or RU/);
  assert.match(getOfferRestriction('mobile_legends_global', 'another_offer', 'Diamond bundle'), /Indonesia or Brazil/);
});
