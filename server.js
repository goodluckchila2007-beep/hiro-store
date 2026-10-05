const path = require("path");

require("dotenv").config({
    path: path.join(__dirname, ".env")
});
const express = require("express");
const cors = require("cors");
const axios = require("axios");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const session = require("express-session");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const SqliteStore = require("better-sqlite3-session-store")(session);
const crypto = require("crypto");
const nodemailer = require("nodemailer");
let smtpStatus = "checking";
process.on("uncaughtException", (error) => {
    console.error("UNCAUGHT EXCEPTION � process will exit:", error);
    process.exit(1);
});
process.on("unhandledRejection", (reason) => {
    console.error("UNHANDLED REJECTION:", reason);
});
const app = express();
const PORT = 3000;

const FZR_EXCHANGE_RATE = Number(process.env.FZR_EXCHANGE_RATE || 1400);

const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN || "https://hirostore.site";

const isProduction = process.env.NODE_ENV === "production";
const logger = {
    info: (...args) => {
        console.log(...args);
    },

    warn: (...args) => {
        console.warn(...args);
    },

    error: (...args) => {
        console.error(...args);
    },

    debug: (...args) => {
        if (!isProduction) {
            console.log(...args);
        }
    }
};
if (isProduction) console.log = () => { };


// Behind a reverse proxy (Render/Nginx/Cloudflare) req.secure and the client
// IP only resolve correctly with trust proxy on — required for both secure
// cookies and accurate rate limiting.
app.set("trust proxy", 1);

app.use(helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "https://js.paystack.co", "https://widget.trustpilot.com", "https://invitejs.trustpilot.com"],
            frameSrc: ["'self'", "https://checkout.paystack.com", "https://js.paystack.co", "https://widget.trustpilot.com"],
            connectSrc: ["'self'", "https://api.paystack.co", "https://widget.trustpilot.com", "https://invitejs.trustpilot.com"],
            imgSrc: ["'self'", "data:", "https:"],
            styleSrc: ["'self'", "https:", "'unsafe-inline'"],
            fontSrc: ["'self'", "https:", "data:"],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
            frameAncestors: ["'self'"],
            upgradeInsecureRequests: []
        }
    }
}));

app.use(cors({
    origin: FRONTEND_ORIGIN,
    credentials: true
}));

app.get("/", (req, res, next) => {
    if (getSetting("maintenance_mode", "0") === "1") {
        return res.sendFile(path.join(__dirname, "public", "maintenance.html"));
    }
    next();
});

// Keep the public homepage URL canonical and clean.
app.get("/index.html", (req, res) => {
    return res.redirect(301, "/");
});

app.use(express.static(path.join(__dirname, "public"), {
    setHeaders: (res, filePath) => {
        if (/\.(?:html|js|css)$/i.test(filePath)) {
            res.setHeader(
                "Cache-Control",
                "no-store, no-cache, must-revalidate, proxy-revalidate"
            );
        }
    }
}));

/* =========================================================
   PAYSTACK WEBHOOK
========================================================= */

app.post(
    "/paystack-webhook",
    express.raw({ type: "application/json" }),
    async (req, res) => {

        try {
            const signature = req.headers["x-paystack-signature"];

            if (!signature) {
                console.error("Paystack webhook: Missing signature");

                return res.status(400).json({
                    success: false,
                    message: "Missing Paystack signature"
                });
            }

            /* -------------------------------------------------
               VERIFY PAYSTACK SIGNATURE
            ------------------------------------------------- */

            const rawBody = req.body;

            const hash = crypto
                .createHmac("sha512", PAYSTACK_SECRET_KEY)
                .update(rawBody)
                .digest("hex");

            if (
                hash.length !== signature.length ||
                !crypto.timingSafeEqual(
                    Buffer.from(hash),
                    Buffer.from(signature)
                )
            ) {
                console.error(
                    "Paystack webhook: Invalid signature"
                );

                return res.status(401).json({
                    success: false,
                    message: "Invalid signature"
                });
            }

            /* -------------------------------------------------
               PARSE EVENT
            ------------------------------------------------- */

            const event = JSON.parse(
                rawBody.toString("utf8")
            );

            console.log(
                "Paystack webhook received:",
                event.event
            );

            setSetting(
                "last_paystack_webhook_at",
                new Date().toISOString()
            );

            /* -------------------------------------------------
               ONLY PROCESS SUCCESSFUL PAYMENTS
            ------------------------------------------------- */

            if (event.event !== "charge.success") {
                return res.status(200).json({
                    success: true,
                    message: "Event received"
                });
            }

            const payment = event.data;

            const reference = payment.reference;

            if (!reference) {
                console.error(
                    "Paystack webhook: Missing reference"
                );

                return res.status(400).json({
                    success: false,
                    message: "Missing transaction reference"
                });
            }

            /* -------------------------------------------------
               FIND ORDER
            ------------------------------------------------- */

            const order = db.prepare(`
                SELECT *
                FROM orders
                WHERE reference = ?
            `).get(reference);

            if (!order) {

                console.error(
                    "Paystack webhook: Order not found:",
                    reference
                );

                const metadata =
                    payment.metadata || {};

                const customer =
                    payment.customer || {};

                db.prepare(`
        INSERT INTO unmatched_payments (
            reference,
            amount,
            currency,
            email,
            phone,
            player_id,
            server_id,
            paystack_status,
            paid_at,
            metadata_json,
            resolution_status,
            created_at
        )
        VALUES (
            ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Unresolved', ?
        )

        ON CONFLICT(reference)
        DO UPDATE SET
            amount = excluded.amount,
            currency = excluded.currency,
            email = excluded.email,
            phone = excluded.phone,
            player_id = excluded.player_id,
            server_id = excluded.server_id,
            paystack_status = excluded.paystack_status,
            paid_at = excluded.paid_at,
            metadata_json = excluded.metadata_json
    `).run(
                    reference,

                    Number(
                        payment.amount || 0
                    ),

                    String(
                        payment.currency || "NGN"
                    ),

                    String(
                        customer.email ||
                        metadata.email ||
                        ""
                    ),

                    String(
                        customer.phone ||
                        metadata.phone ||
                        ""
                    ),

                    String(
                        metadata.player_id ||
                        ""
                    ),

                    String(
                        metadata.server_id ||
                        ""
                    ),

                    String(
                        payment.status ||
                        ""
                    ),

                    payment.paid_at ||
                    null,

                    JSON.stringify(
                        metadata
                    ),

                    new Date().toISOString()
                );

                return res.status(200).json({
                    success: true,
                    message:
                        "Payment stored for reconciliation."
                });
            }

            if (order.status === "Refunded") {
                logger.warn(
                    `Paystack webhook ignored for refunded order ${order.order_id}`
                );

                return res.status(200).json({
                    success: true,
                    message: "Refunded order left unchanged."
                });
            }

            /* -------------------------------------------------
               CHECK CURRENCY
            ------------------------------------------------- */

            const paymentCurrency =
                String(payment.currency || "").toUpperCase();

            const orderCurrency =
                String(order.currency || "NGN").toUpperCase();

            if (paymentCurrency !== orderCurrency) {

                console.error(
                    "Paystack webhook: Currency mismatch",
                    {
                        reference,
                        expected: orderCurrency,
                        received: paymentCurrency
                    }
                );

                return res.status(400).json({
                    success: false,
                    message: "Currency mismatch"
                });
            }

            /* -------------------------------------------------
               CHECK AMOUNT
            ------------------------------------------------- */

            const amountChargedKobo =
                Number(payment.amount);

            const expectedAmountKobo =
                Math.round(Number(order.order_total) * 100);

            if (
                !Number.isFinite(amountChargedKobo) ||
                !Number.isFinite(expectedAmountKobo)
            ) {
                console.error(
                    "Paystack webhook: Invalid amount"
                );

                return res.status(400).json({
                    success: false,
                    message: "Invalid payment amount"
                });
            }

            if (amountChargedKobo !== expectedAmountKobo) {

                console.error(
                    "Paystack webhook: Amount mismatch",
                    {
                        reference,
                        expected: expectedAmountKobo,
                        received: amountChargedKobo
                    }
                );

                return res.status(400).json({
                    success: false,
                    message: "Payment amount mismatch"
                });
            }

            /* -------------------------------------------------
                PAYMENT STATE
           ------------------------------------------------- */

            if (order.status === "Paid") {

                console.log(
                    `Paystack webhook: Order ${order.order_id} already paid; checking pending fulfillment`
                );
            }

            /* -------------------------------------------------
               MARK ORDER PAID
            ------------------------------------------------- */

            const paidAt = payment.paid_at || payment.transaction_date || new Date().toISOString();

            const updateOrder = db.prepare(`
                UPDATE orders
                SET
                    status = 'Paid',
                    amount_charged = ?,
                    paid_at = ?
                WHERE reference = ?
                  AND status NOT IN ('Paid', 'Refunded')
            `);

            const result = updateOrder.run(
                amountChargedKobo,
                paidAt,
                reference
            );
            finance.recordFee(reference, payment, "webhook");

            if (result.changes === 1) {
                console.log(
                    `Paystack webhook: Order ${order.order_id} marked Paid`
                );
            } else {
                console.log(
                    `Paystack webhook: Order ${order.order_id} was already Paid`
                );
            }

            /* -------------------------------------------------
               AUTO FULFILLMENT CONTROL

               Payment is already recorded as Paid above. If auto
               fulfillment is disabled, leave items Pending so an
               admin can explicitly submit them later.
            ------------------------------------------------- */

            const autoFulfillmentEnabled =
                getSetting(
                    "auto_fulfillment_enabled",
                    "1"
                ) === "1";

            if (!autoFulfillmentEnabled) {
                logger.info(
                    `Auto fulfillment disabled; order ${order.order_id} remains Paid with Pending item(s).`
                );

                return res.status(200).json({
                    success: true,
                    message:
                        "Payment recorded. Automatic fulfillment is disabled."
                });
            }

            /* -------------------------------------------------
               GET PENDING ORDER ITEMS
            ------------------------------------------------- */

            const pendingOrderItems = db.prepare(`
                SELECT
                    id,
                    offer_id,
                    category_id,
                    player_id,
                    server_id,
                    fulfillment_status,
                    fzr_order_id
                FROM order_items
                WHERE order_id = ?
                  AND fulfillment_status = 'Pending'
                ORDER BY id ASC
            `).all(order.order_id);

            const fulfillmentResults = [];

            /* -------------------------------------------------
               FZR FULFILLMENT
            ------------------------------------------------- */

            for (const orderItem of pendingOrderItems) {

                /*
                 * Claim item first.
                 *
                 * This prevents two webhook requests from
                 * sending the same item to FZR.
                 */

                const claim = db.prepare(`
                    UPDATE order_items
                    SET fulfillment_status = 'Processing'
                    WHERE id = ?
                      AND fulfillment_status = 'Pending'
                `).run(orderItem.id);

                if (claim.changes !== 1) {

                    console.log(
                        "FZR item already claimed:",
                        orderItem.id
                    );

                    continue;
                }

                try {

                    console.log(
                        "========================================"
                    );

                    console.log(
                        "FZR FULFILLMENT START"
                    );

                    console.log(
                        "Order:",
                        order.order_id
                    );

                    console.log(
                        "Item:",
                        orderItem.id
                    );

                    console.log(
                        "Offer:",
                        orderItem.offer_id
                    );

                    console.log(
                        "Player:",
                        orderItem.player_id
                    );

                    console.log(
                        "Server:",
                        orderItem.server_id
                    );

                    console.log(
                        "========================================"
                    );


                    const fzrResult =
                        await createFzrTopup({
                            offerId: orderItem.offer_id,
                            categoryId: orderItem.category_id,
                            playerId: orderItem.player_id,
                            serverId: orderItem.server_id
                        });

                    const fzrOrderId =
                        fzrResult?.order?.id || null;

                    const fzrStatus =
                        fzrResult?.order?.status ||
                        "created";

                    const fulfillmentStatus =
                        mapFzrStatusToFulfillmentStatus(fzrStatus);

                    db.prepare(`
                        UPDATE order_items
                        SET
                            fulfillment_status = ?,
                            fzr_order_id = ?
                        WHERE id = ?
                    `).run(
                        fulfillmentStatus,
                        fzrOrderId,
                        orderItem.id
                    );

                    fulfillmentResults.push({
                        itemId: orderItem.id,
                        offerId: orderItem.offer_id,
                        playerId: orderItem.player_id,
                        serverId: orderItem.server_id,
                        success: true,
                        fzrOrderId,
                        status: fzrStatus
                    });

                } catch (fzrError) {

                    console.error(
                        "FZR FULFILLMENT FAILED:",
                        fzrError.message
                    );

                    const failure = fzrFailureDetails(fzrError);

                    db.prepare(`
                        UPDATE order_items
                        SET fulfillment_status = ?, fulfillment_error = ?
                        WHERE id = ?
                    `).run(failure.status, failure.message, orderItem.id);

                    sendFulfillmentFailureAlert(orderItem, failure.message, failure.status);

                    fulfillmentResults.push({
                        itemId: orderItem.id,
                        offerId: orderItem.offer_id,
                        playerId: orderItem.player_id,
                        serverId: orderItem.server_id,
                        success: false,
                        error: fzrError.message
                    });
                }
            }

            /* -------------------------------------------------
               LOG RESULT
            ------------------------------------------------- */

            console.log(
                "========================================"
            );

            console.log(
                "PAYSTACK WEBHOOK COMPLETED"
            );

            console.log(
                "Order:",
                order.order_id
            );

            console.log(
                "Reference:",
                reference
            );

            console.log(
                "Amount:",
                `₦${(amountChargedKobo / 100).toLocaleString()}`
            );

            console.log(
                "FZR:",
                JSON.stringify(
                    fulfillmentResults,
                    null,
                    2
                )
            );

            console.log(
                "========================================"
            );

            return res.status(200).json({
                success: true,
                message: "Payment processed successfully",
                orderId: order.order_id,
                reference,
                fulfillment: fulfillmentResults
            });

        } catch (error) {

            console.error(
                "========================================"
            );

            console.error(
                "PAYSTACK WEBHOOK ERROR"
            );

            console.error(
                error
            );

            console.error(
                "========================================"
            );

            return res.status(500).json({
                success: false,
                message: "Webhook processing error"
            });
        }
    }
);

app.use(express.json({ limit: "100kb" }));

// express-session's default MemoryStore leaks memory and drops every session
// on restart. Persist sessions in SQLite so logins survive deploys.
const sessionDb = new Database("hiro-sessions.db");

app.use(session({
    store: new SqliteStore({
        client: sessionDb,
        expired: {
            clear: true,
            intervalMs: 15 * 60 * 1000
        }
    }),

    secret:
        process.env.SESSION_SECRET ||
        (isProduction
            ? (() => { throw new Error("SESSION_SECRET is required in production"); })()
            : "hiro-store-dev-secret"),

    resave: false,
    saveUninitialized: false,
    rolling: true,

    cookie: {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? "strict" : "lax",
        maxAge:
            7 * 24 * 60 * 60 * 1000
    }
}));

/* =========================================================
   CSRF PROTECTION
========================================================= */

const CSRF_EXEMPT = [
    "/paystack-webhook",
    "/csrf-token",
    "/verify-email",
    "/resend-verification"
];

app.use((req, res, next) => {

    if (!req.session.csrfToken) {
        req.session.csrfToken =
            crypto.randomBytes(32).toString("hex");
    }

    if (
        ["GET", "HEAD", "OPTIONS"]
            .includes(req.method)
    ) {
        return next();
    }

    if (
        CSRF_EXEMPT.some(
            path => req.path.startsWith(path)
        )
    ) {
        return next();
    }

    const sent =
        req.headers["x-csrf-token"];

    if (
        !sent ||
        typeof sent !== "string" ||
        sent.length !==
        req.session.csrfToken.length ||
        !crypto.timingSafeEqual(
            Buffer.from(sent),
            Buffer.from(
                req.session.csrfToken
            )
        )
    ) {
        return res.status(403).json({
            success: false,
            message:
                "Invalid or missing CSRF token. Refresh the page and try again."
        });
    }

    next();
});

app.get("/csrf-token", (req, res) => {

    if (!req.session.csrfToken) {
        req.session.csrfToken =
            crypto.randomBytes(32).toString("hex");
    }

    return res.json({
        csrfToken: req.session.csrfToken
    });
});


/* =========================================================
   RATE LIMITING
   Credential and money endpoints are brute-force targets.
========================================================= */

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    message: {
        success: false,
        message: "Too many attempts. Please try again in a few minutes."
    }
});

const passwordResetLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many password reset requests. Please try again later."
    }
});

const paymentLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many requests. Please slow down."
    }
});

const apiLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: {
        success: false,
        message: "Too many requests. Please slow down."
    }
});

const mailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 465),
    secure:
        String(process.env.SMTP_SECURE).toLowerCase() === "true",

    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});
mailTransporter.verify()
    .then(() => {

        smtpStatus = "ready";

        logger.info(
            "✅ SMTP email service ready."
        );

    })
    .catch(error => {

        smtpStatus = "error";

        logger.error(
            "SMTP verification failed:",
            error.message
        );
    });

async function sendAdminNotification({
    subject,
    text,
    type
}) {
    try {
        if (
            getSetting(
                "notifications_enabled",
                "1"
            ) !== "1"
        ) {
            return;
        }

        const typeSettingMap = {
            failed_fulfillment:
                "notify_failed_fulfillment",

            new_complaint:
                "notify_new_complaint",

            payment_error:
                "notify_payment_error",

            paid_order:
                "notify_paid_order"
        };

        const settingKey =
            typeSettingMap[type];

        if (
            settingKey &&
            getSetting(
                settingKey,
                "1"
            ) !== "1"
        ) {
            return;
        }

        const notificationEmail =
            String(
                getSetting(
                    "notification_email",
                    process.env.SMTP_USER || ""
                )
            ).trim();

        if (!notificationEmail) {
            logger.warn(
                "Admin notification skipped: no notification email configured."
            );

            return;
        }

        await mailTransporter.sendMail({
            from:
                `"Hiro Store Alerts" <${process.env.SMTP_USER}>`,

            to:
                notificationEmail,

            subject,

            text
        });

    } catch (error) {

        /*
         * IMPORTANT:
         * Notification failure must NEVER
         * break payment or fulfillment.
         */
        logger.error(
            "Admin notification failed:",
            error.message
        );
    }
}

/* =========================================================
   PAYSTACK
========================================================= */

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

if (!PAYSTACK_SECRET_KEY) {
    console.error("ERROR: PAYSTACK_SECRET_KEY is missing from .env");
    process.exit(1);
}

/* =========================================================
   SQLITE
========================================================= */

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

