"use strict";

/** Register the store HTTP endpoints. Dependencies are supplied by the server composition root. */
module.exports = function registerStoreRoutes(context) {
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
};
