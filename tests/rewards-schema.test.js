'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');

test('additive account and rewards schema applies cleanly to a V1-shaped SQLite database', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const start = source.indexOf('db.exec(`\n    CREATE TABLE IF NOT EXISTS wishlists');
  const end = source.indexOf('\n`);', start);
  assert.ok(start >= 0 && end > start, 'rewards schema block must exist');
  const schema = source.slice(start + 'db.exec(`'.length, end);
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY, role TEXT NOT NULL DEFAULT 'customer');
    CREATE TABLE orders (id INTEGER PRIMARY KEY, order_id TEXT NOT NULL UNIQUE, user_id INTEGER, status TEXT, order_total INTEGER);
    INSERT INTO users (id, role) VALUES (1, 'customer');
    INSERT INTO orders (order_id, user_id, status, order_total) VALUES ('h-test-1', 1, 'Pending', 10000);`);
  db.exec(schema);

  const columns = db.prepare('PRAGMA table_info(orders)').all().map(column => column.name);
  const rewardColumns = ['subtotal_ngn', 'discount_ngn', 'coupon_id', 'coupon_code', 'coins_redeemed', 'coins_discount_ngn', 'coins_earned'];
  for (const column of rewardColumns) {
    if (!columns.includes(column)) db.exec(`ALTER TABLE orders ADD COLUMN ${column} ${column.includes('ngn') || column.includes('coins') ? 'INTEGER NOT NULL DEFAULT 0' : 'TEXT'}`);
  }

  db.prepare(`INSERT INTO coupons (code, discount_type, discount_value, created_at, updated_at) VALUES (?, 'percent', 20, ?, ?)`)
    .run('HIRO20', new Date().toISOString(), new Date().toISOString());
  const coupon = db.prepare('SELECT id FROM coupons WHERE code = ?').get('HIRO20');
  db.prepare(`INSERT INTO coupon_redemptions (coupon_id, user_id, order_id, discount_ngn, status, created_at, updated_at) VALUES (?, 1, 'h-test-1', 2000, 'reserved', ?, ?)`)
    .run(coupon.id, new Date().toISOString(), new Date().toISOString());
  db.prepare(`INSERT INTO coin_reservations (user_id, order_id, coins, discount_ngn, status, created_at, updated_at) VALUES (1, 'h-test-1', 100, 1000, 'reserved', ?, ?)`)
    .run(new Date().toISOString(), new Date().toISOString());
  db.prepare(`INSERT INTO coin_transactions (user_id, order_id, amount, kind, description, source_key, created_at) VALUES (1, 'h-test-1', 100, 'earned', 'test', 'test-source', ?)`)
    .run(new Date().toISOString());

  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM coupons').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM coupon_redemptions').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM coin_reservations').get().count, 1);
  assert.equal(db.prepare('SELECT SUM(amount) AS balance FROM coin_transactions WHERE user_id = 1').get().balance, 100);
  assert.throws(() => db.prepare(`INSERT INTO coin_transactions (user_id, order_id, amount, kind, description, source_key, created_at) VALUES (1, 'h-test-1', 100, 'earned', 'duplicate', 'test-source', ?)`)
    .run(new Date().toISOString()), /UNIQUE constraint failed/);
  db.close();
});