const FZR_MLBB_PRODUCTS = [
    { offer_id: "5_diamonds", title: "5 Diamonds", supplier_price_usd: 0.08, retail_price_ngn: 150 },
    { offer_id: "12_diamonds", title: "12 Diamonds", supplier_price_usd: 0.20, retail_price_ngn: 350 },
    { offer_id: "10_1_diamonds", title: "10 + 1 Diamonds", supplier_price_usd: 0.21, retail_price_ngn: 370 },
    { offer_id: "14_diamonds", title: "14 Diamonds", supplier_price_usd: 0.23, retail_price_ngn: 400 },
    { offer_id: "19_diamonds", title: "19 Diamonds", supplier_price_usd: 0.31, retail_price_ngn: 520 },
    { offer_id: "20_2_diamonds", title: "20 + 2 Diamonds", supplier_price_usd: 0.43, retail_price_ngn: 700 },
    { offer_id: "28_diamonds", title: "28 Diamonds", supplier_price_usd: 0.46, retail_price_ngn: 750 },
    { offer_id: "42_diamonds", title: "42 Diamonds", supplier_price_usd: 0.70, retail_price_ngn: 1100 },
    { offer_id: "50_5_diamonds_first_top_up_bonus", title: "50 + 5 Diamonds (First Top-Up Bonus)", supplier_price_usd: 0.75, retail_price_ngn: 1200 },
    { offer_id: "weekly_elite_pack", title: "Weekly Elite Pack", supplier_price_usd: 0.76, retail_price_ngn: 1200 },
    { offer_id: "51_5_diamonds", title: "51 + 5 Diamonds", supplier_price_usd: 1.06, retail_price_ngn: 1650 },
    { offer_id: "70_diamonds", title: "70 Diamonds", supplier_price_usd: 1.16, retail_price_ngn: 1800 },
    { offer_id: "78_8_diamonds", title: "78 + 8 Diamonds", supplier_price_usd: 1.17, retail_price_ngn: 1850 },
    { offer_id: "weekly_pass", title: "Weekly Pass", supplier_price_usd: 1.45, retail_price_ngn: 2195 },
    { offer_id: "102_10_diamonds", title: "102 + 10 Diamonds", supplier_price_usd: 2.12, retail_price_ngn: 3250 },
    { offer_id: "150_15_diamonds_first_top_up_bonus", title: "150 + 15 Diamonds (First Top-Up Bonus)", supplier_price_usd: 2.23, retail_price_ngn: 3450 },
    { offer_id: "140_diamonds", title: "140 Diamonds", supplier_price_usd: 2.32, retail_price_ngn: 3550 },
    { offer_id: "156_16_diamonds", title: "156 + 16 Diamonds", supplier_price_usd: 2.33, retail_price_ngn: 3650 },
    { offer_id: "170_diamonds", title: "170 Diamonds", supplier_price_usd: 2.64, retail_price_ngn: 4000 },
    { offer_id: "234_23_diamonds", title: "234 + 23 Diamonds", supplier_price_usd: 3.35, retail_price_ngn: 5400 },
    { offer_id: "250_25_diamonds_first_top_up_bonus", title: "250 + 25 Diamonds (First Top-Up Bonus)", supplier_price_usd: 3.58, retail_price_ngn: 5700 },
    { offer_id: "240_diamonds", title: "240 Diamonds", supplier_price_usd: 3.73, retail_price_ngn: 5650 },
    { offer_id: "monthly_elite_pack", title: "Monthly Elite Pack", supplier_price_usd: 3.76, retail_price_ngn: 5700 },
    { offer_id: "296_diamonds", title: "296 Diamonds", supplier_price_usd: 4.59, retail_price_ngn: 6950 },
    { offer_id: "284_diamonds", title: "284 Diamonds", supplier_price_usd: 4.63, retail_price_ngn: 7000 },
    { offer_id: "429_diamonds", title: "429 Diamonds", supplier_price_usd: 5.68, retail_price_ngn: 8550 },
    { offer_id: "355_diamonds", title: "355 Diamonds", supplier_price_usd: 5.80, retail_price_ngn: 8700 },
    { offer_id: "500_65_diamonds_first_top_up_bonus", title: "500 + 65 Diamonds (First Top-Up Bonus)", supplier_price_usd: 7.36, retail_price_ngn: 11000 },
    { offer_id: "twilight_pass", title: "Twilight Pass", supplier_price_usd: 7.69, retail_price_ngn: 11500 },
    { offer_id: "504_66_diamonds", title: "504 + 66 Diamonds", supplier_price_usd: 9.11, retail_price_ngn: 13000 },
    { offer_id: "625_81_diamonds", title: "625 + 81 Diamonds", supplier_price_usd: 9.16, retail_price_ngn: 13700 },
    { offer_id: "716_diamonds", title: "716 Diamonds", supplier_price_usd: 11.61, retail_price_ngn: 17200 },
    { offer_id: "1084_diamonds", title: "1084 Diamonds", supplier_price_usd: 17.57, retail_price_ngn: 25900 },
    { offer_id: "1007_156_diamonds", title: "1007 + 156 Diamonds", supplier_price_usd: 18.23, retail_price_ngn: 26900 },
    { offer_id: "1446_diamonds", title: "1446 Diamonds", supplier_price_usd: 23.13, retail_price_ngn: 33900 },
    { offer_id: "1860_335_diamonds", title: "1860 + 335 Diamonds", supplier_price_usd: 27.71, retail_price_ngn: 40500 },
    { offer_id: "2010_diamonds", title: "2010 Diamonds", supplier_price_usd: 28.56, retail_price_ngn: 41700 },
    { offer_id: "2015_383_diamonds", title: "2015 + 383 Diamonds", supplier_price_usd: 41.47, retail_price_ngn: 60500 },
    { offer_id: "3099_589_diamonds", title: "3099 + 589 Diamonds", supplier_price_usd: 46.22, retail_price_ngn: 67000 },
    { offer_id: "2976_diamonds", title: "2976 Diamonds", supplier_price_usd: 46.41, retail_price_ngn: 66000 },
    { offer_id: "4649_883_diamonds", title: "4649 + 883 Diamonds", supplier_price_usd: 69.79, retail_price_ngn: 103000 },
    { offer_id: "7502_diamonds", title: "7502 Diamonds", supplier_price_usd: 115.80, retail_price_ngn: 167000 },
    { offer_id: "7740_1548_diamonds", title: "7740 + 1548 Diamonds", supplier_price_usd: 115.91, retail_price_ngn: 170500 }
];

const FZR_PH_PRODUCTS = [
    { offer_id: "10_1_diamonds", title: "10 + 1 Diamonds", supplier_price_usd: 0.1713, retail_price_ngn: 300 },
    { offer_id: "20_2_diamonds", title: "20 + 2 Diamonds", supplier_price_usd: 0.3325, retail_price_ngn: 550 },
    { offer_id: "51_5_diamonds", title: "51 + 5 Diamonds", supplier_price_usd: 0.8463, retail_price_ngn: 1350 },
    { offer_id: "50_5_diamonds_first_top_up_bonus", title: "50 + 5 Diamonds (First Top-Up Bonus)", supplier_price_usd: 0.8564, retail_price_ngn: 1350 },
    { offer_id: "weekly_diamond_pass", title: "Weekly Diamond Pass", supplier_price_usd: 1.7833, retail_price_ngn: 2750 },
    { offer_id: "102_10_diamonds", title: "102 + 10 Diamonds", supplier_price_usd: 1.7027, retail_price_ngn: 2650 },
    { offer_id: "153_15_diamonds", title: "153 + 15 Diamonds", supplier_price_usd: 2.6497, retail_price_ngn: 4050 },
    { offer_id: "203_20_diamonds", title: "203 + 20 Diamonds", supplier_price_usd: 3.3348, retail_price_ngn: 5050 },
    { offer_id: "150_15_diamonds_first_top_up_bonus", title: "150 + 15 Diamonds (First Top-Up Bonus)", supplier_price_usd: 2.5188, retail_price_ngn: 3850 },
    { offer_id: "303_33_diamonds", title: "303 + 33 Diamonds", supplier_price_usd: 5.0979, retail_price_ngn: 7650 },
    { offer_id: "250_25_diamonds_first_top_up_bonus", title: "250 + 25 Diamonds (First Top-Up Bonus)", supplier_price_usd: 4.1811, retail_price_ngn: 6300 },
    { offer_id: "twilight_pass", title: "Twilight Pass", supplier_price_usd: 8.5738, retail_price_ngn: 12800 },
    { offer_id: "504_66_diamonds", title: "504 + 66 Diamonds", supplier_price_usd: 8.4832, retail_price_ngn: 12650 },
    { offer_id: "500_65_diamonds_first_top_up_bonus", title: "500 + 65 Diamonds (First Top-Up Bonus)", supplier_price_usd: 8.4630, retail_price_ngn: 12600 },
    { offer_id: "1007_156_diamonds", title: "1007 + 156 Diamonds", supplier_price_usd: 16.9965, retail_price_ngn: 25200 },
    { offer_id: "2015_383_diamonds", title: "2015 + 383 Diamonds", supplier_price_usd: 33.9931, retail_price_ngn: 50000 },
    { offer_id: "5035_1007_diamonds", title: "5035 + 1007 Diamonds", supplier_price_usd: 84.9927, retail_price_ngn: 124000 }
];

/* =========================================================
   PRODUCTS TABLE — SAFE CREATION / MIGRATION
========================================================= */

const productsTableInfo = db.prepare(`PRAGMA table_info(products)`).all();

if (productsTableInfo.length === 0) {
    db.exec(`
        CREATE TABLE products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            category_id TEXT NOT NULL,
            offer_id TEXT NOT NULL,
            title TEXT NOT NULL,
            supplier_price_usd REAL NOT NULL DEFAULT 0,
            retail_price_usd REAL NOT NULL DEFAULT 0,
            retail_price_ngn INTEGER NOT NULL DEFAULT 0,
            available INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(category_id, offer_id)
        )
    `);
    console.log("Products table created.");
}

const existingProductColumns = db.prepare(`PRAGMA table_info(products)`).all().map(column => column.name);

if (!existingProductColumns.includes("category_id")) db.exec(`ALTER TABLE products ADD COLUMN category_id TEXT`);
if (!existingProductColumns.includes("offer_id")) db.exec(`ALTER TABLE products ADD COLUMN offer_id TEXT`);
if (!existingProductColumns.includes("title")) db.exec(`ALTER TABLE products ADD COLUMN title TEXT`);
if (!existingProductColumns.includes("supplier_price_usd")) db.exec(`ALTER TABLE products ADD COLUMN supplier_price_usd REAL NOT NULL DEFAULT 0`);
if (!existingProductColumns.includes("retail_price_usd")) db.exec(`ALTER TABLE products ADD COLUMN retail_price_usd REAL NOT NULL DEFAULT 0`);
if (!existingProductColumns.includes("retail_price_ngn")) db.exec(`ALTER TABLE products ADD COLUMN retail_price_ngn INTEGER NOT NULL DEFAULT 0`);
if (!existingProductColumns.includes("available")) db.exec(`ALTER TABLE products ADD COLUMN available INTEGER NOT NULL DEFAULT 1`);
if (!existingProductColumns.includes("created_at")) db.exec(`ALTER TABLE products ADD COLUMN created_at TEXT`);
if (!existingProductColumns.includes("updated_at")) db.exec(`ALTER TABLE products ADD COLUMN updated_at TEXT`);

const finalProductColumns = db.prepare(`PRAGMA table_info(products)`).all().map(column => column.name);
console.log("Products table columns:", finalProductColumns);
console.log("FZR products table ready.");

/* =========================================================
   INSERT / UPDATE FZR PRODUCTS
========================================================= */

const now = new Date().toISOString();

const upsertFzrProduct = db.prepare(`
    INSERT INTO products (
        category_id, offer_id, title, supplier_price_usd, retail_price_usd, retail_price_ngn, available, created_at, updated_at
    )
    VALUES (
        @category_id, @offer_id, @title, @supplier_price_usd, @retail_price_usd, @retail_price_ngn, @available, @created_at, @updated_at
    )
    ON CONFLICT (category_id, offer_id)

    DO NOTHING
`);

const syncFzrProducts = db.transaction(() => {
    for (const product of FZR_MLBB_PRODUCTS) {
        upsertFzrProduct.run({
            category_id: "mobile_legends_global",
            offer_id: product.offer_id,
            title: product.title,
            supplier_price_usd: product.supplier_price_usd,
            retail_price_usd: 0,
            retail_price_ngn: product.retail_price_ngn,
            available: 1,
            created_at: now,
            updated_at: now
        });
    }

    for (const product of FZR_PH_PRODUCTS) {
        upsertFzrProduct.run({
            category_id: "mobile_legends_philippines",
            offer_id: product.offer_id,
            title: product.title,
            supplier_price_usd: product.supplier_price_usd,
            retail_price_usd: 0,
            retail_price_ngn: product.retail_price_ngn,
            available: 1,
            created_at: now,
            updated_at: now
        });
    }
});

syncFzrProducts();

console.log(`FZR Mobile Legends products loaded: ${FZR_MLBB_PRODUCTS.length} Global, ${FZR_PH_PRODUCTS.length} Philippines`);

app.post("/api/validate-player", apiLimiter, async (req, res) => {
    try {
        const { player_id, zone_id } = req.body;

        if (!player_id || !zone_id) {
            return res.status(400).json({
                ok: false,
                error: "Player ID and Zone ID are required"
            });
        }

        const fzrResponse = await fetch(
            "https://api.fzr.cards/api/v2/topups/validate-id",
            {
                method: "POST",
                headers: {
                    "Accept": "application/json",
                    "Content-Type": "application/json",
                    "X-API-Key": process.env.FZR_API_KEY
                },
                body: JSON.stringify({
                    category_id: "mobile_legends",
                    fields: {
                        player_id: String(player_id),
                        zone_id: String(zone_id)
                    }
                })
            }
        );

        const data = await fzrResponse.json();

        logger.debug("FZR player validation completed.");

        return res.status(fzrResponse.status).json(data);

    } catch (error) {
        console.error("FZR error:", error);

        return res.status(500).json({
            ok: false,
            error: "Unable to contact validation service"
        });
    }
});
console.log("✅ /api/validate-player route registered");


/* =========================================================
   FZR MOBILE LEGENDS FULFILLMENT
========================================================= */

const FZR_API_URL = "https://api.fzr.cards/api/v2";

// Supplier costs persist across restarts; catalog seeds only insert missing products.
const finance = require("./hiro-finance").createFinance({
    db, axios, getSetting, setSetting,
    exchangeRateFallback: FZR_EXCHANGE_RATE,
    apiKey: process.env.FZR_API_KEY,
    paystackKey: PAYSTACK_SECRET_KEY
});

app.get("/api/admin/profit", requireAdmin, async (req, res) => {
    try {
        await finance.refreshPrices();
        return res.json({ success: true, profit: finance.overview(String(req.query.period || "7")) });
    } catch (error) {
        logger.error("Profit report unavailable:", error.message);
        return res.status(500).json({ success: false, message: "Unable to load profit report." });
    }
});

app.post("/api/admin/paystack-fees/recover", requireAdmin, async (req, res) => {
    try {
        const result = await finance.recoverFees();
        if (result.busy) return res.status(409).json({ success: false, message: "Fee recovery is already running." });
        return res.json({ success: true, ...result });
    } catch (error) {
        logger.error("Fee recovery unavailable:", error.message);
        return res.status(502).json({ success: false, message: "Unable to recover fees right now." });
    }
});


function mapFzrStatusToFulfillmentStatus(status) {
    const normalizedStatus =
        String(status || "").toLowerCase();

    if (
        ["completed", "success", "successful"]
            .includes(normalizedStatus)
    ) {
        return "Completed";
    }

    if (
        [
            "failed",
            "cancelled",
            "canceled",
            "refunded",
            "refund"
        ].includes(normalizedStatus)
    ) {
        return "Failed";
    }

    return "Processing";
}

class FzrSubmissionError extends Error {
    constructor(message, outcomeUnknown = false, httpStatus = null) {
        super(message);
        this.name = "FzrSubmissionError";
        this.outcomeUnknown = outcomeUnknown;
        this.httpStatus = httpStatus;
    }
}

function fzrFailureDetails(error) {
    return {
        status: error?.outcomeUnknown ? "Review Required" : "Failed",
        message: String(error?.message || "Unknown FZR error").trim().slice(0, 500)
    };
}

async function createFzrTopup({ offerId, categoryId, playerId, serverId }) {
    if (!process.env.FZR_API_KEY) throw new FzrSubmissionError("FZR_API_KEY is missing.");
    if (!offerId) throw new FzrSubmissionError("FZR offer ID is missing.");
    if (!playerId) throw new FzrSubmissionError("Mobile Legends player ID is missing.");
    if (!serverId) throw new FzrSubmissionError("Mobile Legends server ID is missing.");

    const allowedFzrCategories = ["mobile_legends_global", "mobile_legends_philippines"];
    const resolvedCategoryId = allowedFzrCategories.includes(categoryId) ? categoryId : "mobile_legends_global";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
        const response = await fetch(`${FZR_API_URL}/topups/order`, {
            method: "POST",
            headers: {
                Accept: "application/json",
                "Content-Type": "application/json",
                "X-API-Key": process.env.FZR_API_KEY
            },
            body: JSON.stringify({
                category_id: resolvedCategoryId,
                offer_id: String(offerId),
                fields: { player_id: String(playerId), server_id: String(serverId) }
            }),
            signal: controller.signal
        });

        const contentType = String(response.headers.get("content-type") || "").toLowerCase();
        const rawBody = await response.text();
        let data = null;
        try { data = rawBody ? JSON.parse(rawBody) : null; } catch { data = null; }

        if (!data || typeof data !== "object") {
            const message = response.status >= 500
                ? `FZR is temporarily unavailable (HTTP ${response.status}).`
                : `FZR returned an unexpected ${contentType || "non-JSON"} response (HTTP ${response.status}).`;
            throw new FzrSubmissionError(message, true, response.status);
        }

        logger.info(`FZR topup response: HTTP ${response.status}, ${data.ok ? "success" : "failed"}`);

        if (!response.ok || !data.ok) {
            const message = String(data.error || data.message || `FZR returned HTTP ${response.status}.`);
            throw new FzrSubmissionError(message, response.status >= 500, response.status);
        }

        if (!data.order?.id) {
            throw new FzrSubmissionError("FZR accepted the request but did not return an order ID.", true, response.status);
        }

        return data;
    } catch (error) {
        if (error instanceof FzrSubmissionError) throw error;
        if (error?.name === "AbortError") {
            throw new FzrSubmissionError("FZR request timed out. The supplier outcome is unknown.", true);
        }
        throw new FzrSubmissionError(`Could not reach FZR: ${String(error?.message || "network error")}. The supplier outcome is unknown.`, true);
    } finally {
        clearTimeout(timeout);
    }
}


async function getFzrOrderStatus(fzrOrderId) {
    const controller =
        new AbortController();

    const timeout =
        setTimeout(
            () => controller.abort(),
            8000
        );

    try {
        const response = await fetch(
            `${FZR_API_URL}/orders/${encodeURIComponent(fzrOrderId)}`,
            {
                method: "GET",

                headers: {
                    Accept: "application/json",
                    "X-API-Key":
                        process.env.FZR_API_KEY
                },

                signal:
                    controller.signal
            }
        );

        /*
         * Read as text first.
         *
         * FZR has occasionally returned HTML
         * error pages, so response.json() directly
         * is unsafe.
         */
        const rawBody =
            await response.text();

        let data;

        try {
            data =
                rawBody
                    ? JSON.parse(rawBody)
                    : {};
        } catch {
            throw new Error(
                `FZR returned non-JSON response (HTTP ${response.status}).`
            );
        }

        if (
            !response.ok ||
            !data.ok ||
            !data.order
        ) {
            throw new Error(
                data.error ||
                data.message ||
                `FZR order status request failed with HTTP ${response.status}.`
            );
        }

        return data.order;

    } catch (error) {

        if (error.name === "AbortError") {
            throw new Error(
                "FZR status request timed out."
            );
        }

        throw error;

    } finally {

        clearTimeout(timeout);
    }
}

const fzrPollState = new Map();

let fzrCheckerRunning = false;

const FZR_POLL_BASE_DELAY =
    30 * 1000;

const FZR_POLL_MAX_DELAY =
    15 * 60 * 1000;

