"use strict";

/**
 * Opens the Hiro Store SQLite database, applies the existing schema upgrades,
 * and seeds store defaults. Keep schema changes in this module rather than
 * growing the HTTP server entry point.
 */
module.exports = function createDatabase({ Database, FZR_EXCHANGE_RATE, logger }) {
    const db = new Database("hiro-store.db");
    
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    
    /* =========================================================
       CREATE ORDERS TABLE
    ========================================================= */
    
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT UNIQUE NOT NULL,
            reference TEXT UNIQUE NOT NULL,
            email TEXT,
            phone TEXT,
            amount INTEGER NOT NULL DEFAULT 0,
            order_total INTEGER NOT NULL DEFAULT 0,
            amount_charged INTEGER NOT NULL DEFAULT 0,
            currency TEXT DEFAULT 'NGN',
            status TEXT NOT NULL DEFAULT 'Pending',
            paid_at TEXT,
            created_at TEXT NOT NULL
        )
    `);
    
    try {
        db.exec(`ALTER TABLE orders ADD COLUMN order_total INTEGER NOT NULL DEFAULT 0`);
    } catch (error) {
        if (!error.message.includes("duplicate column name")) throw error;
    }
    
    try {
        db.exec(`ALTER TABLE orders ADD COLUMN amount_charged INTEGER NOT NULL DEFAULT 0`);
    } catch (error) {
        if (!error.message.includes("duplicate column name")) throw error;
    }
    
    try {
        db.exec(`ALTER TABLE orders ADD COLUMN user_id INTEGER`);
    } catch (error) {
        if (!error.message.includes("duplicate column name")) throw error;
    }
    
    
    
    /* =========================================================
       ORDER ITEMS TABLE
    ========================================================= */
    db.exec(`
        CREATE TABLE IF NOT EXISTS order_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_id TEXT NOT NULL,
            title TEXT NOT NULL,
            price INTEGER NOT NULL DEFAULT 0,
            quantity INTEGER NOT NULL DEFAULT 1,
    
            player_id TEXT,
            server_id TEXT,
            player_name TEXT,
            player_region TEXT,
    
            supplier_price_usd REAL NOT NULL DEFAULT 0,
            supplier_cost_ngn INTEGER NOT NULL DEFAULT 0,
    
            fulfillment_status TEXT NOT NULL DEFAULT 'Pending',
    
            FOREIGN KEY(order_id)
                REFERENCES orders(order_id)
                ON DELETE CASCADE
        );
    
    `);
    
    
    
    const orderItemColumns = db
        .prepare(`PRAGMA table_info(order_items)`)
        .all()
        .map(column => column.name);
    
    const addOrderItemColumn = (column, definition) => {
        if (!orderItemColumns.includes(column)) {
            db.exec(`
                ALTER TABLE order_items
                ADD COLUMN ${column} ${definition}
            `);
    
            console.log(`Added order_items.${column}`);
        }
    };
    addOrderItemColumn(
        "fzr_order_id",
        "TEXT"
    );
    
    addOrderItemColumn(
        "offer_id",
        "TEXT"
    );
    
    addOrderItemColumn(
        "category_id",
        "TEXT NOT NULL DEFAULT 'mobile_legends_global'"
    );
    
    addOrderItemColumn("player_id", "TEXT");
    addOrderItemColumn("server_id", "TEXT");
    addOrderItemColumn("player_name", "TEXT");
    addOrderItemColumn("player_region", "TEXT");
    addOrderItemColumn("supplier_price_usd", "REAL NOT NULL DEFAULT 0");
    addOrderItemColumn("supplier_cost_ngn", "INTEGER NOT NULL DEFAULT 0");
    addOrderItemColumn(
        "fulfillment_status",
        "TEXT NOT NULL DEFAULT 'Pending'"
    );
    addOrderItemColumn("fulfillment_error", "TEXT");
    
    console.log("Order items table ready.");
    
    
    if (!orderItemColumns.includes("supplier_price_usd")) {
        db.exec(`ALTER TABLE order_items ADD COLUMN supplier_price_usd REAL NOT NULL DEFAULT 0`);
        console.log("Added order_items.supplier_price_usd");
    }
    
    
    console.log("SQLite database ready.");
    
    
    
    /* =========================================================
       USERS — CUSTOMER ACCOUNTS
    ========================================================= */
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            phone TEXT,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'customer',
            created_at TEXT NOT NULL
        )
    `);
    
    console.log("Users table ready.");
    
    
    try {
        db.exec(`ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0`);
        console.log("Added users.email_verified");
    } catch (err) {
        // SQLite error messages differ by platform; be permissive when the column already exists.
        if (!String(err.message).toLowerCase().includes("duplicate column name") &&
            !String(err.message).toLowerCase().includes("already exists")) {
            throw err;
        }
    }
    
    try {
        db.exec(`ALTER TABLE users ADD COLUMN avatar TEXT`);
        console.log("Added users.avatar");
    } catch (err) {
        if (!String(err.message).toLowerCase().includes("duplicate column name") &&
            !String(err.message).toLowerCase().includes("already exists")) {
            throw err;
        }
    }
    
    /* =========================================================
       PASSWORD RESET TOKENS
    ========================================================= */
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
    
            FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE
        )
    `);
    
    console.log("Password reset tokens table ready.");
    
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS email_verification_tokens (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            expires_at TEXT NOT NULL,
            used INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
    
            FOREIGN KEY (user_id)
                REFERENCES users(id)
                ON DELETE CASCADE
        )
    `);
    
    console.log("Email verification tokens table ready.");
    
    /* =========================================================
       CUSTOMER COMPLAINTS
    ========================================================= */
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS complaints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            order_id TEXT NOT NULL,
            message TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Open',
            admin_response TEXT,
            refund_status TEXT NOT NULL DEFAULT 'Not Requested',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (order_id) REFERENCES orders(order_id) ON DELETE CASCADE
        )
    `);
    
    console.log("Complaints table ready.");
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS complaint_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            complaint_id INTEGER NOT NULL,
            sender_role TEXT NOT NULL,
            sender_name TEXT NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (complaint_id) REFERENCES complaints(id) ON DELETE CASCADE
        )
    `);
    
    console.log("Complaint messages table ready.");
    
    /* =========================================================
       SETTING TABLE
    ========================================================= */
    
    
    db.exec(`
        CREATE TABLE IF NOT EXISTS store_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);
    
    function getSetting(key, fallback) {
        const row = db.prepare(`SELECT value FROM store_settings WHERE key = ?`).get(key);
        return row ? row.value : fallback;
    }
    
    function setSetting(key, value) {
        db.prepare(`
            INSERT INTO store_settings (key, value) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `).run(key, String(value));
    }
    
    // Seed defaults on first run only
    if (getSetting("maintenance_mode", null) === null) {
        setSetting("maintenance_mode", "0");
    }
    if (getSetting("usd_ngn_rate", null) === null) {
        setSetting("usd_ngn_rate", String(FZR_EXCHANGE_RATE));
    }
    if (getSetting("payments_enabled", null) === null) {
        setSetting("payments_enabled", "1");
    }
    
    if (getSetting("auto_fulfillment_enabled", null) === null) {
        setSetting("auto_fulfillment_enabled", "1");
    }
    
    if (getSetting("max_quantity", null) === null) {
        setSetting("max_quantity", "20");
    }
    
    if (getSetting("pending_order_expiry_hours", null) === null) {
        setSetting("pending_order_expiry_hours", "24");
    }
    
    if (getSetting("store_announcement", null) === null) {
        setSetting("store_announcement", "");
    }
    
    if (getSetting("notifications_enabled", null) === null) {
        setSetting("notifications_enabled", "1");
    }
    
    if (getSetting("notify_failed_fulfillment", null) === null) {
        setSetting("notify_failed_fulfillment", "1");
    }
    
    if (getSetting("notify_new_complaint", null) === null) {
        setSetting("notify_new_complaint", "1");
    }
    
    if (getSetting("notify_payment_error", null) === null) {
        setSetting("notify_payment_error", "1");
    }
    
    if (getSetting("notify_paid_order", null) === null) {
        setSetting("notify_paid_order", "0");
    }
    
    if (getSetting("notification_email", null) === null) {
        setSetting(
            "notification_email",
            process.env.SMTP_USER || ""
        );
    }
    
    console.log("Store settings table ready.");
    
    db.prepare(`
        CREATE TABLE IF NOT EXISTS unmatched_payments (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
    
            reference TEXT NOT NULL UNIQUE,
    
            amount INTEGER NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'NGN',
    
            email TEXT,
            phone TEXT,
    
            player_id TEXT,
            server_id TEXT,
    
            paystack_status TEXT,
            paid_at TEXT,
    
            metadata_json TEXT,
    
            resolution_status TEXT NOT NULL DEFAULT 'Unresolved',
    
            created_at TEXT NOT NULL
        )
    `).run();
    
    console.log("Unmatched payments table ready.");
    
    
    /* =========================================================
       REPAIR OLD ORDERS
    ========================================================= */
    
    function repairOldOrders() {
        const oldOrders = db.prepare(`
            SELECT
                order_id,
                amount,
                order_total,
                amount_charged,
                status,
                paid_at
            FROM orders
            WHERE
                order_total = 0
    
                OR (
                    amount_charged = 0
    
                    AND (
                        paid_at IS NOT NULL
    
                        OR status IN (
                            'Paid',
                            'Processing',
                            'Completed'
                        )
                    )
                )
        `).all();
    
        const getItems =
            db.prepare(`
                SELECT
                    price,
                    quantity
                FROM order_items
                WHERE order_id = ?
            `);
    
        const updateOrder =
            db.prepare(`
                UPDATE orders
                SET
                    order_total = ?,
                    amount_charged = ?
                WHERE order_id = ?
            `);
    
        for (const order of oldOrders) {
            const items =
                getItems.all(
                    order.order_id
                );
    
            const calculatedOrderTotal =
                items.reduce(
                    (sum, item) => {
                        const price =
                            Number(
                                item.price || 0
                            );
    
                        const quantity =
                            Number(
                                item.quantity || 1
                            );
    
                        return (
                            sum +
                            price * quantity
                        );
                    },
                    0
                );
    
            const isPaidOrder =
                Boolean(order.paid_at) ||
                [
                    "Paid",
                    "Processing",
                    "Completed"
                ].includes(order.status);
    
            const existingCharged =
                isPaidOrder
                    ? Number(
                        order.amount_charged ||
                        order.amount ||
                        0
                    )
                    : 0;
    
            updateOrder.run(
                calculatedOrderTotal,
                existingCharged,
                order.order_id
            );
    
            logger.debug(
                `Repaired order ${order.order_id}`
            );
        }
    }
    
    repairOldOrders();
    
    /* =========================================================
       DEFINE FZR_MLBB_PRODUCTS AT GLOBAL SCOPE (BEFORE /api/products)
    ========================================================= */

    return { db, getSetting, setSetting };
};
