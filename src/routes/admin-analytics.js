"use strict";

/** Register the admin HTTP endpoints. Dependencies are supplied by the server composition root. */
module.exports = function registerAdminAnalyticsRoutes(context) {
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
};