const FZR_POLL_MAX_FAILURES =
    6;

async function checkPendingFzrOrders() {

    /*
     * Prevent overlapping checker runs.
     */
    if (fzrCheckerRunning) {
        return;
    }

    fzrCheckerRunning = true;

    try {

        /*
         * Only check FZR orders belonging to
         * Hiro orders that are actually Paid.
         */
        const pendingItems =
            db.prepare(`
                SELECT
                    oi.id,
                    oi.order_id,
                    oi.fzr_order_id
                FROM order_items oi

                INNER JOIN orders o
                    ON o.order_id =
                       oi.order_id

                WHERE
                    oi.fulfillment_status =
                        'Processing'

                    AND oi.fzr_order_id
                        IS NOT NULL

                    AND oi.fzr_order_id
                        != ''

                    AND o.status =
                        'Paid'
            `).all();

        if (!pendingItems.length) {
            return;
        }

        const now =
            Date.now();

        for (
            const item
            of pendingItems
        ) {

            const key =
                String(
                    item.fzr_order_id
                );

            const state =
                fzrPollState.get(key) || {
                    failures: 0,
                    nextPollAt: 0
                };

            /*
             * Backoff still active.
             */
            if (
                now <
                state.nextPollAt
            ) {
                continue;
            }

            /*
             * After repeated consecutive
             * failures, pause automatic checks
             * for 15 minutes.
             *
             * IMPORTANT:
             * We DO NOT mark the item Failed,
             * because FZR may actually have
             * processed it successfully.
             */
            if (
                state.failures >=
                FZR_POLL_MAX_FAILURES
            ) {

                console.error(
                    `FZR order ${key} needs review after ${state.failures} consecutive status-check failures.`
                );

                state.nextPollAt =
                    now +
                    FZR_POLL_MAX_DELAY;

                /*
                 * Allow another attempt after
                 * the cooldown instead of
                 * permanently abandoning it.
                 */
                state.failures =
                    Math.max(
                        3,
                        state.failures - 1
                    );

                fzrPollState.set(
                    key,
                    state
                );

                continue;
            }

            try {

                const fzrOrder =
                    await getFzrOrderStatus(
                        key
                    );

                const status =
                    String(fzrOrder.status || "").toLowerCase();

                const fulfillmentStatus =
                    mapFzrStatusToFulfillmentStatus(status);

                /*
                 * Successful communication with
                 * FZR resets failure backoff.
                 */
                state.failures = 0;

                state.nextPollAt =
                    now +
                    FZR_POLL_BASE_DELAY;

                fzrPollState.set(
                    key,
                    state
                );

                if (
                    fulfillmentStatus !==
                    "Processing"
                ) {

                    const result =
                        db.prepare(`
                            UPDATE order_items

                            SET
                                fulfillment_status = ?

                            WHERE id = ?
                              AND fulfillment_status =
                                  'Processing'
                        `).run(
                            fulfillmentStatus,
                            item.id
                        );

                    if (
                        result.changes === 1
                    ) {

                        console.log(
                            `FZR ${key}: ${status} → ${fulfillmentStatus}`
                        );
                    }

                    /*
                     * No reason to retain state
                     * once the FZR order reaches
                     * a final status.
                     */
                    fzrPollState.delete(
                        key
                    );
                }

            } catch (error) {

                state.failures += 1;

                /*
                 * Exponential backoff:
                 *
                 * 30 sec
                 * 60 sec
                 * 2 min
                 * 4 min
                 * 8 min
                 * capped at 15 min
                 */
                const delay =
                    Math.min(
                        FZR_POLL_BASE_DELAY *
                        Math.pow(
                            2,
                            state.failures - 1
                        ),

                        FZR_POLL_MAX_DELAY
                    );

                state.nextPollAt =
                    Date.now() +
                    delay;

                fzrPollState.set(
                    key,
                    state
                );

                console.error(
                    `Could not check FZR order ${key} ` +
                    `(attempt ${state.failures}, retry in ${Math.round(delay / 1000)}s):`,
                    error.message
                );
            }
        }

    } catch (error) {

        console.error(
            "FZR pending-order checker error:",
            error.message
        );

    } finally {

        fzrCheckerRunning =
            false;
    }
}

/* =========================================================
   CUSTOMER SIGN UP
========================================================= */

app.post("/signup", authLimiter, async (req, res) => {
    try {
        const { name, email, phone, password } = req.body;
        const cleanName = String(name || "").trim();
        const cleanEmail = String(email || "").trim().toLowerCase();
        const cleanPhone = String(phone || "").trim();
        const cleanPassword = String(password || "");

        if (!cleanName) return res.status(400).json({ success: false, message: "Name is required." });
        if (!cleanEmail) return res.status(400).json({ success: false, message: "Email is required." });
        if (!cleanEmail.includes("@")) return res.status(400).json({ success: false, message: "Please enter a valid email address." });
        if (cleanPassword.length < 8) return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });

        const existingUser = db.prepare(`SELECT id FROM users WHERE email = ?`).get(cleanEmail);
        if (existingUser) return res.status(409).json({ success: false, message: "An account with this email already exists." });

        const passwordHash = await bcrypt.hash(cleanPassword, 12);
        const createdAt = new Date().toISOString();

        const result = db.prepare(`
            INSERT INTO users (name, email, phone, password_hash, role, created_at, email_verified)
            VALUES (@name, @email, @phone, @password_hash, @role, @created_at, 0)
        `).run({
            name: cleanName,
            email: cleanEmail,
            phone: cleanPhone,
            password_hash: passwordHash,
            role: "customer",
            created_at: createdAt
        });

        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        db.prepare(`
            INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?)
        `).run(result.lastInsertRowid, tokenHash, expiresAt, createdAt);

        const verifyUrl = `${FRONTEND_ORIGIN}/verify-email.html?token=${rawToken}`;

        try {
            await mailTransporter.sendMail({
                from: `"Hiro Store" <${process.env.SMTP_USER}>`,
                to: cleanEmail,
                subject: "Verify your Hiro Store account",
                html: `
                    <p>Hi ${cleanName},</p>
                    <p>Thanks for signing up at Hiro Store. Please verify your email to activate your account:</p>
                    <p><a href="${verifyUrl}">${verifyUrl}</a></p>
                    <p>This link expires in 1 hour.</p>
                    <p>Don't see this email? Check your Spam or Junk folder.</p>
                `
            });
        } catch (mailError) {
            console.error("Verification email failed to send:", mailError);
        }

        console.log(`New customer account created (pending verification): ${cleanEmail}`);

        return res.status(201).json({
            success: true,
            message: "Account created. Please check your email to verify your account before logging in.",
            requiresVerification: true
        });
    } catch (error) {
        console.error("Signup error:", error);
        return res.status(500).json({ success: false, message: "Unable to create account." });
    }
});


/* =========================================================
   VERIFY EMAIL
========================================================= */


app.post("/verify-email", async (req, res) => {
    try {
        const rawToken = String(req.body?.token || "").trim();
        if (!rawToken) return res.status(400).json({ success: false, message: "Missing verification token." });

        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");

        const tokenRecord = db.prepare(`
            SELECT * FROM email_verification_tokens WHERE token_hash = ?
        `).get(tokenHash);

        if (!tokenRecord || tokenRecord.used || new Date(tokenRecord.expires_at) < new Date()) {
            return res.status(400).json({ success: false, message: "This verification link is invalid or has expired." });
        }

        db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).run(tokenRecord.user_id);
        db.prepare(`UPDATE email_verification_tokens SET used = 1 WHERE id = ?`).run(tokenRecord.id);

        return res.json({ success: true, message: "Email verified. You can now log in." });
    } catch (error) {
        console.error("Email verification error:", error);
        return res.status(500).json({ success: false, message: "Unable to verify email." });
    }
});

/* =========================================================
   RESEND VERIFICATION
========================================================= */

app.post("/resend-verification", authLimiter, async (req, res) => {
    try {
        const cleanEmail = String(req.body?.email || "").trim().toLowerCase();
        if (!cleanEmail) return res.status(400).json({ success: false, message: "Email is required." });

        const user = db.prepare(`SELECT id, name, email_verified FROM users WHERE email = ?`).get(cleanEmail);

        // Same response whether the account exists or is already verified �
        // avoids leaking which emails are registered.
        if (!user || user.email_verified) {
            return res.json({ success: true, message: "If that account needs verification, a new email has been sent." });
        }

        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();

        db.prepare(`
            INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, created_at)
            VALUES (?, ?, ?, ?)
        `).run(user.id, tokenHash, expiresAt, new Date().toISOString());

        const verifyUrl = `${FRONTEND_ORIGIN}/verify-email.html?token=${rawToken}`;

        await mailTransporter.sendMail({
            from: `"Hiro Store" <${process.env.SMTP_USER}>`,
            to: cleanEmail,
            subject: "Verify your Hiro Store account",
            html: `<p>Hi ${user.name},</p><p>Here's your new verification link:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>
           <p>This link expires in 1 hour.</p><p>Don't see this email? Check your Spam or Junk folder.</p>`
        });

        return res.json({ success: true, message: "If that account needs verification, a new email has been sent." });
    } catch (error) {
        console.error("Resend verification error:", error);
        return res.status(500).json({ success: false, message: "Unable to resend verification email." });
    }
});

/* =========================================================
   FAILURE ALERT
========================================================= */

function escapeHtmlForEmail(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

async function sendFulfillmentFailureAlert(orderItem, errorMessage, failureStatus = "Failed") {
    try {

        if (
            getSetting(
                "notifications_enabled",
                "1"
            ) !== "1"
        ) {
            return;
        }

        if (
            getSetting(
                "notify_failed_fulfillment",
                "1"
            ) !== "1"
        ) {
            return;
        }

        const notificationEmail =
            String(
                getSetting(
                    "notification_email",
                    process.env.SMTP_USER || ""
                )
            ).trim();

        if (!notificationEmail) {
            logger.warn(
                "Fulfillment alert skipped: no notification email configured."
            );

            return;
        }

        await mailTransporter.sendMail({
            from:
                `"Hiro Store Alerts" <${process.env.SMTP_USER}>`,

            to:
                notificationEmail,

            subject:
                `⚠️ Delivery Failed — Order Item #${orderItem.id}`,

            html: `
                <p>
                    <strong>
                        A diamond delivery just failed and needs attention.
                    </strong>
                </p>

                <ul>
                    <li>
                        Order ID:
                        ${escapeHtmlForEmail(
                orderItem.order_id || "N/A"
            )}
                    </li>

                    <li>
                        Item ID:
                        ${escapeHtmlForEmail(
                String(orderItem.id || "")
            )}
                    </li>

                    <li>
                        Offer ID:
                        ${escapeHtmlForEmail(
                orderItem.offer_id || ""
            )}
                    </li>

                    <li>
                        Player ID:
                        ${escapeHtmlForEmail(
                orderItem.player_id || ""
            )}
                    </li>

                    <li>
                        Server ID:
                        ${escapeHtmlForEmail(
                orderItem.server_id || ""
            )}
                    </li>

                    <li>
                        Error:
                        ${escapeHtmlForEmail(
                errorMessage || "Unknown error"
            )}
                    </li>
                </ul>

                <p>
                    ${failureStatus === "Review Required"
                        ? "FZR did not return a trustworthy final response. Check FZR order history for this player before retrying. Do not submit another delivery until you confirm no supplier order was created."
                        : "FZR returned a definite rejection. Review the error above, correct the cause, then retry if appropriate."}
                </p>
            `
        });

    } catch (mailError) {

        logger.error(
            "Failed to send fulfillment alert email:",
            mailError.message
        );
    }
}

/* =========================================================
   CUSTOMER LOGIN
========================================================= */

app.post("/login", authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;
        const cleanEmail = String(email || "").trim().toLowerCase();
        const cleanPassword = String(password || "");

        if (!cleanEmail || !cleanPassword) return res.status(400).json({ success: false, message: "Email and password are required." });

        const user = db.prepare(`
            SELECT id, name, email, phone, password_hash, role, created_at, email_verified FROM users WHERE email = ?
        `).get(cleanEmail);

        if (!user) return res.status(401).json({ success: false, message: "Invalid email or password." });

        const passwordCorrect = await bcrypt.compare(cleanPassword, user.password_hash);
        if (!passwordCorrect) return res.status(401).json({ success: false, message: "Invalid email or password." });

        if (!user.email_verified) {
            return res.status(403).json({
                success: false,
                message: "Please verify your email before logging in. Check your inbox for the verification link.",
                requiresVerification: true
            });
        }

        // Regenerate the session ID on login to defeat session fixation:
        // any ID an attacker planted before login becomes worthless.
        await new Promise((resolve, reject) => {
            req.session.regenerate((regenerateError) =>
                regenerateError ? reject(regenerateError) : resolve()
            );
        });

        req.session.userId = user.id;
        req.session.userRole = user.role;

        console.log("LOGIN OK:", { userId: user.id, role: user.role });

        req.session.save((sessionError) => {
            if (sessionError) {
                console.error("Could not save login session:", sessionError);
                return res.status(500).json({ success: false, message: "Unable to create login session." });
            }

            console.log(`Customer logged in: ${user.email}`);

            return res.json({
                success: true,
                message: "Login successful.",
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    createdAt: user.created_at
                }
            });
        });
    } catch (error) {
        console.error("Login error:", error);
        return res.status(500).json({ success: false, message: "Unable to log in." });
    }
});

/* =========================================================
   GET CURRENT USER
========================================================= */

app.get("/me", (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ success: false, authenticated: false, message: "Not logged in." });

        const user = db.prepare(`SELECT id, name, email, phone, role, avatar, created_at FROM users WHERE id = ?`).get(req.session.userId);

        if (!user) {
            req.session.destroy(() => { });
            return res.status(401).json({ success: false, authenticated: false, message: "Account no longer exists." });
        }

        return res.json({
            success: true,
            authenticated: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                avatar: user.avatar,
                createdAt: user.created_at
            }
        });
    } catch (error) {
        console.error("Could not get current user:", error);
        return res.status(500).json({ success: false, message: "Unable to check login status." });
    }
});

/* =========================================================
   UPDATE MY PROFILE (name + avatar)
========================================================= */
app.patch("/me", requireLogin, (req, res) => {
    try {
        const name = req.body?.name !== undefined ? String(req.body.name).trim() : null;
        const avatar = req.body?.avatar !== undefined ? String(req.body.avatar).trim() : null;

        const allowedAvatars = ["avatar-1", "avatar-2", "avatar-3", "avatar-4", "avatar-5", "avatar-6", "avatar-7", "avatar-8"];

        if (name !== null && name.length < 2) {
            return res.status(400).json({ success: false, message: "Name must be at least 2 characters." });
        }

        if (avatar !== null && !allowedAvatars.includes(avatar)) {
            return res.status(400).json({ success: false, message: "Invalid avatar selection." });
        }

        if (name !== null) {
            db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run(name, req.session.userId);
        }

        if (avatar !== null) {
            db.prepare(`UPDATE users SET avatar = ? WHERE id = ?`).run(avatar, req.session.userId);
        }

        const user = db.prepare(`SELECT id, name, email, phone, role, avatar, created_at FROM users WHERE id = ?`).get(req.session.userId);

        return res.json({
            success: true,
            user: {
                id: user.id,
                name: user.name,
                email: user.email,
                phone: user.phone,
                role: user.role,
                avatar: user.avatar,
                createdAt: user.created_at
            }
        });
    } catch (error) {
        console.error("Could not update profile:", error);
        return res.status(500).json({ success: false, message: "Unable to update profile." });
    }
});

/* =========================================================
   CUSTOMER LOGOUT
========================================================= */
app.post("/logout", (req, res) => {
    req.session.destroy((error) => {
        if (error) {
            console.error("Logout error:", error);

            return res.status(500).json({
                success: false,
                message: "Unable to log out."
            });
        }

        res.clearCookie("connect.sid");

        return res.json({
            success: true,
            message: "Logged out successfully."
        });
    });
});

/* =========================================================
   REQUIRE LOGIN
========================================================= */

function requireLogin(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, authenticated: false, message: "You must be logged in to access this." });
    }
    next();
}

app.post("/forgot-password", passwordResetLimiter, async (req, res) => {
    try {
        const email = String(
            req.body?.email || ""
        )
            .trim()
            .toLowerCase();

        if (!email) {
            return res.status(400).json({
                success: false,
                message: "Please enter your email address."
            });
        }

        const user = db.prepare(`
            SELECT id, email
            FROM users
            WHERE email = ?
        `).get(email);

        /*
         * IMPORTANT:
         * Do not reveal whether the email exists.
         */
        if (!user) {
            return res.json({
                success: true,
                message:
                    "If an account exists with that email, a password reset link has been sent."
            });
        }

        /*
         * Generate a cryptographically secure token.
         */
        const rawToken =
            crypto.randomBytes(32).toString("hex");

        /*
         * Store only the hash in the database.
         */
        const tokenHash =
            crypto
                .createHash("sha256")
                .update(rawToken)
                .digest("hex");

        /*
         * Token expires after 30 minutes.
         */
        const expiresAt =
            new Date(
                Date.now() + 30 * 60 * 1000
            ).toISOString();

        const createdAt =
            new Date().toISOString();

        /*
         * Remove old unused tokens for this user.
         */
        db.prepare(`
            DELETE FROM password_reset_tokens
            WHERE user_id = ?
        `).run(user.id);

        /*
         * Save new token.
         */
        db.prepare(`
            INSERT INTO password_reset_tokens (
                user_id,
                token_hash,
                expires_at,
                used,
                created_at
            )
            VALUES (?, ?, ?, 0, ?)
        `).run(
            user.id,
            tokenHash,
            expiresAt,
            createdAt
        );

        /*
         * This is the URL the customer will eventually receive.
         */
        const resetUrl =
            `${FRONTEND_ORIGIN}/reset-password.html?token=${rawToken}`;

        try {
            await mailTransporter.sendMail({
                from: `"Hiro Store" <${process.env.SMTP_USER}>`,
                to: user.email,
                subject: "Reset your Hiro Store password",

                text: `Hello ${user.name || ""},

We received a request to reset your Hiro Store password.

Click the link below to create a new password:

${resetUrl}

This link will expire in 30 minutes.

If you did not request a password reset, you can safely ignore this email.

Hiro Store`,

                html: `
            <div style="
                margin:0;
                padding:30px 15px;
                background:#111;
                font-family:Arial,sans-serif;
                color:#fff;
            ">

                <div style="
                    max-width:520px;
                    margin:auto;
                    background:#181818;
                    border:1px solid rgba(255,152,0,.2);
                    border-radius:18px;
                    padding:30px;
                ">

                    <h2 style="
                        margin-top:0;
                        color:#ff9800;
                    ">
                        Reset your Hiro Store password
                    </h2>

                    <p>
                      Hello ${user.name || ""},
                    </p>

                    <p>
                        We received a request to reset your
                        Hiro Store password.
                    </p>

                    <p>
                        Click the button below to create a
                        new password:
                    </p>

                    <p style="text-align:center;margin:30px 0;">
                        <a
                            href="${resetUrl}"
                            style="
                                display:inline-block;
                                padding:14px 24px;
                                background:linear-gradient(
                                    135deg,
                                    #ff9800,
                                    #ff5722
                                );
                                color:#fff;
                                text-decoration:none;
                                border-radius:10px;
                                font-weight:bold;
                            "
                        >
                            Reset Password
                        </a>
                    </p>

                    <p style="color:#aaa;font-size:13px;">
                        This link will expire in 30 minutes.
                    </p>

                    <p style="color:#aaa;font-size:13px;">
                        If you did not request a password reset,
                        you can safely ignore this email.
                    </p>

                    <p style="
                        margin-top:30px;
                        color:#ff9800;
                        font-weight:bold;
                    ">
                        Hiro Store
                    </p>

                </div>
            </div>
        `
            });

            console.log(
                `✅ Password reset email sent to ${user.email}`
            );

            return res.json({
                success: true,
                message:
                    "If an account exists with that email, a password reset link has been sent."
            });

        } catch (error) {

            console.error(
                "❌ Failed to send password reset email:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to send password reset email."
            });
        }

    } catch (error) {
        console.error(
            "Forgot password error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Unable to process your request."
        });
    }
});

