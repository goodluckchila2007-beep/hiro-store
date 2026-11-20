"use strict";

/** Register the reconciliation HTTP endpoints. Dependencies are supplied by the server composition root. */
module.exports = function registerReconciliationRoutes(context) {
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
};
