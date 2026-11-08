'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateOffers, estimatedLocalFeeNgn } = require('../hiro-finance');

test('FZR offers are validated and normalized with supplier titles', () => {
  const offers = validateOffers({ ok: true, category_id: 'blood_strike', offers: [
    { offer_id: '51_bc', name: '51 BC', price_usd: '0.50' },
    { offer_id: '105_bc', title: '105 BC', price_usd: 1.1 }
  ] }, 'blood_strike');
  assert.deepEqual(offers, [
    { offerId: '51_bc', title: '51 BC', supplierNote: '', regionRestriction: 'GLOBAL VERSION.', priceUsd: 0.5 },
    { offerId: '105_bc', title: '105 BC', supplierNote: '', regionRestriction: 'GLOBAL VERSION.', priceUsd: 1.1 }
  ]);
});

test('FZR offer validation rejects partial pages, duplicate IDs and invalid costs', () => {
  assert.throws(() => validateOffers({ ok: true, category_id: 'x', offers: [{ offer_id: 'a', price_usd: 1 }], meta: { has_more: true } }, 'x'));
  assert.throws(() => validateOffers({ ok: true, category_id: 'x', offers: [{ offer_id: 'a', price_usd: 1 }, { offer_id: 'a', price_usd: 2 }] }, 'x'));
  assert.throws(() => validateOffers({ ok: true, category_id: 'x', offers: [{ offer_id: 'a', price_usd: 0 }] }, 'x'));
});

test('Paystack local fee projection remains bounded', () => {
  assert.equal(estimatedLocalFeeNgn(0), 0);
  assert.ok(estimatedLocalFeeNgn(100000) > 0);
  assert.ok(estimatedLocalFeeNgn(10000000) <= 2000);
});