app.post("/reset-password", passwordResetLimiter, async (req, res) => {
    try {
        const token = String(
            req.body?.token || ""
        ).trim();

        const newPassword = String(
            req.body?.password || ""
        );

        if (!token) {
            return res.status(400).json({
                success: false,
                message: "Reset token is required."
            });
        }

        if (newPassword.length < 8) {
            return res.status(400).json({
                success: false,
                message:
                    "Password must be at least 8 characters."
            });
        }

        const tokenHash =
            crypto
                .createHash("sha256")
                .update(token)
                .digest("hex");

        const resetRecord = db.prepare(`
            SELECT
                id,
                user_id,
                expires_at,
                used
            FROM password_reset_tokens
            WHERE token_hash = ?
            LIMIT 1
        `).get(tokenHash);

        if (!resetRecord) {
            return res.status(400).json({
                success: false,
                message:
                    "This password reset link is invalid."
            });
        }

        if (resetRecord.used) {
            return res.status(400).json({
                success: false,
                message:
                    "This password reset link has already been used."
            });
        }

        if (
            new Date(resetRecord.expires_at)
                .getTime() < Date.now()
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "This password reset link has expired."
            });
        }

        const passwordHash =
            await bcrypt.hash(
                newPassword,
                12
            );

        const updatePassword =
            db.transaction(() => {

                db.prepare(`
                    UPDATE users
                    SET password_hash = ?
                    WHERE id = ?
                `).run(
                    passwordHash,
                    resetRecord.user_id
                );

                db.prepare(`
                    UPDATE password_reset_tokens
                    SET used = 1
                    WHERE id = ?
                `).run(
                    resetRecord.id
                );
            });

        updatePassword();

        return res.json({
            success: true,
            message:
                "Your password has been reset successfully."
        });

    } catch (error) {
        console.error(
            "Reset password error:",
            error
        );

        return res.status(500).json({
            success: false,
            message:
                "Unable to reset password."
        });
    }
});


/* =========================================================
   REQUIRE ADMIN
========================================================= */
function requireAdmin(req, res, next) {
    // Never log session IDs or raw cookie headers — anyone with log access
    // could replay them as a valid admin session.

    if (!req.session || !req.session.userId) {
        console.log("❌ No userId in session");
        return res.status(401).json({
            success: false,
            authenticated: false,
            message: "You must be logged in."
        });
    }

    const user = db
        .prepare(`SELECT id, role FROM users WHERE id = ?`)
        .get(req.session.userId);

    if (!user) {
        req.session.destroy(() => { });
        return res.status(401).json({
            success: false,
            authenticated: false,
            message: "Account no longer exists."
        });
    }

    if (user.role !== "admin") {
        return res.status(403).json({
            success: false,
            message: "Administrator access required."
        });
    }

    console.log("✅ ADMIN AUTHORIZED");

    req.session.userRole = user.role;
    next();
}

/* =========================================================
   CUSTOMER SUBMIT COMPLAINT
========================================================= */

app.post("/complaints", requireLogin, (req, res) => {
    try {
        const { orderId, message } = req.body;
        const cleanOrderId = String(orderId || "").trim();
        const cleanMessage = String(message || "").trim();

        if (!cleanOrderId) return res.status(400).json({ success: false, message: "Order ID is required." });
        if (!cleanMessage) return res.status(400).json({ success: false, message: "Please describe your complaint." });
        if (cleanMessage.length < 10) return res.status(400).json({ success: false, message: "Please provide more details about the problem." });

        const order = db.prepare(`SELECT order_id, user_id, status FROM orders WHERE order_id = ?`).get(cleanOrderId);
        if (!order) return res.status(404).json({ success: false, message: "Order not found." });

        if (Number(order.user_id) !== Number(req.session.userId)) {
            return res.status(403).json({ success: false, message: "You can only complain about your own orders." });
        }

        const orderItems = db.prepare(`SELECT fulfillment_status FROM order_items WHERE order_id = ?`).all(cleanOrderId);
        const displayStatus = computeOrderDisplayStatus(order, orderItems);

        const allowedStatuses = ["Failed", "Cancelled"];
        if (!allowedStatuses.includes(displayStatus)) {
            return res.status(400).json({ success: false, message: "A complaint can only be submitted for a failed or cancelled order." });
        }

        const currentUser = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.session.userId);
        const now = new Date().toISOString();

        const existingComplaint = db.prepare(`SELECT id, status FROM complaints WHERE user_id = ? AND order_id = ?`).get(req.session.userId, cleanOrderId);

        let complaintId;

        if (existingComplaint) {
            complaintId = existingComplaint.id;

            db.prepare(`UPDATE complaints SET updated_at = ?, status = 'Open' WHERE id = ?`).run(now, complaintId);

            db.prepare(`
                INSERT INTO complaint_messages (complaint_id, sender_role, sender_name, message, created_at)
                VALUES (?, 'customer', ?, ?, ?)
            `).run(complaintId, currentUser?.name || "Customer", cleanMessage, now);

            console.log(`Complaint #${complaintId} continued for ${cleanOrderId}`);

        } else {
            const result = db.prepare(`
                INSERT INTO complaints (user_id, order_id, message, status, admin_response, refund_status, created_at, updated_at)
                VALUES (@user_id, @order_id, @message, @status, @admin_response, @refund_status, @created_at, @updated_at)
            `).run({
                user_id: req.session.userId,
                order_id: cleanOrderId,
                message: cleanMessage,
                status: "Open",
                admin_response: null,
                refund_status: "Not Requested",
                created_at: now,
                updated_at: now
            });

            complaintId = result.lastInsertRowid;

            db.prepare(`
                INSERT INTO complaint_messages (complaint_id, sender_role, sender_name, message, created_at)
                VALUES (?, 'customer', ?, ?, ?)
            `).run(complaintId, currentUser?.name || "Customer", cleanMessage, now);

            console.log(`Complaint created: #${complaintId} for ${cleanOrderId}`);
        }

        return res.status(201).json({
            success: true,
            message: "Complaint submitted successfully.",
            complaintId: complaintId,
            complaint: {
                id: complaintId,
                orderId: cleanOrderId,
                message: cleanMessage,
                status: "Open",
                refundStatus: "Not Requested",
                createdAt: now
            }
        });
    } catch (error) {
        console.error("Complaint submission error:", error);
        return res.status(500).json({ success: false, message: "Unable to submit complaint." });
    }
});

/* =========================================================
   GET CUSTOMER COMPLAINTS
========================================================= */

app.get("/complaints", requireLogin, (req, res) => {
    try {
        const complaints = db.prepare(`
            SELECT id, order_id, message, status, admin_response, refund_status, created_at, updated_at
            FROM complaints WHERE user_id = ? ORDER BY created_at DESC
        `).all(req.session.userId);

        return res.json({
            success: true,
            complaints: complaints.map(complaint => ({
                id: complaint.id,
                orderId: complaint.order_id,
                message: complaint.message,
                status: complaint.status,
                adminResponse: complaint.admin_response,
                refundStatus: complaint.refund_status,
                createdAt: complaint.created_at,
                updatedAt: complaint.updated_at
            }))
        });
    } catch (error) {
        console.error("Could not load customer complaints:", error);
        return res.status(500).json({ success: false, message: "Unable to load complaints." });
    }
});

/* =========================================================
   GET COMPLAINT FOR A SPECIFIC ORDER (customer)
========================================================= */

app.get("/complaints/by-order/:orderId", requireLogin, (req, res) => {
    try {
        const orderId = String(req.params.orderId || "").trim();

        const complaint = db.prepare(`
            SELECT id, order_id, status, refund_status, created_at
            FROM complaints WHERE user_id = ? AND order_id = ?
        `).get(req.session.userId, orderId);

        if (!complaint) {
            return res.json({ success: true, complaint: null });
        }

        return res.json({
            success: true,
            complaint: {
                id: complaint.id,
                orderId: complaint.order_id,
                status: complaint.status,
                refundStatus: complaint.refund_status,
                createdAt: complaint.created_at
            }
        });
    } catch (error) {
        console.error("Could not look up complaint by order:", error);
        return res.status(500).json({ success: false, message: "Unable to look up complaint." });
    }
});

/* =========================================================
   SUPPORT CHAT — GET MY ACTIVE CONVERSATION (customer)
========================================================= */

app.get("/api/support/conversation", requireLogin, (req, res) => {
    try {
        const conversation = db.prepare(`
            SELECT id, order_id, status, refund_status, created_at
            FROM support_conversations
            WHERE user_id = ? AND status = 'Open'
            ORDER BY created_at DESC
            LIMIT 1
        `).get(req.session.userId);

        if (!conversation) {
            return res.json({ success: true, conversation: null, messages: [] });
        }

        const messages = db.prepare(`
            SELECT sender_role, sender_name, message, created_at
            FROM support_messages
            WHERE conversation_id = ?
            ORDER BY created_at ASC
        `).all(conversation.id);

        return res.json({
            success: true,
            conversation: {
                id: conversation.id,
                orderId: conversation.order_id,
                status: conversation.status,
                createdAt: conversation.created_at
            },
            messages
        });
    } catch (error) {
        console.error("Could not load support conversation:", error);
        return res.status(500).json({ success: false, message: "Unable to load conversation." });
    }
});

/* =========================================================
   SUPPORT CHAT — SEND MESSAGE (customer)
========================================================= */

app.post("/api/support/conversation", requireLogin, (req, res) => {
    try {
        const cleanMessage = String(req.body?.message || "").trim();
        const orderId = req.body?.orderId ? String(req.body.orderId).trim() : null;

        if (!cleanMessage) {
            return res.status(400).json({ success: false, message: "Message cannot be empty." });
        }

        const now = new Date().toISOString();
        const currentUser = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.session.userId);

        let conversation = db.prepare(`
            SELECT id FROM support_conversations
            WHERE user_id = ? AND status = 'Open'
            ORDER BY created_at DESC
            LIMIT 1
        `).get(req.session.userId);

        let conversationId;

        if (conversation) {
            conversationId = conversation.id;
            db.prepare(`UPDATE support_conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
        } else {
            const result = db.prepare(`
                INSERT INTO support_conversations (user_id, order_id, status, refund_status, created_at, updated_at)
                VALUES (?, ?, 'Open', 'Not Requested', ?, ?)
            `).run(req.session.userId, orderId, now, now);
            conversationId = result.lastInsertRowid;
        }

        db.prepare(`
            INSERT INTO support_messages (conversation_id, sender_role, sender_name, message, created_at)
            VALUES (?, 'customer', ?, ?, ?)
        `).run(conversationId, currentUser?.name || "Customer", cleanMessage, now);

        return res.status(201).json({
            success: true,
            conversationId
        });
    } catch (error) {
        console.error("Could not send support message:", error);
        return res.status(500).json({ success: false, message: "Unable to send message." });
    }
});

/* =========================================================
   GET MESSAGES FOR A COMPLAINT (customer)
========================================================= */
app.get("/complaints/:id/messages", requireLogin, (req, res) => {
    try {
        const complaintId = Number(req.params.id);

        const complaint = db.prepare(`SELECT id, user_id FROM complaints WHERE id = ?`).get(complaintId);
        if (!complaint) return res.status(404).json({ success: false, message: "Complaint not found." });
        if (Number(complaint.user_id) !== Number(req.session.userId)) {
            return res.status(403).json({ success: false, message: "Not your complaint." });
        }

        const messages = db.prepare(`
            SELECT sender_role, sender_name, message, created_at
            FROM complaint_messages
            WHERE complaint_id = ?
            ORDER BY created_at ASC
        `).all(complaintId);

        return res.json({ success: true, messages });
    } catch (error) {
        console.error("Could not load complaint messages:", error);
        return res.status(500).json({ success: false, message: "Unable to load messages." });
    }
});

/* =========================================================
   SEND MESSAGE AS CUSTOMER
========================================================= */

app.post("/complaints/:id/messages", requireLogin, (req, res) => {
    try {
        const complaintId = Number(req.params.id);
        const cleanMessage = String(req.body?.message || "").trim();

        if (!cleanMessage) return res.status(400).json({ success: false, message: "Message cannot be empty." });

        const complaint = db.prepare(`SELECT id, user_id, status FROM complaints WHERE id = ?`).get(complaintId);
        if (!complaint) return res.status(404).json({ success: false, message: "Complaint not found." });
        if (Number(complaint.user_id) !== Number(req.session.userId)) {
            return res.status(403).json({ success: false, message: "Not your complaint." });
        }

        const currentUser = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.session.userId);
        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO complaint_messages (complaint_id, sender_role, sender_name, message, created_at)
            VALUES (?, 'customer', ?, ?, ?)
        `).run(complaintId, currentUser?.name || "Customer", cleanMessage, now);

        db.prepare(`UPDATE complaints SET updated_at = ? WHERE id = ?`).run(now, complaintId);

        return res.json({ success: true, message: "Message sent." });
    } catch (error) {
        console.error("Could not send complaint message:", error);
        return res.status(500).json({ success: false, message: "Unable to send message." });
    }
});

/* =========================================================
   ADMIN — GET MESSAGES FOR A COMPLAINT
========================================================= */

app.get("/api/admin/complaints/:id/messages", requireAdmin, (req, res) => {
    try {
        const complaintId = Number(req.params.id);

        const messages = db.prepare(`
            SELECT sender_role, sender_name, message, created_at
            FROM complaint_messages
            WHERE complaint_id = ?
            ORDER BY created_at ASC
        `).all(complaintId);

        return res.json({ success: true, messages });
    } catch (error) {
        console.error("Could not load admin complaint messages:", error);
        return res.status(500).json({ success: false, message: "Unable to load messages." });
    }
});

/* =========================================================
   ADMIN — SEND MESSAGE
========================================================= */

app.post("/api/admin/complaints/:id/messages", requireAdmin, (req, res) => {
    try {
        const complaintId = Number(req.params.id);
        const cleanMessage = String(req.body?.message || "").trim();

        if (!cleanMessage) return res.status(400).json({ success: false, message: "Message cannot be empty." });

        const complaint = db.prepare(`SELECT id FROM complaints WHERE id = ?`).get(complaintId);
        if (!complaint) return res.status(404).json({ success: false, message: "Complaint not found." });

        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO complaint_messages (complaint_id, sender_role, sender_name, message, created_at)
            VALUES (?, 'admin', 'Hiro Store Support', ?, ?)
        `).run(complaintId, cleanMessage, now);

        db.prepare(`UPDATE complaints SET updated_at = ? WHERE id = ?`).run(now, complaintId);

        return res.json({ success: true, message: "Message sent." });
    } catch (error) {
        console.error("Could not send admin complaint message:", error);
        return res.status(500).json({ success: false, message: "Unable to send message." });
    }
});

/* =========================================================
   ADMIN — GET ALL COMPLAINTS
========================================================= */

app.get("/api/admin/complaints", requireAdmin, (req, res) => {
    try {
        const complaints = db.prepare(`
            SELECT
                c.id, c.order_id, c.message, c.status,
                c.admin_response, c.refund_status,
                c.created_at, c.updated_at,
                u.email AS customer_email
            FROM complaints c
            LEFT JOIN users u ON c.user_id = u.id
            ORDER BY c.created_at DESC
        `).all();

        return res.json({
            success: true,
            complaints: complaints.map(c => ({
                id: c.id,
                orderId: c.order_id,
                customerEmail: c.customer_email,
                message: c.message,
                status: c.status,
                adminResponse: c.admin_response,
                refundStatus: c.refund_status,
                createdAt: c.created_at,
                updatedAt: c.updated_at
            }))
        });
    } catch (error) {
        console.error("Could not load admin complaints:", error);
        return res.status(500).json({ success: false, message: "Unable to load complaints." });
    }
});

/* =========================================================
   ADMIN — RESPOND TO / UPDATE A COMPLAINT
========================================================= */

app.patch("/api/admin/complaints/:id", requireAdmin, (req, res) => {
    try {
        const complaintId = Number(req.params.id);
        const status = String(req.body?.status || "").trim();
        const adminResponse = String(req.body?.adminResponse || "").trim();
        const refundStatus = String(req.body?.refundStatus || "").trim();

        const allowedStatuses = ["Open", "Resolved", "Rejected"];
        const allowedRefundStatuses = ["Not Requested", "Pending", "Refunded", "Denied"];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid complaint status." });
        }
        if (!allowedRefundStatuses.includes(refundStatus)) {
            return res.status(400).json({ success: false, message: "Invalid refund status." });
        }

        const existing = db.prepare(`SELECT id FROM complaints WHERE id = ?`).get(complaintId);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Complaint not found." });
        }

        const now = new Date().toISOString();

        db.prepare(`
            UPDATE complaints
            SET status = ?, admin_response = ?, refund_status = ?, updated_at = ?
            WHERE id = ?
        `).run(status, adminResponse || null, refundStatus, now, complaintId);

        console.log(`Complaint #${complaintId} updated by admin: ${status}`);

        return res.json({ success: true, message: "Complaint updated." });
    } catch (error) {
        console.error("Could not update complaint:", error);
        return res.status(500).json({ success: false, message: "Unable to update complaint." });
    }
});

/* =========================================================
   ADMIN — SUPPORT CHAT: LIST CONVERSATIONS
========================================================= */

app.get("/api/admin/support/conversations", requireAdmin, (req, res) => {
    try {
        const conversations = db.prepare(`
            SELECT
                sc.id, sc.user_id, sc.order_id, sc.status, sc.refund_status, sc.created_at, sc.updated_at,
                u.name AS customer_name, u.email AS customer_email,
                (SELECT message FROM support_messages WHERE conversation_id = sc.id ORDER BY created_at DESC LIMIT 1) AS last_message
            FROM support_conversations sc
            INNER JOIN users u ON u.id = sc.user_id
            ORDER BY sc.updated_at DESC
        `).all();

        return res.json({
            success: true,
            conversations: conversations.map(c => ({
                id: c.id,
                userId: c.user_id,
                orderId: c.order_id,
                status: c.status,
                refundStatus: c.refund_status,
                customerName: c.customer_name,
                customerEmail: c.customer_email,
                lastMessage: c.last_message,
                createdAt: c.created_at,
                updatedAt: c.updated_at
            }))
        });
    } catch (error) {
        console.error("Could not load support conversations:", error);
        return res.status(500).json({ success: false, message: "Unable to load conversations." });
    }
});

/* =========================================================
   ADMIN — SUPPORT CHAT: GET MESSAGES FOR A CONVERSATION
========================================================= */

app.get("/api/admin/support/conversations/:id/messages", requireAdmin, (req, res) => {
    try {
        const conversationId = Number(req.params.id);

        const messages = db.prepare(`
            SELECT sender_role, sender_name, message, created_at
            FROM support_messages
            WHERE conversation_id = ?
            ORDER BY created_at ASC
        `).all(conversationId);

        return res.json({ success: true, messages });
    } catch (error) {
        console.error("Could not load conversation messages:", error);
        return res.status(500).json({ success: false, message: "Unable to load messages." });
    }
});

