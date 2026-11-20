"use strict";

/** Register the admin HTTP endpoints. Dependencies are supplied by the server composition root. */
module.exports = function registerAdminSettingsRoutes(context) {
    const {
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
        db,
        orderItemColumns,
        addOrderItemColumn,
        getSetting,
        setSetting,
        repairOldOrders,
        FZR_MLBB_PRODUCTS,
        FZR_PH_PRODUCTS,
        productsTableInfo,
        existingProductColumns,
        finalProductColumns,
        now,
        upsertFzrProduct,
        syncFzrProducts,
        FZR_API_URL,
        finance,
        mapFzrStatusToFulfillmentStatus,
        fzrFailureDetails,
        createFzrTopup,
        getFzrOrderStatus,
        fzrPollState,
        fzrCheckerRunning,
        FZR_POLL_BASE_DELAY,
        FZR_POLL_MAX_DELAY,
        FZR_POLL_MAX_FAILURES,
        checkPendingFzrOrders,
        escapeHtmlForEmail,
        sendFulfillmentFailureAlert,
        requireLogin,
        requireAdmin,
        computeOrderDisplayStatus,
        expireOldPendingOrders
    } = context;

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
};
