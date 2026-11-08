'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { calculateCouponDiscount, calculateCoinRedemption } = require('../lib/rewards');

test('percentage coupon is capped and never exceeds eligible subtotal', () => {
  const coupon = { active: 1, discount_type: 'percent', discount_value: 20, min_order_ngn: 0, max_discount_ngn: 1500 };
  assert.equal(calculateCouponDiscount({ coupon, subtotalNgn: 10000, eligibleSubtotalNgn: 5000 }), 1000);
});

test('fixed coupon cannot discount beyond eligible subtotal', () => {
  const coupon = { active: 1, discount_type: 'fixed', discount_value: 5000, min_order_ngn: 0 };
  assert.equal(calculateCouponDiscount({ coupon, subtotalNgn: 1200, eligibleSubtotalNgn: 1200 }), 1200);
});

test('coupon start, expiry and minimum spend are enforced', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  assert.throws(() => calculateCouponDiscount({ coupon: { active: 1, discount_type: 'fixed', discount_value: 100, starts_at: '2026-10-31T00:00:00Z' }, subtotalNgn: 1000, now }), /not active yet/);
  assert.throws(() => calculateCouponDiscount({ coupon: { active: 1, discount_type: 'fixed', discount_value: 100, ends_at: '2026-10-29T00:00:00Z' }, subtotalNgn: 1000, now }), /expired/);
  assert.throws(() => calculateCouponDiscount({ coupon: { active: 1, discount_type: 'fixed', discount_value: 100, min_order_ngn: 5000 }, subtotalNgn: 1000 }), /minimum spend/);
});

test('coin redemption obeys enabled state, balance and configured cap', () => {
  assert.deepEqual(calculateCoinRedemption({ requestedCoins: 500, balance: 300, coinValueNgn: 2, maxPercent: 10, subtotalAfterCoupon: 4000, enabled: true }), { coins: 200, discountNgn: 400 });
  assert.throws(() => calculateCoinRedemption({ requestedCoins: 10, balance: 10, coinValueNgn: 0, maxPercent: 20, subtotalAfterCoupon: 1000, enabled: false }), /not currently enabled/);
});