/* =========================================================
   ADMIN — SUPPORT CHAT: SEND REPLY
========================================================= */

app.post("/api/admin/support/conversations/:id/messages", requireAdmin, (req, res) => {
    try {
        const conversationId = Number(req.params.id);
        const cleanMessage = String(req.body?.message || "").trim();

        if (!cleanMessage) {
            return res.status(400).json({ success: false, message: "Message cannot be empty." });
        }

        const conversation = db.prepare(`SELECT id FROM support_conversations WHERE id = ?`).get(conversationId);
        if (!conversation) {
            return res.status(404).json({ success: false, message: "Conversation not found." });
        }

        const now = new Date().toISOString();

        db.prepare(`
            INSERT INTO support_messages (conversation_id, sender_role, sender_name, message, created_at)
            VALUES (?, 'admin', 'Hiro Store Support', ?, ?)
        `).run(conversationId, cleanMessage, now);

        db.prepare(`UPDATE support_conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);

        return res.json({ success: true, message: "Reply sent." });
    } catch (error) {
        console.error("Could not send admin reply:", error);
        return res.status(500).json({ success: false, message: "Unable to send reply." });
    }
});

/* =========================================================
   ADMIN — SUPPORT CHAT: RESOLVE CONVERSATION
========================================================= */

app.patch("/api/admin/support/conversations/:id", requireAdmin, (req, res) => {
    try {
        const conversationId = Number(req.params.id);
        const status = String(req.body?.status || "").trim();
        const allowedStatuses = ["Open", "Resolved"];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({ success: false, message: "Invalid status." });
        }

        const existing = db.prepare(`SELECT id FROM support_conversations WHERE id = ?`).get(conversationId);
        if (!existing) {
            return res.status(404).json({ success: false, message: "Conversation not found." });
        }

        const now = new Date().toISOString();
        db.prepare(`UPDATE support_conversations SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, conversationId);

        return res.json({ success: true, message: "Conversation updated." });
    } catch (error) {
        console.error("Could not update conversation:", error);
        return res.status(500).json({ success: false, message: "Unable to update conversation." });
    }
});

/* =========================================================
   HOME
========================================================= */
app.get("/api/health", (req, res) => {
    res.json({ success: true, message: "Hiro Store payment server is running." });
});

/* =========================================================
   PUBLIC PAYSTACK CONFIG
========================================================= */

app.get("/api/config/paystack", (req, res) => {
    return res.status(410).json({
        success: false,
        message: "This checkout client is outdated. Refresh Hiro Store before paying."
    });
});

/*========================================================
   STORE ANNOUNCEMENT
========================================================= */
app.get("/api/store/public-settings", (req, res) => {
    try {
        return res.json({
            success: true,

            announcement:
                getSetting(
                    "store_announcement",
                    ""
                ),

            paymentsEnabled:
                getSetting(
                    "payments_enabled",
                    "1"
                ) === "1"
        });

    } catch (error) {
        logger.error(
            "Public store settings error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            announcement: "",
            paymentsEnabled: true
        });
    }
});

/* =========================================================
   CREATE PENDING ORDER BEFORE PAYSTACK
========================================================= */

app.post(
    "/api/checkout/create",
    paymentLimiter,
    requireLogin,
    async (req, res) => {

        if (getSetting("maintenance_mode", "0") === "1") {
            return res.status(503).json({
                success: false,
                message:
                    "The store is temporarily closed for maintenance."
            });
        }

        if (
            getSetting(
                "payments_enabled",
                "1"
            ) !== "1"
        ) {
            return res.status(503).json({
                success: false,
                message:
                    "Payments are temporarily unavailable. Please try again later."
            });
        }

        try {
            const {
                email: suppliedEmail,
                phone: suppliedPhone,
                items = []
            } = req.body;

            const rawItems =
                Array.isArray(items)
                    ? items
                    : [];

            if (!rawItems.length) {
                return res.status(400).json({
                    success: false,
                    message: "Your cart is empty."
                });
            }

            /* ---------------------------------------------
               CURRENT USER
            --------------------------------------------- */

            const user = db.prepare(`
                SELECT
                    id,
                    email,
                    phone
                FROM users
                WHERE id = ?
            `).get(req.session.userId);

            if (!user) {
                return res.status(401).json({
                    success: false,
                    message: "User account not found."
                });
            }

            const email = String(
                suppliedEmail ||
                user.email ||
                ""
            )
                .trim()
                .toLowerCase();

            const phone = String(
                suppliedPhone ||
                user.phone ||
                ""
            ).trim();

            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: "Email is required."
                });
            }

            /* ---------------------------------------------
               LOAD PRODUCTS FROM DATABASE
               NEVER TRUST PRICE FROM BROWSER
            --------------------------------------------- */

            const getProduct = db.prepare(`
                SELECT
                    category_id,
                    offer_id,
                    title,
                    retail_price_ngn,
                    supplier_price_usd,
                    available
                FROM products
                WHERE offer_id = ?
                  AND category_id = ?
                LIMIT 1
            `);

            const getProductAnyCategory = db.prepare(`
                SELECT
                    category_id,
                    offer_id,
                    title,
                    retail_price_ngn,
                    supplier_price_usd,
                    available
                FROM products
                WHERE offer_id = ?
                LIMIT 1
            `);

            const cleanItems = rawItems
                .map(item => {

                    const offerId = String(
                        item?.offerId || ""
                    ).trim();

                    const requestedCategoryId = String(
                        item?.categoryId || ""
                    ).trim();

                    const playerId = String(
                        item?.playerId || ""
                    ).trim();

                    const serverId = String(
                        item?.serverId || ""
                    ).trim();

                    const qty =
                        Number(item?.qty ?? 1);

                    const maxQuantity =
                        Number(
                            getSetting(
                                "max_quantity",
                                "20"
                            )
                        );

                    if (
                        !Number.isInteger(qty) ||
                        qty < 1 ||
                        !Number.isInteger(maxQuantity) ||
                        maxQuantity < 1 ||
                        qty > maxQuantity
                    ) {
                        return null;
                    }

                    if (
                        !offerId ||
                        !playerId ||
                        !serverId
                    ) {
                        return null;
                    }

                    const product =
                        requestedCategoryId
                            ? getProduct.get(
                                offerId,
                                requestedCategoryId
                            )
                            : getProductAnyCategory.get(
                                offerId
                            );

                    if (
                        !product ||
                        !product.available
                    ) {
                        return null;
                    }

                    const price = Math.round(
                        Number(
                            product.retail_price_ngn ||
                            0
                        )
                    );

                    if (price <= 0) {
                        return null;
                    }

                    return {
                        offerId:
                            product.offer_id,

                        categoryId:
                            product.category_id,

                        title:
                            product.title,

                        price,

                        qty,

                        playerId,

                        serverId,

                        supplierPriceUsd:
                            Number(
                                product.supplier_price_usd ||
                                0
                            )
                    };
                })
                .filter(Boolean);

            if (
                cleanItems.length !==
                rawItems.length
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "One or more cart items are invalid or unavailable."
                });
            }

            /* ---------------------------------------------
               SERVER-SIDE TOTAL
            --------------------------------------------- */

            const orderTotal =
                cleanItems.reduce(
                    (sum, item) =>
                        sum +
                        item.price *
                        item.qty,
                    0
                );

            if (orderTotal <= 0) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Invalid order total."
                });
            }

            /* ---------------------------------------------
               IDS / REFERENCE
            --------------------------------------------- */

            const datePart =
                new Date()
                    .toISOString()
                    .slice(0, 10)
                    .replace(/-/g, "");

            const orderRandom =
                crypto
                    .randomBytes(4)
                    .toString("hex")
                    .toUpperCase();

            const referenceRandom =
                crypto
                    .randomBytes(8)
                    .toString("hex")
                    .toUpperCase();

            const orderId =
                `HIRO-${datePart}-${orderRandom}`;

            const reference =
                `HIRO-PAY-${Date.now()}-${referenceRandom}`;

            const createdAt =
                new Date().toISOString();

            /* ---------------------------------------------
               SAVE ORDER + ITEMS ATOMICALLY
            --------------------------------------------- */

            const createOrder =
                db.transaction(() => {

                    db.prepare(`
                        INSERT INTO orders (
                            order_id,
                            reference,
                            user_id,
                            email,
                            phone,
                            amount,
                            order_total,
                            amount_charged,
                            currency,
                            status,
                            paid_at,
                            created_at
                        )
                        VALUES (
                            @order_id,
                            @reference,
                            @user_id,
                            @email,
                            @phone,
                            @amount,
                            @order_total,
                            0,
                            'NGN',
                            'Pending',
                            NULL,
                            @created_at
                        )
                    `).run({
                        order_id:
                            orderId,

                        reference,

                        user_id:
                            user.id,

                        email,

                        phone,

                        // Kept in kobo to match your
                        // existing orders.amount usage.
                        amount:
                            orderTotal * 100,

                        order_total:
                            orderTotal,

                        created_at:
                            createdAt
                    });

                    const insertItem =
                        db.prepare(`
                            INSERT INTO order_items (
                                order_id,
                                offer_id,
                                category_id,
                                title,
                                price,
                                quantity,
                                supplier_price_usd,
                                supplier_cost_ngn,
                                player_id,
                                server_id,
                                player_name,
                                player_region
                            )
                            VALUES (
                                @order_id,
                                @offer_id,
                                @category_id,
                                @title,
                                @price,
                                1,
                                @supplier_price_usd,
                                @supplier_cost_ngn,
                                @player_id,
                                @server_id,
                                '',
                                ''
                            )
                        `);

                    for (
                        const item
                        of cleanItems
                    ) {

                        const supplierCostNgn =
                            Math.round(
                                item.supplierPriceUsd *
                                Number(
                                    getSetting(
                                        "usd_ngn_rate",
                                        FZR_EXCHANGE_RATE
                                    )
                                )
                            );

                        /*
                         * One DB row per unit.
                         * This preserves your current
                         * qty 2+ fulfillment protection.
                         */
                        for (
                            let unit = 0;
                            unit < item.qty;
                            unit++
                        ) {

                            insertItem.run({
                                order_id:
                                    orderId,

                                offer_id:
                                    item.offerId,

                                category_id:
                                    item.categoryId,

                                title:
                                    item.title,

                                price:
                                    item.price,

                                supplier_price_usd:
                                    item.supplierPriceUsd,

                                supplier_cost_ngn:
                                    supplierCostNgn,

                                player_id:
                                    item.playerId,

                                server_id:
                                    item.serverId
                            });
                        }
                    }
                });

            createOrder();

            /* ---------------------------------------------
               INITIALIZE PAYSTACK ON THE SERVER

               This is the critical protection against stale
               browser code creating standalone T... references.
               Paystack receives the exact HIRO-PAY reference
               that already exists in our database.
            --------------------------------------------- */

            const paystackInitializeResponse =
                await fetch(
                    "https://api.paystack.co/transaction/initialize",
                    {
                        method: "POST",

                        headers: {
                            Authorization:
                                `Bearer ${PAYSTACK_SECRET_KEY}`,

                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            email,

                            amount:
                                String(orderTotal * 100),

                            currency:
                                "NGN",

                            reference,

                            metadata:
                                JSON.stringify({
                                    order_id:
                                        orderId,

                                    phone,

                                    player_id:
                                        cleanItems[0]?.playerId ||
                                        "",

                                    server_id:
                                        cleanItems[0]?.serverId ||
                                        ""
                                })
                        })
                    }
                );

            const paystackInitializeData =
                await paystackInitializeResponse.json();

            if (
                !paystackInitializeResponse.ok ||
                !paystackInitializeData.status ||
                !paystackInitializeData.data?.access_code
            ) {
                console.error(
                    "PAYSTACK INITIALIZE ERROR:",
                    paystackInitializeData
                );

                return res.status(502).json({
                    success: false,
                    message:
                        "Unable to start payment right now. Please try again."
                });
            }

            /*
             * Paystack should echo the reference we supplied.
             * Refuse to continue if it ever differs.
             */
            if (
                String(
                    paystackInitializeData.data.reference ||
                    ""
                ) !== reference
            ) {
                console.error(
                    "PAYSTACK REFERENCE MISMATCH:",
                    {
                        expected: reference,
                        received:
                            paystackInitializeData.data.reference
                    }
                );

                return res.status(502).json({
                    success: false,
                    message:
                        "Payment initialization failed safely. Please try again."
                });
            }

            return res.status(201).json({
                success: true,

                accessCode:
                    paystackInitializeData.data.access_code,

                order: {
                    orderId,
                    reference,
                    orderTotal,
                    amountKobo:
                        orderTotal * 100,

                    currency:
                        "NGN"
                }
            });

        } catch (error) {

            console.error(
                "CREATE PENDING ORDER ERROR:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to prepare checkout."
            });
        }
    }
);

/* =========================================================
   STORE STATUS
========================================================= */

app.get("/api/store-status", (req, res) => {
    res.json({
        success: true,
        maintenanceMode: getSetting("maintenance_mode", "0") === "1"
    });
});

/* =========================================================
   PUBLIC FZR PRODUCTS (SINGLE ENDPOINT - RETURNS FROM DB)
========================================================= */

app.get("/api/products", (req, res) => {
    try {
        const allowedCategories = ["mobile_legends_global", "mobile_legends_philippines"];
        const requestedCategory = String(req.query.category || "mobile_legends_global");
        const category = allowedCategories.includes(requestedCategory) ? requestedCategory : "mobile_legends_global";

        const products = db.prepare(`
            SELECT
                id,
                category_id AS categoryId,
                offer_id AS offerId,
                title,
                retail_price_usd AS retailPriceUsd,
                retail_price_ngn AS retailPriceNgn,
                available,
                created_at AS createdAt,
                updated_at AS updatedAt
            FROM products
            WHERE category_id = ?
            ORDER BY id ASC
        `).all(category);

        return res.json({
            success: true,
            products: products
        });
    } catch (error) {
        console.error("Could not load public FZR products:", error);
        return res.status(500).json({ success: false, message: "Unable to load products." });
    }
});

/* =========================================================
   VERIFY PAYMENT
========================================================= */

