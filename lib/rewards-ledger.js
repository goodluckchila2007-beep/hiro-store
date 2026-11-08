'use strict';
const { calculateCouponDiscount, calculateCoinRedemption } = require('./rewards');

function createRewardsLedger({ db, getSetting, getCategory }) {
  function getCoinBalance(userId) {
    const earned = Number(db.prepare(`SELECT COALESCE(SUM(amount), 0) AS total FROM coin_transactions WHERE user_id = ?`).get(userId)?.total || 0);
    const reserved = Number(db.prepare(`SELECT COALESCE(SUM(cr.coins), 0) AS total FROM coin_reservations cr
      INNER JOIN orders o ON o.order_id = cr.order_id
      WHERE cr.user_id = ? AND cr.status = 'reserved' AND o.status = 'Pending'`).get(userId)?.total || 0);
    return Math.max(0, earned - reserved);
  }

  function evaluateCheckoutRewards({ userId, subtotalNgn, items, couponCode, coinsRequested }) {
    let coupon = null;
    let couponDiscount = 0;
    let coinRedemption = { coins: 0, discountNgn: 0 };
    const cleanCode = String(couponCode || '').trim().toUpperCase();
    const requestedCoins = Number(coinsRequested || 0);

    if (cleanCode) {
      coupon = db.prepare(`SELECT * FROM coupons WHERE code = ?`).get(cleanCode);
      if (!coupon) throw new Error('That coupon code was not found.');
      const eligibleCategories = JSON.parse(coupon.eligible_categories_json || '[]');
      const eligibleItems = eligibleCategories.length ? items.filter(item => eligibleCategories.includes(item.categoryId)) : items;
      const eligibleSubtotal = eligibleItems.reduce((sum, item) => sum + item.price * item.qty, 0);
      couponDiscount = calculateCouponDiscount({ coupon, subtotalNgn, eligibleSubtotalNgn: eligibleSubtotal });
      const totalUses = Number(db.prepare(`SELECT COUNT(*) AS count FROM coupon_redemptions WHERE coupon_id = ? AND status IN ('used', 'reserved')`).get(coupon.id)?.count || 0);
      if (Number(coupon.usage_limit || 0) > 0 && totalUses >= Number(coupon.usage_limit)) throw new Error('This coupon has reached its usage limit.');
      const userUses = Number(db.prepare(`SELECT COUNT(*) AS count FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ? AND status IN ('used', 'reserved')`).get(coupon.id, userId)?.count || 0);
      if (Number(coupon.per_user_limit || 0) > 0 && userUses >= Number(coupon.per_user_limit)) throw new Error('You have already used this coupon the maximum number of times.');
    }

    if (requestedCoins > 0 && cleanCode && getSetting('coins_stack_with_coupons', '0') !== '1') {
      throw new Error('Hiro Coins cannot be combined with a coupon on the same order.');
    }
    if (requestedCoins > 0) {
      coinRedemption = calculateCoinRedemption({
        requestedCoins,
        balance: getCoinBalance(userId),
        coinValueNgn: getSetting('coin_value_ngn', '0'),
        maxPercent: getSetting('coin_max_redemption_percent', '0'),
        subtotalAfterCoupon: subtotalNgn - couponDiscount,
        enabled: getSetting('coins_enabled', '0') === '1'
      });
    }
    return { coupon, couponDiscount, coinRedemption, payableNgn: subtotalNgn - couponDiscount - coinRedemption.discountNgn };
  }

  function commitCheckoutRewards(orderId) {
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(`UPDATE coupon_redemptions SET status = 'used', updated_at = ? WHERE order_id = ? AND status = 'reserved'`).run(now, orderId);
      const reservation = db.prepare(`SELECT * FROM coin_reservations WHERE order_id = ? AND status = 'reserved'`).get(orderId);
      if (reservation) {
        db.prepare(`UPDATE coin_reservations SET status = 'used', updated_at = ? WHERE order_id = ? AND status = 'reserved'`).run(now, orderId);
        db.prepare(`INSERT OR IGNORE INTO coin_transactions (user_id, order_id, amount, kind, description, source_key, created_at) VALUES (?, ?, ?, 'redeemed', 'Hiro Coins used at checkout', ?, ?)`)
          .run(reservation.user_id, orderId, -Math.abs(reservation.coins), `redeem:${orderId}`, now);
      }
    })();
  }

  function awardCoinsForCompletedOrder(orderId) {
    const order = db.prepare(`SELECT order_id, user_id, order_total, status FROM orders WHERE order_id = ?`).get(orderId);
    if (!order || !order.user_id || order.status !== 'Paid') return 0;
    const state = db.prepare(`SELECT COUNT(*) AS total, SUM(CASE WHEN fulfillment_status = 'Completed' THEN 1 ELSE 0 END) AS completed FROM order_items WHERE order_id = ?`).get(orderId);
    if (!state.total || Number(state.completed || 0) !== Number(state.total)) return 0;

    const now = new Date().toISOString();
    let totalAwarded = 0;

    // One welcome bonus per customer account, independent of reviews or review sentiment.
    const welcomeBonus = db.prepare(`INSERT OR IGNORE INTO coin_transactions (user_id, order_id, amount, kind, description, source_key, created_at)
      VALUES (?, ?, 5, 'first_purchase_bonus', 'One-time 5 HC first completed purchase bonus', ?, ?)`)
      .run(order.user_id, orderId, `first-purchase-bonus:${order.user_id}`, now);
    if (welcomeBonus.changes) totalAwarded += 5;

    if (getSetting('coins_enabled', '0') !== '1') return totalAwarded;
    const earnRate = Number(getSetting('coin_earn_per_100_ngn', '0'));
    if (!Number.isFinite(earnRate) || earnRate <= 0) return totalAwarded;
    const coins = Math.floor(Number(order.order_total || 0) / 100 * earnRate);
    if (coins <= 0) return totalAwarded;
    const result = db.prepare(`INSERT OR IGNORE INTO coin_transactions (user_id, order_id, amount, kind, description, source_key, created_at) VALUES (?, ?, ?, 'earned', 'Hiro Coins earned after completed order', ?, ?)`)
      .run(order.user_id, orderId, coins, `earn:${orderId}`, now);
    if (result.changes) {
      db.prepare(`UPDATE orders SET coins_earned = ? WHERE order_id = ?`).run(coins, orderId);
      totalAwarded += coins;
    }
    return totalAwarded;
  }

  function reverseOrderRewards(orderId, reason = 'Order refunded or cancelled') {
    const now = new Date().toISOString();
    db.transaction(() => {
      const order = db.prepare(`SELECT user_id FROM orders WHERE order_id = ?`).get(orderId);
      if (!order?.user_id) return;
      const redemption = db.prepare(`SELECT amount FROM coin_transactions WHERE source_key = ?`).get(`redeem:${orderId}`);
      if (redemption && redemption.amount < 0) {
        db.prepare(`INSERT OR IGNORE INTO coin_transactions (user_id, order_id, amount, kind, description, source_key, created_at) VALUES (?, ?, ?, 'reversal', ?, ?, ?)`)
          .run(order.user_id, orderId, Math.abs(redemption.amount), reason, `redeem-reversal:${orderId}`, now);
      }
      const earned = db.prepare(`SELECT amount FROM coin_transactions WHERE source_key = ?`).get(`earn:${orderId}`);
      if (earned && earned.amount > 0) {
        db.prepare(`INSERT OR IGNORE INTO coin_transactions (user_id, order_id, amount, kind, description, source_key, created_at) VALUES (?, ?, ?, 'reversal', ?, ?, ?)`)
          .run(order.user_id, orderId, -Math.abs(earned.amount), reason, `earn-reversal:${orderId}`, now);
      }
      const welcomeBonus = db.prepare(`SELECT amount FROM coin_transactions WHERE source_key = ? AND order_id = ?`).get(`first-purchase-bonus:${order.user_id}`, orderId);
      if (welcomeBonus && welcomeBonus.amount > 0) {
        db.prepare(`INSERT OR IGNORE INTO coin_transactions (user_id, order_id, amount, kind, description, source_key, created_at) VALUES (?, ?, ?, 'reversal', ?, ?, ?)`)
          .run(order.user_id, orderId, -Math.abs(welcomeBonus.amount), reason, `first-purchase-bonus-reversal:${order.user_id}`, now);
      }
      db.prepare(`UPDATE coin_reservations SET status = 'reversed', updated_at = ? WHERE order_id = ? AND status IN ('reserved', 'used')`).run(now, orderId);
      db.prepare(`UPDATE coupon_redemptions SET status = 'reversed', updated_at = ? WHERE order_id = ? AND status IN ('reserved', 'used')`).run(now, orderId);
    })();
  }

  return { getCoinBalance, evaluateCheckoutRewards, commitCheckoutRewards, awardCoinsForCompletedOrder, reverseOrderRewards };
}

module.exports = { createRewardsLedger };
