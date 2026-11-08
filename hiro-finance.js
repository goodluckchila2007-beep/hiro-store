'use strict';
const { getOfferRestriction } = require('./lib/fzr-catalogue');

const CATEGORIES = ['blood_strike', 'genshin_impact_global', 'honkai_star_rail_global', 'marvel_rivals', 'mobile_legends_global', 'mobile_legends_philippines', 'mobile_legends_indonesia', 'mobile_legends_malaysia', 'lords_mobile', 'codm_activision_in'];
const CACHE_MS = 10 * 60 * 1000;

function actualFeeKobo(payment) {
    const raw = payment?.fees;
    if (!['number', 'string'].includes(typeof raw) || (typeof raw === 'string' && !/^\d+$/.test(raw))) return null;
    const fee = Number(raw);
    return Number.isSafeInteger(fee) && fee >= 0 && fee <= Number(payment.amount) ? fee : null;
}

// Projection for one NGN local transaction; historical reports never use this estimate.
function estimatedLocalFeeNgn(amount) {
    const kobo = Math.round(Number(amount) * 100);
    if (!Number.isSafeInteger(kobo) || kobo <= 0) return 0;
    return Math.min(200000, Math.round(kobo * 0.015) + (kobo >= 250000 ? 10000 : 0)) / 100;
}

function validateOffers(payload, categoryId) {
    if (payload?.ok !== true || payload.category_id !== categoryId || !Array.isArray(payload.offers) || !payload.offers.length || payload.meta?.has_more) {
        throw new Error('Invalid or incomplete FZR catalog response.');
    }
    const seen = new Set();
    return payload.offers.map(offer => {
        const id = String(offer.offer_id || '').trim();
        const raw = offer.price_usd;
        const price = Number(raw);
        if (!id || seen.has(id) || !['number', 'string'].includes(typeof raw) || (typeof raw === 'string' && !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) || !Number.isFinite(price) || price <= 0) {
            throw new Error('Invalid FZR offer identity or supplier price.');
        }
        seen.add(id);
        return { offerId: id, title: String(offer.name || offer.title || id).trim(), supplierNote: String(offer.note || offer.description || '').trim(), regionRestriction: getOfferRestriction(categoryId, id, offer.name || offer.title || ''), priceUsd: price };
    });
}

