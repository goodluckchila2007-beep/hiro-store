'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { createRewardsLedger } = require('../lib/rewards-ledger');
const { getCategory } = require('../lib/fzr-catalogue');

function fixture() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL DEFAULT 'customer');
    CREATE TABLE orders (order_id TEXT PRIMARY KEY, user_id INTEGER, status TEXT, order_total INTEGER, coins_earned INTEGER DEFAULT 0);
    CREATE TABLE order_items (id INTEGER PRIMARY KEY, order_id TEXT, fulfillment_status TEXT);
    CREATE TABLE coupons (id INTEGER PRIMARY KEY, code TEXT UNIQUE, discount_type TEXT, discount_value REAL, min_order_ngn INTEGER DEFAULT 0, max_discount_ngn INTEGER DEFAULT 0, starts_at TEXT, ends_at TEXT, usage_limit INTEGER DEFAULT 0, per_user_limit INTEGER DEFAULT 0, eligible_categories_json TEXT DEFAULT '[]', active INTEGER DEFAULT 1);
    CREATE TABLE coupon_redemptions (id INTEGER PRIMARY KEY AUTOINCREMENT, coupon_id INTEGER, user_id INTEGER, order_id TEXT UNIQUE, discount_ngn INTEGER, status TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE coin_transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, order_id TEXT, amount INTEGER, kind TEXT, description TEXT, source_key TEXT UNIQUE, created_at TEXT);
    CREATE TABLE coin_reservations (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, order_id TEXT UNIQUE, coins INTEGER, discount_ngn INTEGER, status TEXT, created_at TEXT, updated_at TEXT);
    INSERT INTO users (id) VALUES (1);
  `);
  const settings = new Map([
    ['coins_enabled', '1'], ['coin_earn_per_100_ngn', '2'], ['coin_value_ngn', '2'],
    ['coin_max_redemption_percent', '20'], ['coins_stack_with_coupons', '0']
  ]);
  const ledger = createRewardsLedger({ db, getSetting: (key, fallback) => settings.has(key) ? settings.get(key) : fallback, getCategory });
  return { db, settings, ledger };
}

test('ledger reserves coins during pending checkout and commits redemption once payment is confirmed', () => {
  const { db, ledger } = fixture();
  db.prepare(`INSERT INTO orders (order_id, user_id, status, order_total) VALUES ('ord-a', 1, 'Pending', 4000)`).run();
  db.prepare(`INSERT INTO coin_transactions (user_id, amount, kind, description, source_key, created_at) VALUES (1, 300, 'earned', 'seed', 'seed-1', ?)`).run(new Date().toISOString());
  db.prepare(`INSERT INTO coin_reservations (user_id, order_id, coins, discount_ngn, status, created_at, updated_at) VALUES (1, 'ord-a', 100, 200, 'reserved', ?, ?)`).run(new Date().toISOString(), new Date().toISOString());
  assert.equal(ledger.getCoinBalance(1), 200);
  db.prepare(`UPDATE orders SET status = 'Paid' WHERE order_id = 'ord-a'`).run();
  ledger.commitCheckoutRewards('ord-a');
  ledger.commitCheckoutRewards('ord-a');
  assert.equal(ledger.getCoinBalance(1), 200);
  assert.equal(db.prepare(`SELECT amount FROM coin_transactions WHERE source_key = 'redeem:ord-a'`).get().amount, -100);
  assert.equal(db.prepare(`SELECT status FROM coin_reservations WHERE order_id = 'ord-a'`).get().status, 'used');
  db.close();
});

test('coupon discount is restricted to eligible categories and per-customer limits', () => {
  const { db, ledger } = fixture();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO coupons (id, code, discount_type, discount_value, min_order_ngn, usage_limit, per_user_limit, eligible_categories_json, active) VALUES (1, 'MLBB15', 'percent', 15, 1000, 0, 1, ?, 1)`)
    .run(JSON.stringify(['mobile_legends_global']));
  const adjustment = ledger.evaluateCheckoutRewards({ userId: 1, subtotalNgn: 5000, items: [
    { categoryId: 'mobile_legends_global', price: 2000, qty: 1 },
    { categoryId: 'blood_strike', price: 3000, qty: 1 }
  ], couponCode: 'mlbb15', coinsRequested: 0 });
  assert.equal(adjustment.couponDiscount, 300);
  db.prepare(`INSERT INTO coupon_redemptions (coupon_id, user_id, order_id, discount_ngn, status, created_at, updated_at) VALUES (1, 1, 'used-order', 300, 'used', ?, ?)`)
    .run(now, now);
  assert.throws(() => ledger.evaluateCheckoutRewards({ userId: 1, subtotalNgn: 2000, items: [{ categoryId: 'mobile_legends_global', price: 2000, qty: 1 }], couponCode: 'MLBB15', coinsRequested: 0 }), /maximum number/);
  db.close();
});

