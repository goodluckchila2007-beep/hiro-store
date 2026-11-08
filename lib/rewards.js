'use strict';

function calculateCouponDiscount({ coupon, subtotalNgn, eligibleSubtotalNgn = subtotalNgn, now = new Date() }) {
  if (!coupon || Number(coupon.active) !== 1) throw new Error('This coupon is not active.');
  const current = new Date(now).getTime();
  if (coupon.starts_at && current < new Date(coupon.starts_at).getTime()) throw new Error('This coupon is not active yet.');
  if (coupon.ends_at && current > new Date(coupon.ends_at).getTime()) throw new Error('This coupon has expired.');
  if (!Number.isFinite(eligibleSubtotalNgn) || eligibleSubtotalNgn < Number(coupon.min_order_ngn || 0)) throw new Error('Your eligible items do not meet this coupon’s minimum spend.');
  const value = Number(coupon.discount_value);
  if (!Number.isFinite(value) || value <= 0) throw new Error('This coupon has an invalid discount.');
  let discount = coupon.discount_type === 'percent' ? Math.floor(eligibleSubtotalNgn * value / 100) : Math.floor(value);
  if (coupon.max_discount_ngn && Number(coupon.max_discount_ngn) > 0) discount = Math.min(discount, Number(coupon.max_discount_ngn));
  discount = Math.max(0, Math.min(Math.floor(eligibleSubtotalNgn), Math.floor(Number(subtotalNgn)), discount));
  if (!discount) throw new Error('This coupon does not apply a discount to this order.');
  return discount;
}

function calculateCoinRedemption({ requestedCoins, balance, coinValueNgn, maxPercent, subtotalAfterCoupon, enabled }) {
  const requested = Number(requestedCoins || 0);
  if (!Number.isInteger(requested) || requested < 0) throw new Error('Enter a valid number of Hiro Coins.');
  if (!requested) return { coins: 0, discountNgn: 0 };
  const value = Number(coinValueNgn);
  const percent = Number(maxPercent);
  if (!enabled || !Number.isFinite(value) || value <= 0 || !Number.isFinite(percent) || percent <= 0) {
    throw new Error('Hiro Coins are not currently enabled for redemption.');
  }
  const available = Math.max(0, Math.floor(Number(balance) || 0));
  const maxDiscount = Math.floor(Math.max(0, Number(subtotalAfterCoupon)) * Math.min(100, percent) / 100);
  const maxCoinsByValue = Math.floor(maxDiscount / value);
  const coins = Math.min(requested, available, maxCoinsByValue);
  if (!coins) throw new Error('There are not enough redeemable Hiro Coins for this order.');
  return { coins, discountNgn: Math.min(maxDiscount, Math.floor(coins * value)) };
}

module.exports = { calculateCouponDiscount, calculateCoinRedemption };
