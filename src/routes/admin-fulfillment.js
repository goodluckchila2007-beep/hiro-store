"use strict";

/** Register the admin HTTP endpoints. Dependencies are supplied by the server composition root. */
module.exports = function registerAdminFulfillmentRoutes(context) {
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
};