test('first completed purchase earns exactly one 5 HC bonus even when ongoing earning is disabled', () => {
  const { db, settings, ledger } = fixture();
  settings.set('coins_enabled', '0');
  db.prepare(`INSERT INTO orders (order_id, user_id, status, order_total) VALUES ('first-order', 1, 'Paid', 5000), ('second-order', 1, 'Paid', 7000)`).run();
  db.prepare(`INSERT INTO order_items (order_id, fulfillment_status) VALUES ('first-order', 'Completed'), ('second-order', 'Completed')`).run();

  assert.equal(ledger.awardCoinsForCompletedOrder('first-order'), 5);
  assert.equal(ledger.awardCoinsForCompletedOrder('first-order'), 0);
  assert.equal(ledger.awardCoinsForCompletedOrder('second-order'), 0);
  assert.equal(ledger.getCoinBalance(1), 5);
  assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM coin_transactions WHERE kind = 'first_purchase_bonus'`).get().count, 1);
  db.close();
});

test('coins are awarded only after every unit is completed and are reversed on refund', () => {
  const { db, ledger } = fixture();
  db.prepare(`INSERT INTO orders (order_id, user_id, status, order_total) VALUES ('ord-b', 1, 'Paid', 10000)`).run();
  db.prepare(`INSERT INTO order_items (order_id, fulfillment_status) VALUES ('ord-b', 'Completed'), ('ord-b', 'Processing')`).run();
  assert.equal(ledger.awardCoinsForCompletedOrder('ord-b'), 0);
  db.prepare(`UPDATE order_items SET fulfillment_status = 'Completed' WHERE order_id = 'ord-b'`).run();
  assert.equal(ledger.awardCoinsForCompletedOrder('ord-b'), 205);
  assert.equal(ledger.awardCoinsForCompletedOrder('ord-b'), 0);
  assert.equal(ledger.getCoinBalance(1), 205);
  assert.equal(db.prepare(`SELECT amount FROM coin_transactions WHERE source_key = 'first-purchase-bonus:1'`).get().amount, 5);
  db.prepare(`INSERT INTO coin_reservations (user_id, order_id, coins, discount_ngn, status, created_at, updated_at) VALUES (1, 'ord-b', 50, 100, 'used', ?, ?)`).run(new Date().toISOString(), new Date().toISOString());
  db.prepare(`INSERT INTO coin_transactions (user_id, order_id, amount, kind, description, source_key, created_at) VALUES (1, 'ord-b', -50, 'redeemed', 'used', 'redeem:ord-b', ?)`).run(new Date().toISOString());
  ledger.reverseOrderRewards('ord-b', 'Admin refund');
  ledger.reverseOrderRewards('ord-b', 'Admin refund');
  assert.equal(ledger.getCoinBalance(1), 0);
  assert.equal(db.prepare(`SELECT amount FROM coin_transactions WHERE source_key = 'earn-reversal:ord-b'`).get().amount, -200);
  assert.equal(db.prepare(`SELECT amount FROM coin_transactions WHERE source_key = 'first-purchase-bonus-reversal:1'`).get().amount, -5);
  assert.equal(db.prepare(`SELECT amount FROM coin_transactions WHERE source_key = 'redeem-reversal:ord-b'`).get().amount, 50);
  db.close();
});
