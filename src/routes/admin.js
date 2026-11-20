"use strict";

/** Register the admin HTTP endpoints. Dependencies are supplied by the server composition root. */
module.exports = function registerAdminRoutes(context) {
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
};