app.post("/verify-payment", paymentLimiter, async (req, res) => {
    if (getSetting("maintenance_mode", "0") === "1") {
        return res.status(503).json({
            success: false,
            message:
                "The store is temporarily closed for maintenance. Please check back soon."
        });
    }

    try {
        const {
            reference
        } = req.body;

        const cleanReference =
            String(reference || "")
                .trim();

        if (!cleanReference) {
            return res.status(400).json({
                success: false,
                message:
                    "No payment reference supplied."
            });
        }

        /* ---------------------------------------------------------
           FIND THE PRE-CREATED ORDER
        --------------------------------------------------------- */

        const order = db.prepare(`
            SELECT *
            FROM orders
            WHERE reference = ?
        `).get(cleanReference);

        if (!order) {
            console.error(
                "VERIFY PAYMENT: Order not found:",
                cleanReference
            );

            return res.status(404).json({
                success: false,
                message:
                    "Order could not be found."
            });
        }

        /* ---------------------------------------------------------
           VERIFY DIRECTLY WITH PAYSTACK
        --------------------------------------------------------- */

        const response =
            await axios.get(
                `https://api.paystack.co/transaction/verify/${encodeURIComponent(cleanReference)}`,
                {
                    headers: {
                        Authorization:
                            `Bearer ${PAYSTACK_SECRET_KEY}`,

                        "Content-Type":
                            "application/json"
                    },

                    timeout:
                        15000
                }
            );

        const payment =
            response.data?.data;

        if (!payment) {
            return res.status(502).json({
                success: false,
                message:
                    "Paystack did not return transaction information."
            });
        }

        /* ---------------------------------------------------------
           REFERENCE MUST MATCH
        --------------------------------------------------------- */

        if (
            String(
                payment.reference || ""
            ).trim() !== cleanReference
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Payment reference mismatch."
            });
        }

        /* ---------------------------------------------------------
           PAYMENT MUST BE SUCCESSFUL
        --------------------------------------------------------- */

        if (payment.status !== "success") {
            return res.status(400).json({
                success: false,
                message:
                    "Payment was not successful.",

                payment: {
                    reference:
                        payment.reference,

                    status:
                        payment.status,

                    amount:
                        payment.amount,

                    currency:
                        payment.currency
                }
            });
        }

        if (order.status === "Refunded") {
            return res.status(409).json({
                success: false,
                message:
                    "This order has already been marked Refunded and cannot be reactivated by payment verification."
            });
        }

        /* ---------------------------------------------------------
           CHECK CURRENCY
        --------------------------------------------------------- */

        const paymentCurrency =
            String(
                payment.currency ||
                ""
            ).toUpperCase();

        const orderCurrency =
            String(
                order.currency ||
                "NGN"
            ).toUpperCase();

        if (
            paymentCurrency !==
            orderCurrency
        ) {
            console.error(
                "VERIFY PAYMENT: Currency mismatch",
                {
                    reference:
                        cleanReference,

                    expected:
                        orderCurrency,

                    received:
                        paymentCurrency
                }
            );

            return res.status(400).json({
                success: false,
                message:
                    "Payment currency does not match order."
            });
        }

        /* ---------------------------------------------------------
           CHECK AMOUNT
        --------------------------------------------------------- */

        const amountChargedKobo =
            Number(payment.amount);

        const expectedAmountKobo =
            Math.round(
                Number(
                    order.order_total
                ) * 100
            );

        if (
            !Number.isFinite(
                amountChargedKobo
            ) ||
            !Number.isFinite(
                expectedAmountKobo
            )
        ) {
            return res.status(400).json({
                success: false,
                message:
                    "Invalid payment amount."
            });
        }

        if (
            amountChargedKobo !==
            expectedAmountKobo
        ) {
            console.error(
                "VERIFY PAYMENT: Amount mismatch",
                {
                    reference:
                        cleanReference,

                    expected:
                        expectedAmountKobo,

                    received:
                        amountChargedKobo
                }
            );

            return res.status(400).json({
                success: false,
                message:
                    "Payment amount does not match order total."
            });
        }

        /* ---------------------------------------------------------
           MARK PAID IF NOT ALREADY PAID
        --------------------------------------------------------- */

        const paidAt =
            payment.paid_at ||
            payment.transaction_date ||
            new Date().toISOString();

        const paymentUpdate =
            db.prepare(`
                UPDATE orders
                SET
                    status = 'Paid',
                    amount_charged = ?,
                    paid_at = ?
                WHERE reference = ?
                  AND status NOT IN ('Paid', 'Refunded')
            `).run(
                amountChargedKobo,
                paidAt,
                cleanReference
            );

        finance.recordFee(cleanReference, payment, "verify");

        if (
            paymentUpdate.changes === 1
        ) {
            console.log(
                `Order ${order.order_id} marked Paid by verification`
            );
        } else {
            console.log(
                `Order ${order.order_id} was already marked Paid`
            );
        }

        /* ---------------------------------------------------------
           GET PENDING ITEMS

           Even if another request already marked the order Paid,
           we still check for Pending items.

           Each item is claimed atomically below, so webhook +
           browser verification cannot fulfill the same item twice.
        --------------------------------------------------------- */

        const pendingOrderItems =
            db.prepare(`
                SELECT
                    id,
                    offer_id,
                    category_id,
                    player_id,
                    server_id,
                    fulfillment_status,
                    fzr_order_id
                FROM order_items
                WHERE order_id = ?
                  AND fulfillment_status = 'Pending'
                ORDER BY id ASC
            `).all(
                order.order_id
            );

        const fulfillmentResults = [];

        const autoFulfillmentEnabled =
            getSetting(
                "auto_fulfillment_enabled",
                "1"
            ) === "1";

        if (!autoFulfillmentEnabled) {
            logger.info(
                `Auto fulfillment disabled; order ${order.order_id} verified and left Pending for manual fulfillment.`
            );

            const savedItems = db.prepare(`
        SELECT
            id,
            offer_id,
            category_id,
            title,
            price,
            quantity,
            player_id,
            server_id,
            fulfillment_status,
            fzr_order_id
        FROM order_items
        WHERE order_id = ?
        ORDER BY id ASC
    `).all(
                order.order_id
            );

            return res.json({
                success: true,

                message:
                    "Payment verified. Automatic fulfillment is disabled.",

                order: {
                    orderId:
                        order.order_id,

                    reference:
                        cleanReference,

                    status:
                        "Paid",

                    orderTotal:
                        Number(
                            order.order_total ||
                            0
                        ),

                    amountCharged:
                        amountChargedKobo /
                        100,

                    currency:
                        orderCurrency,

                    items:
                        savedItems
                }
            });
        }

        /* ---------------------------------------------------------
           FZR FULFILLMENT
        --------------------------------------------------------- */

        for (
            const orderItem
            of pendingOrderItems
        ) {

            /*
             * Only one request can change
             * Pending -> Processing.
             */
            const claim =
                db.prepare(`
                    UPDATE order_items
                    SET fulfillment_status = 'Processing'
                    WHERE id = ?
                      AND fulfillment_status = 'Pending'
                `).run(
                    orderItem.id
                );

            if (
                claim.changes !== 1
            ) {
                console.log(
                    "FZR item already claimed:",
                    orderItem.id
                );

                continue;
            }

            try {
                const fzrResult =
                    await createFzrTopup({
                        offerId:
                            orderItem.offer_id,

                        categoryId:
                            orderItem.category_id,

                        playerId:
                            orderItem.player_id,

                        serverId:
                            orderItem.server_id
                    });

                const fzrOrderId =
                    fzrResult?.order?.id ||
                    null;

                const fzrStatus =
                    fzrResult?.order?.status ||
                    "created";

                const fulfillmentStatus =
                    mapFzrStatusToFulfillmentStatus(fzrStatus);

                db.prepare(`
                    UPDATE order_items
                    SET
                        fulfillment_status = ?,
                        fzr_order_id = ?
                    WHERE id = ?
                `).run(
                    fulfillmentStatus,
                    fzrOrderId,
                    orderItem.id
                );

                fulfillmentResults.push({
                    itemId:
                        orderItem.id,

                    offerId:
                        orderItem.offer_id,

                    categoryId:
                        orderItem.category_id,

                    success:
                        true,

                    fzrOrderId,

                    status:
                        fzrStatus
                });

            } catch (fzrError) {

                console.error(
                    "FZR FULFILLMENT FAILED:",
                    fzrError.message
                );

                const failure = fzrFailureDetails(fzrError);

                db.prepare(`
                    UPDATE order_items
                    SET fulfillment_status = ?, fulfillment_error = ?
                    WHERE id = ?
                `).run(failure.status, failure.message, orderItem.id);

                sendFulfillmentFailureAlert(orderItem, failure.message, failure.status);

                fulfillmentResults.push({
                    itemId:
                        orderItem.id,

                    offerId:
                        orderItem.offer_id,

                    categoryId:
                        orderItem.category_id,

                    success:
                        false,

                    error:
                        fzrError.message
                });
            }
        }

        /* ---------------------------------------------------------
           LOAD ORDER ITEMS FOR RESPONSE
        --------------------------------------------------------- */

        const savedItems =
            db.prepare(`
                SELECT
                    id,
                    offer_id,
                    category_id,
                    title,
                    price,
                    quantity,
                    player_id,
                    server_id,
                    player_name,
                    player_region,
                    supplier_price_usd,
                    fulfillment_status,
                    fzr_order_id
                FROM order_items
                WHERE order_id = ?
                ORDER BY id ASC
            `).all(
                order.order_id
            );

        /* ---------------------------------------------------------
           RESPONSE
        --------------------------------------------------------- */

        return res.json({
            success: true,

            alreadyVerified:
                paymentUpdate.changes === 0,

            message:
                "Payment verified successfully.",

            payment: {
                reference:
                    payment.reference,

                status:
                    payment.status,

                amount:
                    amountChargedKobo /
                    100,

                amountKobo:
                    amountChargedKobo,

                currency:
                    paymentCurrency,

                paidAt
            },

            order: {
                orderId:
                    order.order_id,

                reference:
                    cleanReference,

                status:
                    "Paid",

                orderTotal:
                    Number(
                        order.order_total ||
                        0
                    ),

                amountCharged:
                    amountChargedKobo /
                    100,

                currency:
                    orderCurrency,

                items:
                    savedItems.map(
                        item => ({
                            id:
                                item.id,

                            offerId:
                                item.offer_id,

                            categoryId:
                                item.category_id,

                            title:
                                item.title,

                            price:
                                Number(
                                    item.price ||
                                    0
                                ),

                            qty:
                                Number(
                                    item.quantity ||
                                    1
                                ),

                            playerId:
                                item.player_id ||
                                "",

                            serverId:
                                item.server_id ||
                                "",

                            fulfillmentStatus:
                                item.fulfillment_status,

                            fzrOrderId:
                                item.fzr_order_id ||
                                null
                        })
                    ),

                fulfillment:
                    fulfillmentResults
            }
        });

    } catch (error) {

        console.error(
            "PAYSTACK VERIFICATION ERROR:",
            error.message
        );

        if (error.response) {
            console.error(
                "Paystack HTTP status:",
                error.response.status
            );
        }

        return res.status(
            error.response?.status ===
                404
                ? 404
                : 500
        ).json({
            success: false,
            message:
                "Unable to verify payment at this time."
        });
    }
});

function computeOrderDisplayStatus(order, items) {
    const orderStatus = order.status || "Pending";

    // Admin-set terminal states always win — never overridden by
    // per-item fulfillment tracking, which only reflects FZR delivery,
    // not refunds/cancellations/manual completion decided by admin.
    const adminOverrideStatuses = ["Completed", "Refunded", "Cancelled"];
    if (adminOverrideStatuses.includes(orderStatus)) {
        return orderStatus;
    }

    const fulfillmentStatuses = items.map(
        item => String(item.fulfillment_status || "Pending")
    );

    let displayStatus = orderStatus;

    if (fulfillmentStatuses.length) {
        if (fulfillmentStatuses.some(status => status === "Review Required")) {
            displayStatus = "Review Required";
        } else if (fulfillmentStatuses.some(status => status === "Failed")) {
            displayStatus = "Failed";
        } else if (
            fulfillmentStatuses.every(status => status === "Completed")
        ) {
            displayStatus = "Completed";
        } else if (
            fulfillmentStatuses.some(status => status === "Processing")
        ) {
            displayStatus = "Processing";
        } else {
            displayStatus = "Pending";
        }
    }

    return displayStatus;
}
/* =========================================================
   GET ORDER HISTORY
========================================================= */

