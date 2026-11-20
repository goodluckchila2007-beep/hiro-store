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

const { db, getSetting, setSetting } = require("./src/database")({
    Database,
    FZR_EXCHANGE_RATE,
    logger
});

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

/* =========================================================
   FZR MOBILE LEGENDS FULFILLMENT
========================================================= */

const {
    finance,
    mapFzrStatusToFulfillmentStatus,
    fzrFailureDetails,
    createFzrTopup,
    getFzrOrderStatus,
    checkPendingFzrOrders
} = require("./src/services/fzr")({
    app,
    db,
    axios,
    getSetting,
    setSetting,
    logger,
    apiLimiter,
    FZR_EXCHANGE_RATE,
    PAYSTACK_SECRET_KEY,
    requireAdmin,
    sendFulfillmentFailureAlert
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
   REQUIRE LOGIN
========================================================= */

function requireLogin(req, res, next) {
    if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, authenticated: false, message: "You must be logged in to access this." });
    }
    next();
}

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

// Register route modules after all services and middleware dependencies are initialized.
const routeContext = {
    path,
    express,
    cors,
    axios,
    Database,
    bcrypt,
    session,
    helmet,
    rateLimit,
    SqliteStore,
    crypto,
    nodemailer,
    smtpStatus,
    getSmtpStatus: () => smtpStatus,
    app,
    PORT,
    FZR_EXCHANGE_RATE,
    FRONTEND_ORIGIN,
    isProduction,
    logger,
    sessionDb,
    CSRF_EXEMPT,
    authLimiter,
    passwordResetLimiter,
    paymentLimiter,
    apiLimiter,
    mailTransporter,
    sendAdminNotification,
    PAYSTACK_SECRET_KEY,
    FZR_MLBB_PRODUCTS,
    FZR_PH_PRODUCTS,
    productsTableInfo,
    existingProductColumns,
    finalProductColumns,
    now,
    upsertFzrProduct,
    syncFzrProducts,
    escapeHtmlForEmail,
    sendFulfillmentFailureAlert,
    requireLogin,
    requireAdmin,
    computeOrderDisplayStatus,
    expireOldPendingOrders,
    db,
    getSetting,
    setSetting,
    finance,
    mapFzrStatusToFulfillmentStatus,
    fzrFailureDetails,
    createFzrTopup,
    getFzrOrderStatus,
    checkPendingFzrOrders
};

require("./src/routes/auth")(routeContext);
require("./src/routes/support")(routeContext);
require("./src/routes/store")(routeContext);
require("./src/routes/orders")(routeContext);
require("./src/routes/admin")(routeContext);
require("./src/routes/reconciliation")(routeContext);

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
