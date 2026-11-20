"use strict";

/** Register the admin HTTP endpoints. Dependencies are supplied by the server composition root. */
module.exports = function registerAdminManagementRoutes(context) {
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