app.get("/orders", requireLogin, (req, res) => {
    try {
        const currentUser = db.prepare(`SELECT email FROM users WHERE id = ?`).get(req.session.userId);
        if (!currentUser) return res.status(401).json({ success: false, message: "User account not found." });

        const orders = db.prepare(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC`).all(req.session.userId);
        const getItems = db.prepare(`
            SELECT
                id,
                title,
                price,
                quantity,
                player_id,
                server_id,
                fulfillment_status
            FROM order_items
            WHERE order_id = ?
            ORDER BY id ASC
        `);

        const result = orders.map(order => {
            const items = getItems.all(order.order_id);
            let orderTotal = Number(order.order_total || 0);
            const displayStatus =
                computeOrderDisplayStatus(
                    order,
                    items
                );

            if (orderTotal === 0 && items.length) {
                orderTotal = items.reduce((sum, item) => sum + (Number(item.price || 0) * Number(item.quantity || 1)), 0);
            }

            const amountChargedKobo =
                Number(
                    order.amount_charged ??
                    0
                );

            return {
                orderId: order.order_id,
                reference: order.reference,
                email: order.email,
                phone: order.phone,
                amount: amountChargedKobo / 100,
                orderTotal: orderTotal,
                amountCharged: amountChargedKobo / 100,
                currency: order.currency,
                status: displayStatus,
                paymentStatus: order.status,
                paidAt: order.paid_at,
                createdAt: order.created_at,
                items: items.map(item => ({
                    title: item.title,
                    price: item.price,
                    qty: item.quantity,
                    playerId: item.player_id,
                    serverId: item.server_id,
                    fulfillmentStatus:
                        order.status === "Refunded"
                            ? "Refunded"
                            : order.status === "Cancelled"
                                ? "Cancelled"
                                : item.fulfillment_status || "Pending"
                }))
            };
        });

        return res.json({ success: true, orders: result });
    } catch (error) {
        console.error("Could not load orders:", error);
        return res.status(500).json({ success: false, message: "Unable to load order history." });
    }
});


/* =========================================================
   ADMIN — GET ALL ORDERS
========================================================= */

app.get("/api/admin/orders", requireAdmin, (req, res) => {
    try {
        const orders = db.prepare(`
            SELECT
                o.*,
                u.name AS customer_name,
                u.email AS customer_email,
                u.phone AS customer_phone
            FROM orders o
            LEFT JOIN users u ON o.user_id = u.id
            ORDER BY o.created_at DESC
        `).all();

        const getItems = db.prepare(`
            SELECT
                id,
                title,
                price,
                quantity,
                supplier_price_usd,
                player_id,
                server_id,
                fulfillment_status,
                fulfillment_error,
                fzr_order_id
            FROM order_items
            WHERE order_id = ?
            ORDER BY id ASC
        `);

        const result = orders.map(order => {
            const items = getItems.all(order.order_id);

            let orderTotal = Number(order.order_total || 0);

            if (orderTotal === 0 && items.length) {
                orderTotal = items.reduce(
                    (sum, item) =>
                        sum +
                        (Number(item.price || 0) *
                            Number(item.quantity || 1)),
                    0
                );
            }

            const amountChargedKobo =
                Number(
                    order.amount_charged ??
                    0
                );

            return {
                orderId: order.order_id,
                reference: order.reference,

                userId: order.user_id,

                customer: {
                    name: order.customer_name || "",
                    email: order.customer_email || order.email || "",
                    phone: order.customer_phone || order.phone || ""
                },

                email: order.email,
                phone: order.phone,

                amount: amountChargedKobo / 100,
                orderTotal: orderTotal,
                amountCharged: amountChargedKobo / 100,

                currency: order.currency,
                status: computeOrderDisplayStatus(order, items),
                paymentStatus: order.status,
                paidAt: order.paid_at,

                items: items.map(item => ({
                    id: item.id,
                    title: item.title,
                    price: item.price,
                    quantity: item.quantity,
                    qty: item.quantity,
                    playerId: item.player_id,
                    serverId: item.server_id,

                    supplierPriceUsd: item.supplier_price_usd,
                    fulfillmentStatus: item.fulfillment_status || "Pending",
                    fulfillmentError: item.fulfillment_error || null,
                    fzrOrderId: item.fzr_order_id || null,
                }))
            };
        });

        console.log(
            `Admin loaded ${result.length} orders for user ${req.session.userId}`
        );

        return res.json({
            success: true,
            orders: result
        });

    } catch (error) {
        console.error("Could not load admin orders:", error);

        return res.status(500).json({
            success: false,
            message: "Unable to load admin orders."
        });
    }
});

/* =========================================================
   ADMIN — UPDATE ORDER STATUS
========================================================= */

app.patch("/api/admin/orders/:orderId/status", requireAdmin, (req, res) => {
    try {
        const orderId = String(req.params.orderId || "").trim();
        const status = String(req.body?.status || "").trim();

        if (!orderId) {
            return res.status(400).json({
                success: false,
                message: "Order ID is required."
            });
        }

        const allowedStatuses = ["Cancelled", "Refunded"];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message:
                    "Admins can only cancel unpaid orders or mark confirmed paid orders as refunded."
            });
        }

        const existingOrder = db.prepare(`
            SELECT
                order_id,
                status,
                amount_charged,
                paid_at
            FROM orders
            WHERE order_id = ?
        `).get(orderId);

        if (!existingOrder) {
            return res.status(404).json({
                success: false,
                message: "Order not found."
            });
        }

        const amountCharged = Number(existingOrder.amount_charged ?? 0);
        const hasConfirmedPayment =
            Boolean(existingOrder.paid_at) && amountCharged > 0;

        if (status === "Cancelled") {
            if (hasConfirmedPayment) {
                return res.status(400).json({
                    success: false,
                    message:
                        "A confirmed paid order cannot be cancelled. Use Refunded only after the refund has actually been handled."
                });
            }

            if (["Refunded", "Cancelled"].includes(existingOrder.status)) {
                return res.status(400).json({
                    success: false,
                    message: `Order is already ${existingOrder.status}.`
                });
            }
        }

        if (status === "Refunded") {
            if (!hasConfirmedPayment) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Only an order with a confirmed payment can be marked Refunded."
                });
            }

            if (existingOrder.status === "Refunded") {
                return res.status(400).json({
                    success: false,
                    message: "Order is already Refunded."
                });
            }

            const processingItem = db.prepare(`
                SELECT id
                FROM order_items
                WHERE order_id = ?
                  AND fulfillment_status = 'Processing'
                LIMIT 1
            `).get(orderId);

            if (processingItem) {
                return res.status(409).json({
                    success: false,
                    message:
                        "This order still has a Processing FZR delivery. Check its supplier status before marking the order Refunded."
                });
            }
        }

        db.prepare(`
            UPDATE orders
            SET status = ?
            WHERE order_id = ?
        `).run(status, orderId);

        const updatedOrder = db.prepare(`
            SELECT
                order_id,
                reference,
                order_total,
                amount_charged,
                currency,
                status,
                paid_at,
                created_at
            FROM orders
            WHERE order_id = ?
        `).get(orderId);

        logger.info("ADMIN ORDER STATUS UPDATED:", {
            adminUserId: req.session?.userId,
            orderId,
            oldStatus: existingOrder.status,
            newStatus: status
        });

        return res.json({
            success: true,
            message:
                status === "Cancelled"
                    ? "Unpaid order cancelled."
                    : "Order marked Refunded.",
            order: {
                orderId: updatedOrder.order_id,
                reference: updatedOrder.reference,
                status: updatedOrder.status,
                orderTotal: Number(updatedOrder.order_total || 0),
                amountCharged:
                    Number(updatedOrder.amount_charged ?? 0) / 100,
                currency: updatedOrder.currency,
                paidAt: updatedOrder.paid_at,
                createdAt: updatedOrder.created_at
            }
        });

    } catch (error) {
        logger.error(
            "Admin order status update error:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message: "Unable to update order status."
        });
    }
});

/* =========================================================
   ADMIN SETTINGS
========================================================= */

app.get("/api/admin/settings", requireAdmin, (req, res) => {
    res.json({
        success: true,

        maintenanceMode:
            getSetting("maintenance_mode", "0") === "1",

        usdNgnRate:
            Number(
                getSetting(
                    "usd_ngn_rate",
                    FZR_EXCHANGE_RATE
                )
            ),

        paymentsEnabled:
            getSetting("payments_enabled", "1") === "1",

        autoFulfillmentEnabled:
            getSetting(
                "auto_fulfillment_enabled",
                "1"
            ) === "1",

        maxQuantity:
            Number(
                getSetting(
                    "max_quantity",
                    "20"
                )
            ),

        pendingOrderExpiryHours:
            Number(
                getSetting(
                    "pending_order_expiry_hours",
                    "24"
                )
            ),

        storeAnnouncement:
            getSetting(
                "store_announcement",
                ""
            ),
        notificationsEnabled:
            getSetting(
                "notifications_enabled",
                "1"
            ) === "1",

        notifyFailedFulfillment:
            getSetting(
                "notify_failed_fulfillment",
                "1"
            ) === "1",

        notifyNewComplaint:
            getSetting(
                "notify_new_complaint",
                "1"
            ) === "1",

        notifyPaymentError:
            getSetting(
                "notify_payment_error",
                "1"
            ) === "1",

        notifyPaidOrder:
            getSetting(
                "notify_paid_order",
                "0"
            ) === "1",

        notificationEmail:
            getSetting(
                "notification_email",
                process.env.SMTP_USER || ""
            )
    });

});

app.patch("/api/admin/settings", requireAdmin, (req, res) => {
    try {
        if (typeof req.body?.maintenanceMode === "boolean") {
            setSetting("maintenance_mode", req.body.maintenanceMode ? "1" : "0");
        }

        if (req.body?.usdNgnRate !== undefined) {
            const rate = Number(req.body.usdNgnRate);
            if (!Number.isFinite(rate) || rate <= 0) {
                return res.status(400).json({ success: false, message: "Enter a valid exchange rate." });
            }
            setSetting("usd_ngn_rate", String(rate));
        }

        if (
            typeof req.body?.paymentsEnabled ===
            "boolean"
        ) {
            setSetting(
                "payments_enabled",
                req.body.paymentsEnabled
                    ? "1"
                    : "0"
            );
        }

        if (
            typeof req.body?.autoFulfillmentEnabled ===
            "boolean"
        ) {
            setSetting(
                "auto_fulfillment_enabled",
                req.body.autoFulfillmentEnabled
                    ? "1"
                    : "0"
            );
        }

        if (
            req.body?.maxQuantity !== undefined
        ) {
            const maxQuantity =
                Number(req.body.maxQuantity);

            if (
                !Number.isInteger(maxQuantity) ||
                maxQuantity < 1 ||
                maxQuantity > 100
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Maximum quantity must be between 1 and 100."
                });
            }

            setSetting(
                "max_quantity",
                String(maxQuantity)
            );
        }

        if (
            req.body?.pendingOrderExpiryHours !==
            undefined
        ) {
            const hours =
                Number(
                    req.body.pendingOrderExpiryHours
                );

            if (
                !Number.isFinite(hours) ||
                hours < 1 ||
                hours > 168
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Pending order expiry must be between 1 and 168 hours."
                });
            }

            setSetting(
                "pending_order_expiry_hours",
                String(hours)
            );
        }

        if (
            req.body?.storeAnnouncement !==
            undefined
        ) {
            const announcement =
                String(
                    req.body.storeAnnouncement ||
                    ""
                )
                    .trim()
                    .slice(0, 300);

            setSetting(
                "store_announcement",
                announcement
            );
        }

        if (
            typeof req.body?.notificationsEnabled ===
            "boolean"
        ) {
            setSetting(
                "notifications_enabled",
                req.body.notificationsEnabled
                    ? "1"
                    : "0"
            );
        }

        if (
            typeof req.body?.notifyFailedFulfillment ===
            "boolean"
        ) {
            setSetting(
                "notify_failed_fulfillment",
                req.body.notifyFailedFulfillment
                    ? "1"
                    : "0"
            );
        }

        if (
            typeof req.body?.notifyNewComplaint ===
            "boolean"
        ) {
            setSetting(
                "notify_new_complaint",
                req.body.notifyNewComplaint
                    ? "1"
                    : "0"
            );
        }

        if (
            typeof req.body?.notifyPaymentError ===
            "boolean"
        ) {
            setSetting(
                "notify_payment_error",
                req.body.notifyPaymentError
                    ? "1"
                    : "0"
            );
        }

        if (
            typeof req.body?.notifyPaidOrder ===
            "boolean"
        ) {
            setSetting(
                "notify_paid_order",
                req.body.notifyPaidOrder
                    ? "1"
                    : "0"
            );
        }

        if (
            req.body?.notificationEmail !==
            undefined
        ) {
            const notificationEmail =
                String(
                    req.body.notificationEmail ||
                    ""
                )
                    .trim()
                    .toLowerCase();

            if (
                notificationEmail &&
                !notificationEmail.includes("@")
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Enter a valid notification email."
                });
            }

            setSetting(
                "notification_email",
                notificationEmail
            );
        }

        console.log("Store settings updated by admin.");

        return res.json({ success: true, message: "Settings saved." });
    } catch (error) {
        console.error("Settings update error:", error);
        return res.status(500).json({ success: false, message: "Unable to save settings." });
    }

});

/* =========================================================
   ADMIN SYSTEM STATUS
========================================================= */

app.get(
    "/api/admin/system-status",
    requireAdmin,
    async (req, res) => {

        let databaseStatus =
            "healthy";

        try {
            db.prepare(`
                SELECT 1
            `).get();
        } catch (error) {
            databaseStatus =
                "error";
        }

        return res.json({
            success: true,

            system: {

                paystack: {
                    configured:
                        Boolean(
                            process.env.PAYSTACK_SECRET_KEY &&
                            process.env.PAYSTACK_PUBLIC_KEY
                        )
                },

                fzr: {
                    configured:
                        Boolean(
                            process.env.FZR_API_KEY
                        )
                },

                smtp: {
                    status:
                        smtpStatus
                },

                environment:
                    process.env.NODE_ENV ===
                        "production"
                        ? "production"
                        : "development",

                database: {
                    status:
                        databaseStatus
                },

                lastPaystackWebhook:
                    getSetting(
                        "last_paystack_webhook_at",
                        ""
                    ) || null
            }
        });
    }
);
/* =========================================================
   ADMIN — FULFILL PENDING FZR ITEM
========================================================= */
app.post(
    "/api/admin/orders/:orderId/items/:itemId/fulfill",
    requireAdmin,
    async (req, res) => {
        try {
            const orderId = String(req.params.orderId || "").trim();
            const itemId = Number(req.params.itemId);

            if (!orderId || !Number.isInteger(itemId) || itemId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid order or item."
                });
            }

            const orderItem = db.prepare(`
                SELECT
                    oi.id,
                    oi.order_id,
                    oi.offer_id,
                    oi.category_id,
                    oi.player_id,
                    oi.server_id,
                    oi.fulfillment_status,
                    oi.fzr_order_id,
                    o.status AS order_status,
                    o.amount_charged,
                    o.paid_at
                FROM order_items oi
                INNER JOIN orders o
                    ON o.order_id = oi.order_id
                WHERE oi.id = ?
                  AND oi.order_id = ?
                LIMIT 1
            `).get(itemId, orderId);

            if (!orderItem) {
                return res.status(404).json({
                    success: false,
                    message: "Order item not found."
                });
            }

            const hasConfirmedPayment =
                Boolean(orderItem.paid_at) &&
                Number(orderItem.amount_charged ?? 0) > 0 &&
                !["Refunded", "Cancelled"].includes(orderItem.order_status);

            if (!hasConfirmedPayment) {
                return res.status(400).json({
                    success: false,
                    message:
                        "This item cannot be fulfilled until its payment is confirmed."
                });
            }

            if (orderItem.fulfillment_status !== "Pending") {
                return res.status(409).json({
                    success: false,
                    message:
                        `Only Pending items can be fulfilled. Current status: ${orderItem.fulfillment_status}.`
                });
            }

            if (orderItem.fzr_order_id) {
                return res.status(409).json({
                    success: false,
                    message:
                        "This item already has an FZR order ID and cannot be submitted again."
                });
            }

            const claim = db.prepare(`
                UPDATE order_items
                SET fulfillment_status = 'Processing'
                WHERE id = ?
                  AND order_id = ?
                  AND fulfillment_status = 'Pending'
                  AND fzr_order_id IS NULL
            `).run(itemId, orderId);

            if (claim.changes !== 1) {
                return res.status(409).json({
                    success: false,
                    message:
                        "This item is already being processed by another request."
                });
            }

            try {
                const fzrResult = await createFzrTopup({
                    offerId: orderItem.offer_id,
                    categoryId: orderItem.category_id,
                    playerId: orderItem.player_id,
                    serverId: orderItem.server_id
                });

                const fzrOrderId = fzrResult?.order?.id || null;
                const normalizedStatus = String(
                    fzrResult?.order?.status || "created"
                ).toLowerCase();

                const fulfillmentStatus =
                    mapFzrStatusToFulfillmentStatus(normalizedStatus);

                db.prepare(`
                    UPDATE order_items
                    SET fulfillment_status = ?,
                        fzr_order_id = ?
                    WHERE id = ?
                `).run(fulfillmentStatus, fzrOrderId, itemId);

                return res.json({
                    success: true,
                    fulfillmentStatus,
                    fzrOrderId,
                    message:
                        fulfillmentStatus === "Completed"
                            ? "Delivery completed."
                            : "Delivery submitted to FZR."
                });

            } catch (fzrError) {
                const failure = fzrFailureDetails(fzrError);
                db.prepare(`
                    UPDATE order_items
                    SET fulfillment_status = ?, fulfillment_error = ?
                    WHERE id = ?
                      AND fulfillment_status = 'Processing'
                      AND fzr_order_id IS NULL
                `).run(failure.status, failure.message, itemId);

                sendFulfillmentFailureAlert(orderItem, failure.message, failure.status);

                return res.status(502).json({
                    success: false,
                    requiresReview: failure.status === "Review Required",
                    message: failure.status === "Review Required"
                        ? failure.message + " Check FZR order history before any retry."
                        : "FZR rejected the fulfillment request: " + failure.message
                });
            }

        } catch (error) {
            logger.error("Manual fulfillment error:", error.message);

            return res.status(500).json({
                success: false,
                message: "Unable to fulfill this item."
            });
        }
    }
);

/* =========================================================
   ADMIN — CHECK FZR ITEM STATUS
========================================================= */
app.post(
    "/api/admin/orders/:orderId/items/:itemId/check-status",
    requireAdmin,
    async (req, res) => {
        try {
            const orderId = String(req.params.orderId || "").trim();
            const itemId = Number(req.params.itemId);

            if (!orderId || !Number.isInteger(itemId) || itemId <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid order or item."
                });
            }

            const orderItem = db.prepare(`
                SELECT
                    id,
                    order_id,
                    fulfillment_status,
                    fzr_order_id
                FROM order_items
                WHERE id = ?
                  AND order_id = ?
                LIMIT 1
            `).get(itemId, orderId);

            if (!orderItem) {
                return res.status(404).json({
                    success: false,
                    message: "Order item not found."
                });
            }

            if (!orderItem.fzr_order_id) {
                return res.status(400).json({
                    success: false,
                    message: "This item does not have an FZR order ID yet."
                });
            }

            const fzrOrder = await getFzrOrderStatus(orderItem.fzr_order_id);
            const fulfillmentStatus =
                mapFzrStatusToFulfillmentStatus(fzrOrder.status);

            db.prepare(`
                UPDATE order_items
                SET fulfillment_status = ?
                WHERE id = ?
            `).run(fulfillmentStatus, itemId);

            return res.json({
                success: true,
                fulfillmentStatus,
                fzrOrderId: orderItem.fzr_order_id,
                message:
                    fulfillmentStatus === "Processing"
                        ? "FZR is still processing this delivery."
                        : `FZR status updated to ${fulfillmentStatus}.`
            });

        } catch (error) {
            logger.error("FZR manual status check failed:", error.message);

            return res.status(502).json({
                success: false,
                message:
                    "Unable to check FZR status right now: " + error.message
            });
        }
    }
);

/* =========================================================
   ADMIN — CONFIRM NO FZR ORDER AFTER AMBIGUOUS FAILURE
========================================================= */
app.post("/api/admin/orders/:orderId/items/:itemId/confirm-no-fzr-order", requireAdmin, (req, res) => {
    const orderId = String(req.params.orderId || "").trim();
    const itemId = Number(req.params.itemId);

    if (!orderId || !Number.isInteger(itemId) || itemId <= 0) {
        return res.status(400).json({ success: false, message: "Invalid order or item." });
    }
    if (req.body?.confirmed !== true) {
        return res.status(400).json({ success: false, message: "Explicit confirmation is required after checking FZR order history." });
    }

    const result = db.prepare(`
        UPDATE order_items
        SET fulfillment_status = 'Failed',
            fulfillment_error = 'Admin confirmed no FZR supplier order exists; safe to retry.'
        WHERE id = ? AND order_id = ?
          AND fulfillment_status = 'Review Required'
          AND (fzr_order_id IS NULL OR fzr_order_id = '')
    `).run(itemId, orderId);

    if (result.changes !== 1) {
        return res.status(409).json({ success: false, message: "Item is not awaiting manual FZR review, or it already has an FZR order ID." });
    }

    logger.warn(`Admin confirmed no FZR order exists for ${orderId} item ${itemId}; retry enabled.`);
    return res.json({ success: true, message: "Review recorded. Retry Delivery is now enabled." });
});

/* =========================================================
   ADMIN — RETRY FAILED FZR DELIVERY
========================================================= */

app.post(
    "/api/admin/orders/:orderId/items/:itemId/retry",
    requireAdmin,
    async (req, res) => {
        try {
            const orderId =
                String(req.params.orderId || "").trim();

            const itemId =
                Number(req.params.itemId);

            if (
                !orderId ||
                !Number.isInteger(itemId) ||
                itemId <= 0
            ) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid order or item."
                });
            }

            /* -------------------------------------------------
               LOAD ORDER + ITEM
            ------------------------------------------------- */

            const orderItem = db.prepare(`
                SELECT
                    oi.id,
                    oi.order_id,
                    oi.offer_id,
                    oi.category_id,
                    oi.player_id,
                    oi.server_id,
                    oi.fulfillment_status,
                    oi.fzr_order_id,
                    o.status AS order_status,
                    o.amount_charged,
                    o.paid_at
                FROM order_items oi
                INNER JOIN orders o
                    ON o.order_id = oi.order_id
                WHERE oi.id = ?
                  AND oi.order_id = ?
                LIMIT 1
            `).get(
                itemId,
                orderId
            );

            if (!orderItem) {
                return res.status(404).json({
                    success: false,
                    message: "Order item not found."
                });
            }

            /* -------------------------------------------------
               ORDER MUST ACTUALLY BE PAID
            ------------------------------------------------- */

            const hasConfirmedPayment =
                Boolean(orderItem.paid_at) &&
                Number(orderItem.amount_charged ?? 0) > 0 &&
                !["Refunded", "Cancelled"].includes(orderItem.order_status);

            if (!hasConfirmedPayment) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Cannot retry delivery because this order does not have a confirmed active payment."
                });
            }

            /* -------------------------------------------------
               ONLY FAILED ITEMS CAN BE RETRIED
            ------------------------------------------------- */

            if (
                orderItem.fulfillment_status !==
                "Failed"
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Only failed items can be retried."
                });
            }

            /* -------------------------------------------------
               ATOMICALLY CLAIM RETRY

               Only one concurrent request can change
               Failed -> Processing.
            ------------------------------------------------- */

            const claim = db.prepare(`
                UPDATE order_items
                SET
                    fulfillment_status = 'Processing',
                    fulfillment_error = NULL,
                    fzr_order_id = NULL
                WHERE id = ?
                  AND order_id = ?
                  AND fulfillment_status = 'Failed'
            `).run(
                orderItem.id,
                orderItem.order_id
            );

            if (claim.changes !== 1) {
                return res.status(409).json({
                    success: false,
                    message:
                        "This item is already being retried."
                });
            }

            try {
                /* -------------------------------------------------
                   SEND RETRY TO FZR
                ------------------------------------------------- */

                const fzrResult =
                    await createFzrTopup({
                        offerId:
                            orderItem.offer_id,

                        categoryId:
                            orderItem.category_id,

                        playerId:
                            orderItem.player_id,

                        serverId:
                            orderItem.server_id
                    });

                const fzrOrderId =
                    fzrResult?.order?.id ||
                    null;

                const fulfillmentStatus =
                    mapFzrStatusToFulfillmentStatus(
                        fzrResult?.order?.status
                    );

                db.prepare(`
                    UPDATE order_items
                    SET
                        fulfillment_status = ?,
                        fzr_order_id = ?
                    WHERE id = ?
                `).run(
                    fulfillmentStatus,
                    fzrOrderId,
                    orderItem.id
                );

                console.log(
                    `Retry: item ${orderItem.id} → ${fulfillmentStatus}`
                );

                return res.json({
                    success: true,
                    fulfillmentStatus,
                    fzrOrderId,
                    message:
                        `Retry sent — status: ${fulfillmentStatus}.`
                });

            } catch (fzrError) {

                console.error(
                    "Retry failed:",
                    fzrError.message
                );

                /*
                 * Important:
                 * Return it to Failed so admin can
                 * safely attempt another retry later.
                 */
                const failure = fzrFailureDetails(fzrError);
                db.prepare(`
                    UPDATE order_items
                    SET fulfillment_status = ?, fulfillment_error = ?
                    WHERE id = ?
                      AND fulfillment_status = 'Processing'
                `).run(failure.status, failure.message, orderItem.id);

                sendFulfillmentFailureAlert(orderItem, failure.message, failure.status);

                return res.status(502).json({
                    success: false,
                    requiresReview: failure.status === "Review Required",
                    message: failure.status === "Review Required"
                        ? failure.message + " Check FZR order history before any retry."
                        : "FZR rejected the retry: " + failure.message
                });
            }

        } catch (error) {

            console.error(
                "Retry endpoint error:",
                error
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to retry this item."
            });
        }
    }
);

/* =========================================================
   ADMIN — ANALYTICS
========================================================= */

app.get("/api/admin/analytics", requireAdmin, (req, res) => {
    try {

        /* =====================================================
           MONEY
        ===================================================== */

        const revenueRow = db.prepare(`
            SELECT
                COALESCE(
                    SUM(amount_charged),
                    0
                ) AS revenue
            FROM orders
            WHERE amount_charged > 0
              AND status NOT IN (
                    'Refunded',
                    'Cancelled',
                    'Failed'
              )
        `).get();


        const todayRevenueRow = db.prepare(`
            SELECT
                COALESCE(
                    SUM(amount_charged),
                    0
                ) AS revenue
            FROM orders
            WHERE amount_charged > 0
              AND status NOT IN (
                    'Refunded',
                    'Cancelled',
                    'Failed'
              )
              AND paid_at IS NOT NULL
              AND date(
                    datetime(paid_at)
                  ) = date('now')
        `).get();


        const sevenDayRevenueRow = db.prepare(`
            SELECT
                COALESCE(
                    SUM(amount_charged),
                    0
                ) AS revenue
            FROM orders
            WHERE amount_charged > 0
              AND status NOT IN (
                    'Refunded',
                    'Cancelled',
                    'Failed'
              )
              AND paid_at IS NOT NULL
              AND datetime(paid_at)
                    >= datetime(
                        'now',
                        '-7 days'
                    )
        `).get();


        const monthRevenueRow = db.prepare(`
            SELECT
                COALESCE(
                    SUM(amount_charged),
                    0
                ) AS revenue
            FROM orders
            WHERE amount_charged > 0
              AND status NOT IN (
                    'Refunded',
                    'Cancelled',
                    'Failed'
              )
              AND paid_at IS NOT NULL
              AND strftime(
                    '%Y-%m',
                    datetime(paid_at)
                  ) = strftime(
                    '%Y-%m',
                    'now'
                  )
        `).get();


        const supplierCostRow = db.prepare(`
            SELECT
                COALESCE(
                    SUM(
                        oi.supplier_cost_ngn *
                        oi.quantity
                    ),
                    0
                ) AS cost
            FROM order_items oi
            INNER JOIN orders o
                ON o.order_id =
                   oi.order_id
            WHERE o.amount_charged > 0
              AND o.status NOT IN (
                    'Refunded',
                    'Cancelled',
                    'Failed'
              )
        `).get();


        const refundedValueRow = db.prepare(`
            SELECT
                COALESCE(
                    SUM(amount_charged),
                    0
                ) AS value
            FROM orders
            WHERE status = 'Refunded'
        `).get();


        /* =====================================================
           ORDERS
        ===================================================== */

        const orderStats = db.prepare(`
            SELECT
                COUNT(*) AS total,

                SUM(
                    CASE
                        WHEN amount_charged > 0
                        THEN 1
                        ELSE 0
                    END
                ) AS paid,

                SUM(
                    CASE
                        WHEN status = 'Pending'
                        AND amount_charged = 0
                        THEN 1
                        ELSE 0
                    END
                ) AS pending,

                SUM(
                    CASE
                        WHEN status = 'Processing'
                        THEN 1
                        ELSE 0
                    END
                ) AS processing,

                SUM(
                    CASE
                        WHEN status = 'Completed'
                        THEN 1
                        ELSE 0
                    END
                ) AS completed,

                SUM(
                    CASE
                        WHEN status = 'Failed'
                        THEN 1
                        ELSE 0
                    END
                ) AS failed,

                SUM(
                    CASE
                        WHEN status = 'Cancelled'
                        THEN 1
                        ELSE 0
                    END
                ) AS cancelled,

                SUM(
                    CASE
                        WHEN status = 'Refunded'
                        THEN 1
                        ELSE 0
                    END
                ) AS refunded

            FROM orders
        `).get();


        /* =====================================================
           FULFILLMENT
        ===================================================== */

        const fulfillmentStats =
            db.prepare(`
                SELECT
                    COUNT(*) AS total,

                    SUM(
                        CASE
                            WHEN oi.fulfillment_status =
                                 'Completed'
                            THEN 1
                            ELSE 0
                        END
                    ) AS completed,

                    SUM(
                        CASE
                            WHEN oi.fulfillment_status =
                                 'Processing'
                            THEN 1
                            ELSE 0
                        END
                    ) AS processing,

                    SUM(
                        CASE
                            WHEN oi.fulfillment_status =
                                 'Failed'
                            THEN 1
                            ELSE 0
                        END
                    ) AS failed

                FROM order_items oi

                INNER JOIN orders o
                    ON o.order_id =
                       oi.order_id

                WHERE o.amount_charged > 0
                  AND o.status NOT IN (
                        'Refunded',
                        'Cancelled'
                  )
            `).get();


        /* =====================================================
           CUSTOMERS
        ===================================================== */

        const customerStats =
            db.prepare(`
                SELECT
                    COUNT(*) AS total
                FROM users
                WHERE role = 'customer'
            `).get();


        const repeatCustomers =
            db.prepare(`
                SELECT
                    COUNT(*) AS total
                FROM (
                    SELECT
                        user_id
                    FROM orders

                    WHERE user_id IS NOT NULL
                      AND amount_charged > 0
                      AND status NOT IN (
                            'Refunded',
                            'Cancelled',
                            'Failed'
                      )

                    GROUP BY user_id

                    HAVING COUNT(*) > 1
                )
            `).get();


        const newCustomersMonth =
            db.prepare(`
                SELECT
                    COUNT(*) AS total
                FROM users
                WHERE role = 'customer'
                  AND strftime(
                        '%Y-%m',
                        datetime(created_at)
                      ) = strftime(
                        '%Y-%m',
                        'now'
                      )
            `).get();


        /* =====================================================
           TOP PRODUCTS
        ===================================================== */

        const packageBreakdown =
            db.prepare(`
                SELECT
                    oi.title AS title,

                    SUM(
                        oi.quantity
                    ) AS units_sold,

                    SUM(
                        oi.price *
                        oi.quantity
                    ) AS total_sell,

                    SUM(
                        oi.supplier_cost_ngn *
                        oi.quantity
                    ) AS total_cost

                FROM order_items oi

                INNER JOIN orders o
                    ON oi.order_id =
                       o.order_id

                WHERE o.amount_charged > 0
                  AND o.status NOT IN (
                        'Refunded',
                        'Cancelled',
                        'Failed'
                  )

                GROUP BY oi.title

                ORDER BY total_sell DESC
            `).all();


        const packages =
            packageBreakdown.map(
                row => {

                    const sell =
                        Number(
                            row.total_sell ||
                            0
                        );

                    const cost =
                        Number(
                            row.total_cost ||
                            0
                        );

                    const profit =
                        sell - cost;

                    return {
                        title:
                            row.title,

                        unitsSold:
                            Number(
                                row.units_sold ||
                                0
                            ),

                        sellPrice:
                            sell,

                        supplierPrice:
                            cost,

                        profit,

                        margin:
                            sell > 0
                                ? Number(
                                    (
                                        profit /
                                        sell *
                                        100
                                    ).toFixed(2)
                                )
                                : 0
                    };
                }
            );


        /* =====================================================
           TOP CUSTOMERS
        ===================================================== */

        const topCustomers =
            db.prepare(`
                SELECT
                    u.id,
                    u.name,
                    u.email,

                    COUNT(o.id)
                        AS order_count,

                    COALESCE(
                        SUM(
                            o.amount_charged
                        ),
                        0
                    ) AS spending

                FROM users u

                INNER JOIN orders o
                    ON o.user_id =
                       u.id

                WHERE o.amount_charged > 0
                  AND o.status NOT IN (
                        'Refunded',
                        'Cancelled',
                        'Failed'
                  )

                GROUP BY
                    u.id,
                    u.name,
                    u.email

                ORDER BY spending DESC

                LIMIT 10
            `).all()
                .map(customer => ({
                    id:
                        customer.id,

                    name:
                        customer.name,

                    email:
                        customer.email,

                    orderCount:
                        Number(
                            customer.order_count ||
                            0
                        ),

                    totalSpending:
                        Number(
                            customer.spending ||
                            0
                        ) / 100
                }));


        /* =====================================================
           LAST 7 DAYS SALES
        ===================================================== */

        const dailySales =
            db.prepare(`
                SELECT
                    date(
                        datetime(paid_at)
                    ) AS day,

                    COUNT(*) AS orders,

                    COALESCE(
                        SUM(amount_charged),
                        0
                    ) AS revenue

                FROM orders

                WHERE amount_charged > 0
                  AND paid_at IS NOT NULL
                  AND status NOT IN (
                        'Refunded',
                        'Cancelled',
                        'Failed'
                  )

                  AND datetime(paid_at)
                        >= datetime(
                            'now',
                            '-7 days'
                        )

                GROUP BY
                    date(
                        datetime(paid_at)
                    )

                ORDER BY day ASC
            `).all()
                .map(row => ({
                    day:
                        row.day,

                    orders:
                        Number(
                            row.orders ||
                            0
                        ),

                    revenue:
                        Number(
                            row.revenue ||
                            0
                        ) / 100
                }));


        /* =====================================================
           FINAL CALCULATIONS
        ===================================================== */

        const totalRevenue =
            Number(
                revenueRow.revenue ||
                0
            ) / 100;


        const supplierCost =
            Number(
                supplierCostRow.cost ||
                0
            );


        const profit =
            totalRevenue -
            supplierCost;


        const profitMargin =
            totalRevenue > 0
                ? Number(
                    (
                        profit /
                        totalRevenue *
                        100
                    ).toFixed(2)
                )
                : 0;


        const paidOrders =
            Number(
                orderStats.paid ||
                0
            );


        const averageOrderValue =
            paidOrders > 0
                ? totalRevenue /
                paidOrders
                : 0;


        const completedFulfillment =
            Number(
                fulfillmentStats.completed ||
                0
            );


        const failedFulfillment =
            Number(
                fulfillmentStats.failed ||
                0
            );


        const terminalFulfillment =
            completedFulfillment +
            failedFulfillment;


        const fulfillmentSuccessRate =
            terminalFulfillment > 0
                ? Number(
                    (
                        completedFulfillment /
                        terminalFulfillment *
                        100
                    ).toFixed(2)
                )
                : 0;


        const analytics = {

            money: {
                totalRevenue,

                todayRevenue:
                    Number(
                        todayRevenueRow.revenue ||
                        0
                    ) / 100,

                sevenDayRevenue:
                    Number(
                        sevenDayRevenueRow.revenue ||
                        0
                    ) / 100,

                monthRevenue:
                    Number(
                        monthRevenueRow.revenue ||
                        0
                    ) / 100,

                supplierCost,

                grossProfit:
                    profit,

                profitMargin,

                averageOrderValue,

                refundedOrderValue:
                    Number(
                        refundedValueRow.value ||
                        0
                    ) / 100
            },


            orders: {
                total:
                    Number(
                        orderStats.total ||
                        0
                    ),

                paid:
                    paidOrders,

                pending:
                    Number(
                        orderStats.pending ||
                        0
                    ),

                processing:
                    Number(
                        orderStats.processing ||
                        0
                    ),

                completed:
                    Number(
                        orderStats.completed ||
                        0
                    ),

                failed:
                    Number(
                        orderStats.failed ||
                        0
                    ),

                cancelled:
                    Number(
                        orderStats.cancelled ||
                        0
                    ),

                refunded:
                    Number(
                        orderStats.refunded ||
                        0
                    )
            },


            fulfillment: {
                total:
                    Number(
                        fulfillmentStats.total ||
                        0
                    ),

                completed:
                    completedFulfillment,

                processing:
                    Number(
                        fulfillmentStats.processing ||
                        0
                    ),

                failed:
                    failedFulfillment,

                successRate:
                    fulfillmentSuccessRate
            },


            customers: {
                total:
                    Number(
                        customerStats.total ||
                        0
                    ),

                repeat:
                    Number(
                        repeatCustomers.total ||
                        0
                    ),

                newThisMonth:
                    Number(
                        newCustomersMonth.total ||
                        0
                    )
            },

            packages,

            topCustomers,

            dailySales
        };


        return res.json({
            success: true,
            analytics
        });

    } catch (error) {

        logger.error(
            "Could not load admin analytics:",
            error.message
        );

        return res.status(500).json({
            success: false,
            message:
                "Unable to load analytics."
        });
    }
});

/* =========================================================
   ADMIN — GET CUSTOMERS
========================================================= */

app.get("/api/admin/customers", requireAdmin, (req, res) => {
    try {
        const customers = db.prepare(`
            SELECT
                u.id,
                u.name,
                u.email,
                u.phone,
                u.role,
                u.created_at,
                COUNT(o.id) AS order_count,
                COALESCE(SUM(CASE WHEN o.status NOT IN ('Failed', 'Cancelled', 'Refunded') THEN o.amount_charged / 100.0 ELSE 0 END), 0) AS total_spending,
                MAX(o.created_at) AS last_order
            FROM users u
            LEFT JOIN orders o ON o.user_id = u.id
            WHERE u.role = 'customer'
            GROUP BY u.id
            ORDER BY u.created_at DESC
        `).all();

        return res.json({
            success: true,
            customers: customers.map(customer => ({
                id: customer.id,
                name: customer.name,
                email: customer.email,
                phone: customer.phone,
                role: customer.role,
                orderCount: Number(customer.order_count || 0),
                totalSpending: Number(customer.total_spending || 0),
                lastOrder: customer.last_order,
                createdAt: customer.created_at,
                status: "Active"
            }))
        });
    } catch (error) {
        console.error("Could not load admin customers:", error);
        return res.status(500).json({ success: false, message: "Unable to load customers." });
    }
});

/* =========================================================
   ADMIN — VERIFY SESSION
========================================================= */

app.get("/api/admin/session", requireAdmin, (req, res) => {
    const user = db.prepare(`SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?`).get(req.session.userId);

    if (!user) return res.status(401).json({ success: false, authenticated: false });

    return res.json({
        success: true,
        authenticated: true,
        user: {
            id: user.id,
            name: user.name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            createdAt: user.created_at
        }
    });
});

/* =========================================================
   ADMIN — GET FZR PRODUCTS
========================================================= */
app.get("/api/admin/products", requireAdmin, (req, res) => {
    try {
        const products = db.prepare(`
    SELECT
        id,
        category_id AS categoryId,
        offer_id AS offerId,
        title,
        supplier_price_usd AS supplierPriceUsd,
        retail_price_usd AS retailPriceUsd,
        retail_price_ngn AS retailPriceNgn,
        available,
        created_at AS createdAt,
        updated_at AS updatedAt
    FROM products
    WHERE category_id IN (
        'mobile_legends_global',
        'mobile_legends_philippines'
    )
    ORDER BY category_id ASC, id ASC
`).all();

        const exchangeRate =
            Number(
                getSetting(
                    "usd_ngn_rate",
                    FZR_EXCHANGE_RATE
                )
            );

        const result = products.map(product => {

            const supplierNgn =
                Number(
                    product.supplierPriceUsd || 0
                ) * exchangeRate;

            const retailNgn =
                Number(
                    product.retailPriceNgn || 0
                );

            const profit =
                retailNgn - supplierNgn;

            const margin =
                retailNgn > 0
                    ? (profit / retailNgn) * 100
                    : 0;

            return {
                ...product,

                supplierPriceNgn:
                    Math.round(supplierNgn),

                retailPriceNgn:
                    Math.round(retailNgn),

                profit:
                    Math.round(profit),

                profitMargin:
                    Number(
                        margin.toFixed(2)
                    )
            };
        });
        return res.json({
            success: true,
            products: result
        });

    } catch (error) {
        console.error(
            "Could not load FZR products:",
            error
        );

        return res.status(500).json({
            success: false,
            message: "Unable to load products."
        });
    }
});

/* =========================================================
   ADMIN — UPDATE PRODUCT
========================================================= */

app.patch("/api/admin/products/:id", requireAdmin, (req, res) => {
    try {
        const productId = Number(req.params.id);
        const { retailPriceNgn, available } = req.body;

        if (!Number.isInteger(productId)) return res.status(400).json({ success: false, message: "Invalid product ID." });
        if (retailPriceNgn !== undefined && (!Number.isFinite(Number(retailPriceNgn)) || Number(retailPriceNgn) < 0)) {
            return res.status(400).json({ success: false, message: "Invalid retail price." });
        }

        const existing = db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId);
        if (!existing) return res.status(404).json({ success: false, message: "Product not found." });

        db.prepare(`
            UPDATE products
            SET retail_price_ngn = COALESCE(?, retail_price_ngn), available = COALESCE(?, available), updated_at = ?
            WHERE id = ?
        `).run(
            retailPriceNgn === undefined ? null : Math.round(Number(retailPriceNgn)),
            available === undefined ? null : Number(available) ? 1 : 0,
            new Date().toISOString(),
            productId
        );

        const product = db.prepare(`
            SELECT id, category_id AS categoryId, offer_id AS offerId, title, supplier_price_usd AS supplierPriceUsd,
                   retail_price_usd AS retailPriceUsd, retail_price_ngn AS retailPriceNgn, available, updated_at AS updatedAt
            FROM products WHERE id = ?
        `).get(productId);

        return res.json({ success: true, message: "Product updated successfully.", product });
    } catch (error) {
        console.error("Product update error:", error);
        return res.status(500).json({ success: false, message: "Unable to update product." });
    }
});

function expireOldPendingOrders() {
    try {
        const expiryHours =
            Number(
                getSetting(
                    "pending_order_expiry_hours",
                    "24"
                )
            );

        const safeExpiryHours =
            Number.isFinite(expiryHours) &&
                expiryHours >= 1 &&
                expiryHours <= 168
                ? expiryHours
                : 24;

        const result = db.prepare(`
            UPDATE orders
            SET status = 'Cancelled'
            WHERE status = 'Pending'
              AND paid_at IS NULL
              AND COALESCE(amount_charged, 0) = 0
              AND datetime(created_at)
                    <= datetime(
                        'now',
                        '-' || ? || ' hours'
                    )
        `).run(
            safeExpiryHours
        );

        if (result.changes > 0) {
            logger.info(
                `Expired ${result.changes} unpaid pending order(s) older than ${safeExpiryHours} hour(s).`
            );
        }

    } catch (error) {
        logger.error(
            "Pending-order expiry failed:",
            error.message
        );
    }
}

app.get(
    "/api/admin/unmatched-payments",
    requireAdmin,
    (req, res) => {

        try {

            const payments =
                db.prepare(`
                    SELECT
                        id,
                        reference,
                        amount,
                        currency,
                        email,
                        phone,
                        player_id AS playerId,
                        server_id AS serverId,
                        paystack_status AS paystackStatus,
                        paid_at AS paidAt,
                        resolution_status AS resolutionStatus,
                        created_at AS createdAt
                    FROM unmatched_payments
                    ORDER BY id DESC
                `).all()
                    .map(payment => ({
                        ...payment,

                        amountNgn:
                            Number(
                                payment.amount || 0
                            ) / 100
                    }));

            return res.json({
                success: true,
                payments
            });

        } catch (error) {

            logger.error(
                "Unable to load unmatched payments:",
                error.message
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to load unmatched payments."
            });
        }
    }
);

app.post(
    "/api/admin/unmatched-payments/:id/recover",
    requireAdmin,
    async (req, res) => {
        try {
            const paymentId =
                Number(req.params.id);

            const orderId =
                String(
                    req.body?.orderId || ""
                ).trim();

            if (
                !Number.isInteger(paymentId) ||
                paymentId < 1 ||
                !orderId
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "A valid payment and Hiro order ID are required."
                });
            }

            const unmatched =
                db.prepare(`
                    SELECT *
                    FROM unmatched_payments
                    WHERE id = ?
                `).get(paymentId);

            if (!unmatched) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Unmatched payment not found."
                });
            }

            if (
                unmatched.resolution_status !==
                "Unresolved"
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "This payment has already been resolved."
                });
            }

            if (
                String(
                    unmatched.paystack_status || ""
                ).toLowerCase() !== "success" ||
                !unmatched.paid_at
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Only confirmed successful Paystack payments can be recovered."
                });
            }

            const order =
                db.prepare(`
                    SELECT *
                    FROM orders
                    WHERE order_id = ?
                `).get(orderId);

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message:
                        "Hiro order not found."
                });
            }

            /*
             * Recovery is only allowed against an
             * order that has NOT already been paid.
             */
            if (
                order.paid_at ||
                Number(
                    order.amount_charged ?? 0
                ) > 0
            ) {
                return res.status(409).json({
                    success: false,
                    message:
                        "That Hiro order is already marked as paid."
                });
            }

            const items =
                db.prepare(`
                    SELECT *
                    FROM order_items
                    WHERE order_id = ?
                    ORDER BY id ASC
                `).all(orderId);

            if (!items.length) {
                return res.status(400).json({
                    success: false,
                    message:
                        "That order has no purchased items."
                });
            }

            /*
             * Never attach a recovered payment to
             * something already submitted to FZR.
             */
            const alreadyFulfilled =
                items.some(item =>
                    item.fzr_order_id ||
                    ["Processing", "Completed"]
                        .includes(
                            item.fulfillment_status
                        )
                );

            if (alreadyFulfilled) {
                return res.status(409).json({
                    success: false,
                    message:
                        "This order already has fulfillment activity."
                });
            }

            const expectedKobo =
                Math.round(
                    Number(
                        order.order_total || 0
                    ) * 100
                );

            const paidKobo =
                Number(
                    unmatched.amount || 0
                );

            if (
                expectedKobo <= 0 ||
                paidKobo !== expectedKobo
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Payment amount does not match the Hiro order total."
                });
            }

            /*
             * Email mismatch should block recovery
             * when both sides actually contain an email.
             */
            const paymentEmail =
                String(
                    unmatched.email || ""
                )
                    .trim()
                    .toLowerCase();

            const orderEmail =
                String(
                    order.email || ""
                )
                    .trim()
                    .toLowerCase();

            if (
                paymentEmail &&
                orderEmail &&
                paymentEmail !== orderEmail
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Payment customer email does not match the Hiro order."
                });
            }

            /*
             * Critical safety check:
             * the successful Paystack reference must
             * not already exist on another Hiro order.
             */
            const existingReference =
                db.prepare(`
                    SELECT order_id
                    FROM orders
                    WHERE reference = ?
                `).get(
                    unmatched.reference
                );

            if (existingReference) {
                return res.status(409).json({
                    success: false,
                    message:
                        "That Paystack reference is already linked to a Hiro order."
                });
            }

            const recoverPayment =
                db.transaction(() => {

                    /*
                     * Replace the abandoned checkout
                     * reference with the actual successful
                     * Paystack reference.
                     *
                     * If the abandoned reference somehow
                     * succeeds later, its webhook will be
                     * quarantined as a NEW unmatched payment
                     * instead of fulfilling twice.
                     */
                    db.prepare(`
                        UPDATE orders
                        SET
                            reference = ?,
                            amount_charged = ?,
                            status = 'Paid',
                            paid_at = ?
                        WHERE order_id = ?
                          AND paid_at IS NULL
                          AND COALESCE(
                                amount_charged,
                                0
                              ) = 0
                    `).run(
                        unmatched.reference,
                        paidKobo,
                        unmatched.paid_at,
                        orderId
                    );

                    db.prepare(`
                        UPDATE order_items
                        SET
                            fulfillment_status = 'Pending',
                            fzr_order_id = NULL
                        WHERE order_id = ?
                          AND fulfillment_status
                              IN ('Pending', 'Failed')
                          AND fzr_order_id IS NULL
                    `).run(orderId);

                    db.prepare(`
                        UPDATE unmatched_payments
                        SET resolution_status = 'Resolved'
                        WHERE id = ?
                          AND resolution_status =
                              'Unresolved'
                    `).run(paymentId);
                });

            recoverPayment();

            logger.info(
                `Recovered unmatched payment ${unmatched.reference} into order ${orderId}`
            );

            return res.json({
                success: true,
                message:
                    "Payment recovered successfully. Review the order and use Fulfill Now when ready.",
                orderId
            });

        } catch (error) {
            logger.error(
                "Unmatched payment recovery failed:",
                error.message
            );

            return res.status(500).json({
                success: false,
                message:
                    "Unable to recover payment."
            });
        }
    }
);

/* =========================================================
   START SERVER
========================================================= */
setTimeout(
    checkPendingFzrOrders,
    5000
);

setInterval(
    checkPendingFzrOrders,
    30000
);

setTimeout(
    expireOldPendingOrders,
    10 * 1000
);

setInterval(
    expireOldPendingOrders,
    60 * 60 * 1000
);

app.use((err, req, res, next) => {
    console.error("Unhandled route error:", err);
    if (res.headersSent) return next(err);
    res.status(500).json({
        success: false,
        message: "Something went wrong. Please try again."
    });
});

// Refresh independently of admin visits, with one request/category per ten minutes.
finance.refreshPrices().catch(error => logger.warn("Supplier refresh unavailable:", error.message));
setInterval(() => {
    finance.refreshPrices().catch(error => logger.warn("Supplier refresh unavailable:", error.message));
}, 10 * 60 * 1000).unref();

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
});
