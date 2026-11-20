"use strict";

/** Register the orders HTTP endpoints. Dependencies are supplied by the server composition root. */
module.exports = function registerOrdersRoutes(context) {
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
};