function createFinance({ db, axios, getSetting, setSetting, exchangeRateFallback, apiKey, paystackKey, clock = Date.now }) {
    const columns = db.prepare('PRAGMA table_info(orders)').all().map(row => row.name);
    if (!columns.includes('paystack_fee_kobo')) db.exec('ALTER TABLE orders ADD COLUMN paystack_fee_kobo INTEGER CHECK(paystack_fee_kobo >= 0)');
    if (!columns.includes('paystack_fee_source')) db.exec('ALTER TABLE orders ADD COLUMN paystack_fee_source TEXT');
    const productColumns = db.prepare('PRAGMA table_info(products)').all().map(row => row.name);
    if (!productColumns.includes('supplier_synced_at')) db.exec('ALTER TABLE products ADD COLUMN supplier_synced_at TEXT');
    const inFlight = new Map();
    const attempted = new Map();
    let feeRecoveryRunning = false;

    function rate() {
        const configured = Number(getSetting('usd_ngn_rate', exchangeRateFallback));
        return Number.isFinite(configured) && configured > 0 ? configured : exchangeRateFallback;
    }

    function recordFee(reference, payment, source) {
        const fee = actualFeeKobo(payment);
        if (fee === null) return false;
        // Fee-only write: duplicate confirmation must never touch payment/fulfillment state.
        const result = db.prepare(`UPDATE orders SET paystack_fee_kobo = ?, paystack_fee_source = ?
            WHERE reference = ? AND currency = ? AND amount_charged = ? AND amount_charged > 0
              AND (paystack_fee_kobo IS NULL OR (? = 'verify' AND paystack_fee_source = 'webhook'))`).run(
            fee, source, reference, String(payment.currency || '').toUpperCase(), Number(payment.amount), source);
        return result.changes > 0;
    }

    async function syncCategory(categoryId, force = false) {
        if (inFlight.has(categoryId)) return inFlight.get(categoryId);
        const lastAttempt = attempted.get(categoryId);
        if (!force && lastAttempt !== undefined && clock() - lastAttempt < CACHE_MS) return { categoryId, success: true, skipped: true, message: 'Recently refreshed; using the saved catalogue.' };
        attempted.set(categoryId, clock());
        const task = (async () => {
            try {
                if (!apiKey) throw new Error('FZR key unavailable.');
                const response = await axios.get('https://api.fzr.cards/api/v2/topups/offers', {
                    params: { category_id: categoryId }, headers: { 'X-API-Key': apiKey, Accept: 'application/json' }, timeout: 10000
                });
                const offers = validateOffers(response.data, categoryId);
                const known = db.prepare('SELECT offer_id FROM products WHERE category_id = ?').all(categoryId);
                const knownIds = new Set(known.map(product => product.offer_id));
                const offered = new Set(offers.map(offer => offer.offerId));
                const missing = known.filter(product => !offered.has(product.offer_id)).length;
                const added = offers.filter(offer => !knownIds.has(offer.offerId)).length;
                const updated = offers.length - added;
                const stamp = new Date(clock()).toISOString();
                db.transaction(() => {
                    const update = db.prepare(`UPDATE products
                        SET title = CASE WHEN title IS NULL OR title = '' THEN ? ELSE title END,
                            supplier_note = COALESCE(NULLIF(?, ''), supplier_note),
                            region_restriction = COALESCE(NULLIF(?, ''), region_restriction),
                            supplier_price_usd = ?, supplier_synced_at = ?, updated_at = ?
                        WHERE category_id = ? AND offer_id = ?`);
                    const insert = db.prepare(`INSERT INTO products (
                        category_id, offer_id, title, supplier_price_usd, retail_price_usd,
                        retail_price_ngn, available, created_at, updated_at, supplier_synced_at,
                        supplier_note, region_restriction
                    ) VALUES (?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)`);
                    for (const offer of offers) {
                        if (knownIds.has(offer.offerId)) {
                            update.run(offer.title, offer.supplierNote, offer.regionRestriction, offer.priceUsd, stamp, stamp, categoryId, offer.offerId);
                        } else {
                            // New supplier offers are imported as unavailable until an admin sets a NGN selling price.
                            insert.run(categoryId, offer.offerId, offer.title, offer.priceUsd, stamp, stamp, stamp, offer.supplierNote, offer.regionRestriction);
                        }
                    }
                    setSetting(`fzr_sync_${categoryId}`, stamp);
                    setSetting(`fzr_sync_missing_${categoryId}`, String(missing));
                    setSetting(`fzr_sync_error_${categoryId}`, missing ? 'Some previously listed offers are absent from the latest supplier response; saved products were retained.' : '');
                })();
                return { categoryId, success: true, offerCount: offers.length, added, updated, missing };
            } catch (error) {
                // Keep the last known DB prices. Never disable products or write zero costs on failure.
                setSetting(`fzr_sync_error_${categoryId}`, 'Live refresh unavailable; saved supplier prices retained.');
                return { categoryId, success: false, error: error.message === 'FZR key unavailable.' ? 'FZR API key is not configured.' : 'FZR catalogue refresh failed; saved prices were retained.' };
            }
        })();
        inFlight.set(categoryId, task);
        try { return await task; } finally { inFlight.delete(categoryId); }
    }

    async function refreshPrices({ force = false } = {}) {
        const results = await Promise.all(CATEGORIES.map(categoryId => syncCategory(categoryId, force)));
        return { results, succeeded: results.filter(result => result?.success).length, failed: results.filter(result => result && !result.success).length };
    }

    function currentProducts() {
        const exchangeRate = rate();
        const placeholders = CATEGORIES.map(() => '?').join(', ');
        return db.prepare(`SELECT id, category_id AS categoryId, offer_id AS offerId, title,
            supplier_note AS supplierNote, region_restriction AS regionRestriction,
            supplier_price_usd AS supplierPriceUsd, retail_price_ngn AS retailPriceNgn,
            available, supplier_synced_at AS supplierSyncedAt FROM products
            WHERE category_id IN (${placeholders}) ORDER BY category_id, id`).all(...CATEGORIES).map(product => {
                const cost = Math.round(Number(product.supplierPriceUsd) * exchangeRate);
                const fee = estimatedLocalFeeNgn(product.retailPriceNgn);
                const profit = Math.round((product.retailPriceNgn - cost - fee) * 100) / 100;
                return { ...product, supplierPriceNgn: cost, estimatedPaystackFee: fee, expectedNetProfit: profit,
                    expectedMargin: product.retailPriceNgn > 0 ? profit / product.retailPriceNgn * 100 : 0 };
            });
    }

    function overview(period = '7') {
        if (!['7', '30', 'all'].includes(period)) period = '7';
        const cutoff = period === 'all' ? null : new Date(clock() - Number(period) * 86400000).toISOString();
        // Aggregate items before joining so each payment fee is counted exactly once.
        const row = db.prepare(`SELECT COUNT(*) AS orderCount, COALESCE(SUM(o.amount_charged), 0) AS revenueKobo,
            COALESCE(SUM(c.cost), 0) AS supplierCost, COALESCE(SUM(o.paystack_fee_kobo), 0) AS feesKobo,
            COALESCE(SUM(CASE WHEN o.paystack_fee_kobo IS NULL THEN 1 ELSE 0 END), 0) AS missingFees,
            COALESCE(SUM(CASE WHEN c.itemCount IS NULL OR c.missingCost > 0 THEN 1 ELSE 0 END), 0) AS missingCosts,
            COALESCE(SUM(CASE WHEN c.pending > 0 THEN 1 ELSE 0 END), 0) AS unsettledOrders,
            COALESCE(SUM(CASE WHEN c.problem > 0 THEN 1 ELSE 0 END), 0) AS problemOrders
            FROM orders o LEFT JOIN (
                SELECT order_id, COUNT(*) AS itemCount, SUM(supplier_cost_ngn * quantity) AS cost,
                    SUM(CASE WHEN supplier_cost_ngn <= 0 THEN 1 ELSE 0 END) AS missingCost,
                    SUM(CASE WHEN fulfillment_status <> 'Completed' THEN 1 ELSE 0 END) AS pending,
                    SUM(CASE WHEN fulfillment_status IN ('Failed', 'Review Required') THEN 1 ELSE 0 END) AS problem
                FROM order_items GROUP BY order_id
            ) c ON c.order_id = o.order_id
            WHERE o.amount_charged > 0 AND o.currency = 'NGN'
                AND o.status NOT IN ('Refunded', 'Cancelled', 'Failed')
                AND (? IS NULL OR datetime(o.paid_at) >= datetime(?))`).get(cutoff, cutoff);
        const complete = row.missingFees === 0 && row.missingCosts === 0 && row.unsettledOrders === 0;
        const revenue = Number(row.revenueKobo) / 100;
        const fees = Number(row.feesKobo) / 100;
        const profit = complete ? Math.round((revenue - row.supplierCost - fees) * 100) / 100 : null;
        return { period, orderCount: row.orderCount, revenue, supplierCost: row.supplierCost, paystackFees: fees,
            missingFees: row.missingFees, missingCosts: row.missingCosts, unsettledOrders: row.unsettledOrders,
            problemOrders: row.problemOrders, complete, netProfit: profit,
            netMargin: profit === null ? null : revenue > 0 ? profit / revenue * 100 : 0,
            exchangeRate: rate(), products: currentProducts(),
            pricing: CATEGORIES.map(categoryId => ({ categoryId, lastSyncedAt: getSetting(`fzr_sync_${categoryId}`, null),
                warning: getSetting(`fzr_sync_error_${categoryId}`, ''), missingOffers: Number(getSetting(`fzr_sync_missing_${categoryId}`, '0')) })) };
    }

    async function recoverFees() {
        if (feeRecoveryRunning) return { busy: true };
        feeRecoveryRunning = true;
        let recovered = 0, unavailable = 0;
        try {
            const candidates = db.prepare(`SELECT reference, amount_charged, currency FROM orders
                WHERE amount_charged > 0 AND paystack_fee_kobo IS NULL AND currency = 'NGN'
                  AND status NOT IN ('Refunded', 'Cancelled', 'Failed')
                ORDER BY COALESCE(paystack_fee_checked_at, '') ASC, id DESC LIMIT 10`).all();
            for (const order of candidates) {
                try {
                    const response = await axios.get(`https://api.paystack.co/transaction/verify/${encodeURIComponent(order.reference)}`, {
                        headers: { Authorization: `Bearer ${paystackKey}` }, timeout: 5000
                    });
                    const payment = response.data?.data;
                    if (response.data?.status === true && payment?.status === 'success' && payment.reference === order.reference
                        && payment.currency === order.currency && Number(payment.amount) === order.amount_charged
                        && recordFee(order.reference, payment, 'verify')) recovered++;
                    else unavailable++;
                } catch { unavailable++; }
                db.prepare('UPDATE orders SET paystack_fee_checked_at = ? WHERE reference = ?').run(new Date(clock()).toISOString(), order.reference);
            }
            return { recovered, unavailable, checked: candidates.length };
        } finally { feeRecoveryRunning = false; }
    }

    if (!columns.includes('paystack_fee_checked_at')) db.exec('ALTER TABLE orders ADD COLUMN paystack_fee_checked_at TEXT');
    return { recordFee, refreshPrices, currentProducts, overview, recoverFees };
}

module.exports = { CATEGORIES, actualFeeKobo, estimatedLocalFeeNgn, validateOffers, createFinance };
