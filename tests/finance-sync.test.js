'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { CATEGORIES, createFinance } = require('../hiro-finance');

test('FZR refresh imports all selected categories safely and never overwrites admin retail prices', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY, reference TEXT, amount_charged INTEGER, currency TEXT);
    CREATE TABLE products (
      id INTEGER PRIMARY KEY AUTOINCREMENT, category_id TEXT NOT NULL, offer_id TEXT NOT NULL, title TEXT NOT NULL,
      supplier_price_usd REAL NOT NULL, retail_price_usd REAL NOT NULL DEFAULT 0, retail_price_ngn INTEGER NOT NULL DEFAULT 0,
      available INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      supplier_synced_at TEXT, supplier_note TEXT, region_restriction TEXT,
      UNIQUE(category_id, offer_id)
    );`);
  const settings = new Map();
  const getSetting = (key, fallback) => settings.has(key) ? settings.get(key) : fallback;
  const setSetting = (key, value) => settings.set(key, String(value));
  let now = Date.now();
  const offerCounts = { blood_strike: 24, genshin_impact_global: 7, honkai_star_rail_global: 7, marvel_rivals: 6, mobile_legends_global: 42, mobile_legends_philippines: 17, mobile_legends_indonesia: 23, mobile_legends_malaysia: 20, lords_mobile: 10, codm_activision_in: 9 };
  let price = 0.5;
  const offersByCategory = Object.fromEntries(CATEGORIES.map(categoryId => [categoryId, Array.from({ length: offerCounts[categoryId] }, (_, index) => ({ offer_id: `${categoryId}-offer-${index + 1}`, name: `${categoryId} Pack ${index + 1}`, price_usd: index === 0 ? price : 1.25 }))]));
  const axios = { get: async (_url, options) => ({ data: { ok: true, category_id: options.params.category_id, offers: offersByCategory[options.params.category_id] } }) };
  const finance = createFinance({ db, axios, getSetting, setSetting, exchangeRateFallback: 1400, apiKey: 'test-key', paystackKey: '', clock: () => now });

  const first = await finance.refreshPrices();
  assert.equal(CATEGORIES.length, 10);
  assert.equal(first.succeeded, 10);
  assert.equal(first.failed, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count, 165);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products WHERE available = 0 AND retail_price_ngn = 0').get().count, 165);

  const product = db.prepare(`SELECT * FROM products WHERE category_id = ? AND offer_id = ?`).get('mobile_legends_global', 'mobile_legends_global-offer-1');
  db.prepare(`UPDATE products SET retail_price_ngn = 3500, available = 1 WHERE id = ?`).run(product.id);
  now += 11 * 60 * 1000;
  price = 0.75;
  offersByCategory.mobile_legends_global = [{ offer_id: 'mobile_legends_global-offer-1', name: 'mobile_legends_global Pack 1', price_usd: price }];
  const second = await finance.refreshPrices();
  assert.equal(second.succeeded, 10);
  const saved = db.prepare('SELECT supplier_price_usd, retail_price_ngn, available FROM products WHERE id = ?').get(product.id);
  assert.equal(saved.supplier_price_usd, 0.75);
  assert.equal(saved.retail_price_ngn, 3500);
  assert.equal(saved.available, 1);
  assert.equal(settings.get('fzr_sync_missing_mobile_legends_global'), '41');
  db.close();
});

test('FZR refresh without a supplier key leaves the saved catalogue untouched', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE orders (id INTEGER PRIMARY KEY, reference TEXT, amount_charged INTEGER, currency TEXT);
    CREATE TABLE products (id INTEGER PRIMARY KEY, category_id TEXT, offer_id TEXT, title TEXT, supplier_price_usd REAL, retail_price_usd REAL DEFAULT 0, retail_price_ngn INTEGER DEFAULT 0, available INTEGER DEFAULT 0, created_at TEXT, updated_at TEXT, supplier_synced_at TEXT, supplier_note TEXT, region_restriction TEXT);`);
  const settings = new Map();
  const finance = createFinance({ db, axios: { get: async () => { throw new Error('should not call without key'); } }, getSetting: (key, fallback) => settings.has(key) ? settings.get(key) : fallback, setSetting: (key, value) => settings.set(key, String(value)), exchangeRateFallback: 1400, apiKey: '', paystackKey: '' });
  const result = await finance.refreshPrices();
  assert.equal(result.failed, 10);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM products').get().count, 0);
  db.close();
});
