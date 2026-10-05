/* =========================================================
   HIRO STORE — ADMIN DASHBOARD
========================================================= */

(() => {
    "use strict";


    /* =====================================================
       CONFIG
    ===================================================== */

    // Match the storefront: allow the host page to override the API origin so
    // the dashboard works in production instead of pointing at localhost.
    // Set window.HIRO_API_URL only when the API is hosted separately.
    // Same-origin is the safe production default; do not fall back to
    // localhost in a deployed admin dashboard.
    const API_URL = window.HIRO_API_URL || window.location.origin;


    /* =========================================================
   CSRF PROTECTION
========================================================= */

    let CSRF_TOKEN = null;

    async function loadCsrfToken() {
        try {
            const response = await fetch(
                `${API_URL}/csrf-token`,
                {
                    credentials: "include"
                }
            );

            const data = await response.json();

            if (!response.ok || !data.csrfToken) {
                throw new Error("Unable to obtain CSRF token.");
            }

            CSRF_TOKEN = data.csrfToken;

        } catch (error) {
            console.error(
                "Could not load CSRF token:",
                error
            );
        }
    }

    async function apiFetch(url, options = {}) {

        if (!CSRF_TOKEN) {
            await loadCsrfToken();
        }

        const opts = {
            ...options,

            credentials: "include",

            headers: {
                ...(options.headers || {}),
                "X-CSRF-Token": CSRF_TOKEN
            }
        };

        let response = await fetch(url, opts);

        /*
         * If the session was regenerated and the old
         * token became invalid, get a fresh token once.
         */
        if (response.status === 403) {

            await loadCsrfToken();

            opts.headers["X-CSRF-Token"] =
                CSRF_TOKEN;

            response = await fetch(url, opts);
        }

        return response;
    }


    /* =====================================================
       STATE
    ===================================================== */
    let products = [];
    const productDrafts = new Map();
    let productCategory = "mobile_legends_global";
    let profitCategory = "mobile_legends_global";
    let profitPeriod = "7";
    let profitRequest = 0;
    let profitReport = null;
    let customers = [];

    let orders = [];
    let selectedOrder = null;
    let isLoadingOrders = false;


    /* =====================================================
       DOM HELPERS
    ===================================================== */

    const $ = (selector) =>
        document.querySelector(selector);


    const $$ = (selector) =>
        Array.from(document.querySelectorAll(selector));


    /* =====================================================
       FORMATTERS
    ===================================================== */

    function formatCurrency(amount) {

        const value = Number(amount);

        if (!Number.isFinite(value)) {
            return "₦0";
        }

        return "₦" + value.toLocaleString("en-NG");
    }


    function formatDate(date) {

        if (!date) {
            return "—";
        }

        const parsed = new Date(date);

        if (Number.isNaN(parsed.getTime())) {
            return "—";
        }

        return parsed.toLocaleString("en-NG", {
            dateStyle: "medium",
            timeStyle: "short"
        });
    }


    function escapeHTML(value) {

        return String(value ?? "").replace(
            /[&<>"']/g,
            char => ({
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#039;"
            })[char]
        );
    }


    /* =====================================================
       ORDER HELPERS
    ===================================================== */

    function getOrderTotal(order) {

        return Number(
            order?.orderTotal ??
            order?.order_total ??
            0
        );
    }


    function getAmountCharged(order) {

        return Number(
            order?.amountCharged ??
            order?.amount_charged ??
            0
        );
    }


    function getOrderId(order) {

        return String(
            order?.orderId ??
            order?.order_id ??
            "—"
        );
    }


    function getOrderStatus(order) {

        return String(
            order?.status ??
            "Unknown"
        );
    }


    function getPaymentStatus(order) {

        return String(
            order?.paymentStatus ??
            order?.payment_status ??
            order?.status ??
            "Pending"
        );
    }


    function getOrderDate(order) {

        return (
            order?.createdAt ??
            order?.created_at ??
            order?.paidAt ??
            order?.paid_at ??
            null
        );
    }


    function getItems(order) {

        return Array.isArray(order?.items)
            ? order.items
            : [];
    }


    function getCustomerEmail(order) {

        return (
            order?.email ??
            order?.customerEmail ??
            order?.customer_email ??
            "—"
        );
    }


    function getCustomerPhone(order) {

        return (
            order?.phone ??
            order?.customerPhone ??
            order?.customer_phone ??
            "—"
        );
    }


    function getReference(order) {

        return (
            order?.reference ??
            order?.paymentReference ??
            order?.payment_reference ??
            "—"
        );
    }


    function normalizeStatus(status) {

        return String(status || "")
            .trim()
            .toLowerCase();
    }


    function statusClass(status) {

        return normalizeStatus(status)
            .replace(/\s+/g, "-");
    }


    /* =====================================================
       TOAST
    ===================================================== */

    function showToast(message, type = "default") {

        const container =
            $("#adminToastContainer");

        if (!container) {
            return;
        }


        const toast =
            document.createElement("div");

        toast.className =
            `admin-toast ${type}`;


        toast.textContent =
            message;


        container.appendChild(toast);


        requestAnimationFrame(() => {
            toast.classList.add("show");
        });


        setTimeout(() => {

            toast.classList.remove("show");

            setTimeout(() => {
                toast.remove();
            }, 250);

        }, 3000);
    }


    /* =====================================================
       LOADING STATE
    ===================================================== */

    function setRefreshState(loading) {

        isLoadingOrders = loading;


        const refreshButtons = [
            $("#refreshBtn"),
            $("#heroRefreshBtn")
        ];


        refreshButtons.forEach(button => {

            if (!button) {
                return;
            }


            button.disabled =
                loading;


            const refreshIcon =
                button.querySelector(
                    ".refresh-icon"
                );


            if (refreshIcon) {

                refreshIcon.classList.toggle(
                    "spinning",
                    loading
                );
            }
        });
    }

    /* =====================================================
       LOAD ADMIN CUSTOMERS
    ===================================================== */

    async function loadCustomers() {

        try {

            const response = await fetch(
                `${API_URL}/api/admin/customers`,
                {
                    credentials: "include"
                }
            );


            const data =
                await response.json();


            if (!response.ok || !data.success) {

                throw new Error(
                    data.message ||
                    "Unable to load customers."
                );

            }


            customers =
                Array.isArray(data.customers)
                    ? data.customers
                    : [];


            console.log(
                "Admin customers loaded:",
                customers
            );


            renderCustomers();

        } catch (error) {

            console.error(
                "Could not load customers:",
                error
            );

            showToast(
                "Could not load customers."
            );

        }

    }


    /* =====================================================
   LOAD ADMIN PRODUCTS
===================================================== */

    async function loadProducts() {

        try {

            const response = await fetch(
                `${API_URL}/api/admin/products`,
                {
                    credentials: "include"
                }
            );


            const data =
                await response.json();


            if (!response.ok || !data.success) {

                throw new Error(
                    data.message ||
                    "Unable to load products."
                );

            }


            products =
                Array.isArray(data.products)
                    ? data.products
                    : [];


            console.log(
                "Admin products loaded:",
                products
            );


            renderProducts();

        } catch (error) {

            console.error(
                "Could not load products:",
                error
            );

            showToast(
                "Could not load products."
            );

        }

    }

    /* =====================================================
       LOAD ORDERS
    ===================================================== */

    async function loadOrders(
        showMessage = true
    ) {
        if (isLoadingOrders) {
            return;
        }

        setRefreshState(true);

        if (showMessage) {
            showToast(
                "Loading orders..."
            );
        }

        try {
            const response =
                await fetch(
                    `${API_URL}/api/admin/orders`,
                    {
                        method: "GET",
                        credentials: "include",
                        headers: {
                            "Accept":
                                "application/json"
                        }
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {
                throw new Error(
                    data.message ||
                    "Unable to load orders."
                );
            }

            orders =
                Array.isArray(data.orders)
                    ? data.orders
                    : [];

            renderEverything();

            if (showMessage) {
                showToast(
                    `${orders.length} order(s) loaded.`,
                    "success"
                );
            }

        } catch (error) {
            console.error(
                "Could not load admin orders:",
                error
            );

            showToast(
                "Could not load admin orders.",
                "error"
            );

        } finally {
            setRefreshState(false);
        }
    }


    /* =====================================================
       RENDER EVERYTHING
    ===================================================== */

    function renderEverything() {

        renderDashboard();

        renderOrders();

        renderProcessing();

        renderCompleted();

        renderRefunded();

        renderCustomers();

        updateNavigationCounts();

        updateMiniStats();

        updatePageData();
    }


    /* =====================================================
       DASHBOARD
    ===================================================== */
    function renderDashboard() {
        const analytics =
            window.hiroAnalytics || {};

        const totalOrders =
            Number(
                analytics.totalOrders ||
                orders.length
            );

        const totalRevenue =
            Number(
                analytics.money?.totalRevenue ||
                0
            );

        const profit =
            Number(
                analytics.money?.grossProfit ||
                0
            );

        const todaySales =
            Number(
                analytics.money?.todayRevenue ||
                0
            );

        const pendingOrders =
            Number(
                analytics.orders?.pending ||
                0
            );

        const processing =
            orders.filter(
                order =>
                    normalizeStatus(
                        getOrderStatus(order)
                    ) === "processing"
            ).length;

        const completed =
            orders.filter(
                order =>
                    normalizeStatus(
                        getOrderStatus(order)
                    ) === "completed"
            ).length;

        setText(
            "#totalOrders",
            totalOrders
        );

        setText(
            "#totalRevenue",
            formatCurrency(totalRevenue)
        );

        setText(
            "#processingOrders",
            processing
        );

        setText(
            "#completedOrders",
            completed
        );

        setText(
            "#dashboardRevenue",
            formatCurrency(totalRevenue)
        );

        setText(
            "#dashboardOrderCount",
            totalOrders
        );

        setText(
            "#todaySales",
            formatCurrency(todaySales)
        );

        setText(
            "#pendingOrders",
            pendingOrders
        );

        setText(
            "#profit",
            formatCurrency(profit)
        );

        renderRecentOrders();
    }


    function getProductCategory(product) {
        const title =
            String(
                product?.title || ""
            ).toLowerCase();

        if (
            title.includes("pass")
        ) {
            return "passes";
        }

        if (
            title.includes("bonus")
        ) {
            return "bonuses";
        }

        return "diamonds";
    }


    /* =====================================================
       RECENT ORDERS
    ===================================================== */

    function renderRecentOrders() {

        const container =
            $("#recentOrders");

        if (!container) {
            return;
        }


        if (!orders.length) {

            container.innerHTML = `
                <div class="empty-state">

                    <div class="empty-icon">
                        🧾
                    </div>

                    <h4>
                        No orders yet
                    </h4>

                    <p>
                        Customer orders will appear here.
                    </p>

                </div>
            `;

            return;
        }


        const recent =
            [...orders]
                .sort(
                    (a, b) =>
                        new Date(
                            getOrderDate(b)
                        ) -
                        new Date(
                            getOrderDate(a)
                        )
                )
                .slice(0, 5);


        container.innerHTML =
            recent.map(order => {

                const items =
                    getItems(order);


                const firstItem =
                    items[0];


                const itemText =
                    firstItem
                        ? `${firstItem.title || "Product"}${items.length > 1
                            ? ` + ${items.length - 1} more`
                            : ""
                        }`
                        : "No item";


                return `
                    <div
                        class="recent-order-row"
                        data-order-id="${escapeHTML(
                    getOrderId(order)
                )}"
                    >

                        <div class="recent-order-info">

                            <strong>
                                ${escapeHTML(
                    getOrderId(order)
                )}
                            </strong>

                            <small>
                                ${escapeHTML(
                    itemText
                )}
                            </small>

                        </div>


                        <div class="recent-order-money">

                            <strong>
                                ${formatCurrency(
                    getAmountCharged(order)
                )}
                            </strong>

                            <small>
                                Charged
                            </small>

                        </div>

                    </div>
                `;

            }).join("");
    }


    /* =====================================================
       ORDERS TABLE
    ===================================================== */

    function renderOrders() {

        const tbody =
            $("#ordersTableBody");

        if (!tbody) {
            return;
        }


        const search =
            (
                $("#orderSearch")?.value ||
                ""
            )
                .trim()
                .toLowerCase();


        const status =
            $("#statusFilter")?.value ||
            "all";


        const dateFilter =
            $("#dateFilter")?.value ||
            "all";


        let filtered =
            orders.filter(order => {


                /* SEARCH */

                if (search) {

                    const searchable = [

                        getOrderId(order),

                        getReference(order),

                        getCustomerEmail(order),

                        getCustomerPhone(order),

                        ...getItems(order).map(
                            item =>
                                item?.playerId
                        ),

                        ...getItems(order).map(
                            item =>
                                item?.serverId
                        ),

                        ...getItems(order).map(
                            item =>
                                item?.title
                        )

                    ]
                        .filter(Boolean)
                        .join(" ")
                        .toLowerCase();


                    if (
                        !searchable.includes(
                            search
                        )
                    ) {
                        return false;
                    }
                }




                /* STATUS */

                if (
                    status !== "all" &&
                    normalizeStatus(
                        getOrderStatus(order)
                    ) !==
                    normalizeStatus(status)
                ) {
                    return false;
                }


                /* DATE */

                if (
                    !matchesDateFilter(
                        order,
                        dateFilter
                    )
                ) {
                    return false;
                }


                return true;
            });

        /*
         * When no explicit status filter is chosen, show every order
         * (Paid, Pending, Processing, Completed, Refunded, Failed...).
         * Previously the table was hard-limited to active orders, which
         * made the Orders table look empty.
         */


        setText(
            "#ordersResultCount",
            `${filtered.length} result${filtered.length === 1
                ? ""
                : "s"
            }`
        );


        if (!filtered.length) {

            tbody.innerHTML = `
                <tr>

                    <td
                        colspan="8"
                        class="table-empty"
                    >

                        <div class="empty-state">

                            <div class="empty-icon">
                                🧾
                            </div>

                            <h4>
                                No matching orders
                            </h4>

                            <p>
                                Try changing your search or filters.
                            </p>

                        </div>

                    </td>

                </tr>
            `;

            return;
        }


        tbody.innerHTML =
            filtered.map(
                createOrderTableRow
            ).join("");
    }


    /* =====================================================
       DATE FILTER
    ===================================================== */

    function matchesDateFilter(
        order,
        filter
    ) {

        if (
            filter === "all"
        ) {
            return true;
        }


        const orderDate =
            new Date(
                getOrderDate(order)
            );


        if (
            Number.isNaN(
                orderDate.getTime()
            )
        ) {
            return false;
        }


        const now =
            new Date();


        if (
            filter === "today"
        ) {

            return (
                orderDate.toDateString() ===
                now.toDateString()
            );
        }


        const difference =
            now.getTime() -
            orderDate.getTime();


        if (
            filter === "week"
        ) {

            const sevenDays =
                7 *
                24 *
                60 *
                60 *
                1000;


            return (
                difference >= 0 &&
                difference <= sevenDays
            );
        }


        if (
            filter === "month"
        ) {

            const thirtyDays =
                30 *
                24 *
                60 *
                60 *
                1000;


            return (
                difference >= 0 &&
                difference <= thirtyDays
            );
        }


        return true;
    }


    /* =====================================================
       ORDER TABLE ROW
    ===================================================== */

    function createOrderTableRow(
        order
    ) {

        const items =
            getItems(order);


        const firstItem =
            items[0];


        const orderId =
            getOrderId(order);


        const orderTotal =
            getOrderTotal(order);


        const charged =
            getAmountCharged(order);


        const status =
            getOrderStatus(order);


        const purchase =
            firstItem
                ? `
                    <strong>
                        ${escapeHTML(
                    firstItem.title ||
                    "Product"
                )}
                    </strong>

                    ${items.length > 1
                    ? `
                                <small class="table-muted">
                                    + ${items.length - 1} more
                                </small>
                            `
                    : ""
                }

                    ${firstItem.playerId ||
                    firstItem.serverId
                    ? `
                                <small class="table-muted">
                                    Player:
                                    ${escapeHTML(
                        firstItem.playerId ||
                        "—"
                    )}

                                    ·

                                    Server:
                                    ${escapeHTML(
                        firstItem.serverId ||
                        "—"
                    )}
                                </small>
                            `
                    : ""
                }
                `
                : "—";


        return `
            <tr>

                <!-- ORDER TOTAL -->

                <td>

                    <strong>
                        ${escapeHTML(
            orderId
        )}
                    </strong>

                    <small class="table-muted">
                        ${escapeHTML(
            getReference(order)
        )}
                    </small>

                </td>


                <!-- CHARGED -->

                <td>

                    <strong class="charged-amount">
                        ${formatCurrency(
            charged
        )}
                    </strong>

                </td>


                <!-- CUSTOMER -->

                <td>

                    <strong>
                        ${escapeHTML(
            getCustomerEmail(order)
        )}
                    </strong>

                    <small class="table-muted">
                        ${escapeHTML(
            getCustomerPhone(order)
        )}
                    </small>

                </td>


                <!-- PURCHASE -->

                <td>
                    ${purchase}
                </td>


                <!-- AMOUNT -->

                <td>

                    <strong>
                        ${formatCurrency(
            orderTotal
        )}
                    </strong>

                </td>


                <!-- STATUS -->

                <td>

                    <span
                        class="status-badge ${escapeHTML(
            statusClass(status)
        )}"
                    >
                        ${escapeHTML(
            status
        )}
                    </span>

                </td>


                <!-- DATE -->

                <td>

                    <span class="order-date">
                        ${escapeHTML(
            formatDate(
                getOrderDate(order)
            )
        )}
                    </span>

                </td>


                <!-- ACTION -->

                <td>

                    <button
                        class="order-action-btn"
                        data-view-order="${escapeHTML(
            orderId
        )}"
                        type="button"
                    >
                        View
                    </button>

                </td>

            </tr>
        `;
    }


    /* =====================================================
       PROCESSING
    ===================================================== */

    function renderProcessing() {

        const container =
            $("#processingOrdersList");

        if (!container) {
            return;
        }


        const processing =
            orders.filter(
                order =>
                    normalizeStatus(
                        getOrderStatus(order)
                    ) === "processing"
            );


        setText(
            "#processingSummaryCount",
            processing.length
        );


        if (!processing.length) {

            container.innerHTML = `
                <div class="empty-state">

                    <div class="empty-icon">
                        ◷
                    </div>

                    <h4>
                        Nothing processing
                    </h4>

                    <p>
                        Orders requiring fulfillment will appear here.
                    </p>

                </div>
            `;

            return;
        }


        container.innerHTML =
            processing
                .map(createOrderCard)
                .join("");
    }


    /* =====================================================
       COMPLETED
    ===================================================== */

    function renderCompleted() {

        const container =
            $("#completedOrdersList");

        if (!container) {
            return;
        }


        const completed =
            orders.filter(
                order =>
                    normalizeStatus(
                        getOrderStatus(order)
                    ) === "completed"
            );


        setText(
            "#completedSummaryCount",
            completed.length
        );


        if (!completed.length) {

            container.innerHTML = `
                <div class="empty-state">

                    <div class="empty-icon">
                        ✓
                    </div>

                    <h4>
                        No completed orders
                    </h4>

                    <p>
                        Completed orders will appear here.
                    </p>

                </div>
            `;

            return;
        }


        container.innerHTML =
            completed
                .map(createOrderCard)
                .join("");
    }


    /* =====================================================
   REFUNDED
===================================================== */

    function renderRefunded() {

        const container =
            $("#refundedOrdersList");

        if (!container) {
            return;
        }


        const refunded =
            orders.filter(
                order =>
                    normalizeStatus(
                        getOrderStatus(order)
                    ) === "refunded"
            );


        setText(
            "#refundedSummaryCount",
            refunded.length
        );


        if (!refunded.length) {

            container.innerHTML = `
            <div class="empty-state">

                <div class="empty-icon">
                    💰
                </div>

                <h4>
                    No refunded orders
                </h4>

                <p>
                    Refunded orders will appear here.
                </p>

            </div>
        `;

            return;
        }


        container.innerHTML =
            refunded
                .map(createOrderCard)
                .join("");
    }

    /* =====================================================
       ORDER CARD
    ===================================================== */

    function createOrderCard(order) {

        const items =
            getItems(order);


        const status =
            getOrderStatus(order);


        return `
            <div
                class="dashboard-panel order-card"
            >

                <div class="order-card-header">

                    <div>

                        <strong>
                            ${escapeHTML(
            getOrderId(order)
        )}
                        </strong>

                        <small>
                            ${escapeHTML(
            formatDate(
                getOrderDate(order)
            )
        )}
                        </small>

                    </div>


                    <span
                        class="status-badge ${escapeHTML(
            statusClass(status)
        )}"
                    >
                        ${escapeHTML(status)}
                    </span>

                </div>


                <div class="order-card-items">

                    ${items.length
                ? items.map(
                    item => `
                                    <div class="order-card-item">

                                        <strong>
                                            ${escapeHTML(
                        item?.title ||
                        "Product"
                    )}
                                        </strong>

                                        <small>

                                            Quantity:
                                            ${Number(
                        item?.qty || 1
                    )}

                                            ·

                                            Price:
                                            ${formatCurrency(
                        item?.price
                    )}

                                            ·

                                            Player:
                                            ${escapeHTML(
                        item?.playerId ||
                        "—"
                    )}

                                            ·

                                            Server:
                                            ${escapeHTML(
                        item?.serverId ||
                        "—"
                    )}

                                        </small>

                                    </div>
                                `
                ).join("")
                : `
                                <div class="order-card-item">
                                    <small>
                                        No items recorded.
                                    </small>
                                </div>
                            `
            }

                </div>


                <div class="order-card-footer">

                    <div>

                        <strong>
                            ${formatCurrency(
                getOrderTotal(order)
            )}
                        </strong>

                        <small>
                            Charged:
                            ${formatCurrency(
                getAmountCharged(order)
            )}
                        </small>

                    </div>


                    <button
                        class="order-action-btn"
                        data-view-order="${escapeHTML(
                getOrderId(order)
            )}"
                        type="button"
                    >
                        View Order
                    </button>

                </div>

            </div>
        `;
    }


    /* =====================================================
       NAVIGATION COUNTS
    ===================================================== */

    function updateNavigationCounts() {
        // Compute pending (live) orders the same way renderOrders uses "active" orders:
        const pendingOrders = orders.filter(order => {
            const st = normalizeStatus(getOrderStatus(order));
            return st === "paid" || st === "processing" || st === "pending";
        }).length;

        setText("#navOrderCount", pendingOrders);


        const processing =
            orders.filter(
                order =>
                    normalizeStatus(
                        getOrderStatus(order)
                    ) === "processing"
            ).length;


        setText(
            "#navProcessingCount",
            processing
        );
    }


    /* =====================================================
       ORDERS MINI STATS
    ===================================================== */

    function updateMiniStats() {

        const paid =
            orders.filter(
                order =>
                    normalizeStatus(
                        getOrderStatus(order)
                    ) === "paid"
            ).length;


        const processing =
            orders.filter(
                order =>
                    normalizeStatus(
                        getOrderStatus(order)
                    ) === "processing"
            ).length;


        const completed =
            orders.filter(
                order =>
                    normalizeStatus(
                        getOrderStatus(order)
                    ) === "completed"
            ).length;


        setText(
            "#ordersTotalMini",
            orders.length
        );


        setText(
            "#ordersPaidMini",
            paid
        );


        setText(
            "#ordersProcessingMini",
            processing
        );


        setText(
            "#ordersCompletedMini",
            completed
        );
    }


    /* =====================================================
       CUSTOMERS
    ===================================================== */

    function renderCustomers() {
        const totalCustomers =
            customers.length;

        const totalSpend =
            customers.reduce(
                (sum, customer) =>
                    sum +
                    Number(
                        customer.totalSpending || 0
                    ),
                0
            );

        const returning =
            customers.filter(
                customer =>
                    Number(
                        customer.orderCount || 0
                    ) > 1
            ).length;

        setText(
            "#totalCustomers",
            totalCustomers
        );

        setText(
            "#customerSpend",
            formatCurrency(totalSpend)
        );

        setText(
            "#returningCustomers",
            returning
        );

        renderCustomerList(
            customers
        );
    }

    /* =====================================================
       COMPLAINTS
    ===================================================== */

    let allComplaints = [];
    let activeAdminComplaintId = null;

    async function loadSupportConversations() {
        const container = $("#complaintsList");
        if (!container) return;

        try {
            const response = await apiFetch(`${API_URL}/api/admin/support/conversations`, { credentials: "include" });
            const data = await response.json();

            if (!data.success) {
                container.innerHTML = `<div class="empty-state"><p>Unable to load conversations.</p></div>`;
                return;
            }

            allComplaints = data.conversations || [];

            const complaintAlertBadge = document.getElementById("complaintAlertBadge");
            const openComplaintCount = allComplaints.filter(c => c.status === "Open").length;
            if (complaintAlertBadge) {
                complaintAlertBadge.textContent = openComplaintCount > 99 ? "99+" : String(openComplaintCount);
                complaintAlertBadge.hidden = openComplaintCount === 0;
                complaintAlertBadge.title = `${openComplaintCount} open support conversation${openComplaintCount === 1 ? "" : "s"}`;
            }

            if (!allComplaints.length) {
                container.innerHTML = `
                    <div class="empty-state">
                        <div class="empty-icon">💬</div>
                        <h4>No conversations yet</h4>
                        <p>Customer support chats will appear here.</p>
                    </div>
                `;
                return;
            }

            container.innerHTML = allComplaints.map(c => `
                <div class="inbox-list-item ${c.id === activeAdminComplaintId ? "active" : ""}" data-open-thread="${c.id}">
                    <strong>${escapeHTML(c.customerName || c.customerEmail || "Unknown")}</strong>
                    <small>${c.orderId ? "Order: " + escapeHTML(c.orderId) + " · " : ""}${escapeHTML(c.status)}</small>
                    <p>${escapeHTML(c.lastMessage || "")}</p>
                </div>
            `).join("");

        } catch (error) {
            container.innerHTML = `<div class="empty-state"><p>Network error loading conversations.</p></div>`;
        }
    }

    async function openAdminThread(conversationId) {
        activeAdminComplaintId = Number(conversationId);
        const conversation = allComplaints.find(c => c.id === activeAdminComplaintId);
        if (!conversation) return;

        loadSupportConversations();

        const panel = document.getElementById("inboxThreadPanel");
        panel.innerHTML = `
            <div class="inbox-thread-header">
                <div>
                    <strong>${escapeHTML(conversation.customerName || conversation.customerEmail || "Unknown")}</strong>
                    <div style="font-size:12px;color:rgba(255,255,255,0.5);">
                        ${conversation.orderId ? "Order: " + escapeHTML(conversation.orderId) : "General inquiry"}
                        &middot; ${escapeHTML(conversation.status)}
                    </div>
                </div>
                <button type="button" id="resolveConversationBtn" class="btn-retry" ${conversation.status === "Resolved" ? "disabled" : ""}>
                    ${conversation.status === "Resolved" ? "Resolved" : "Mark Resolved"}
                </button>
            </div>
            <div class="inbox-thread-messages" id="adminThreadMessages">
                <p>Loading...</p>
            </div>
            <div class="inbox-thread-input">
                <textarea id="adminReplyInput" rows="2" placeholder="Reply to customer..."></textarea>
                <button type="button" id="adminSendReplyBtn" class="btn-retry">Send</button>
            </div>
        `;

        loadAdminThreadMessages(activeAdminComplaintId);
    }

    async function loadAdminThreadMessages(conversationId) {
        const box = document.getElementById("adminThreadMessages");
        if (!box) return;

        try {
            const response = await apiFetch(`${API_URL}/api/admin/support/conversations/${conversationId}/messages`, { credentials: "include" });
            const data = await response.json();

            if (!data.success || !data.messages.length) {
                box.innerHTML = `<p>No messages yet.</p>`;
                return;
            }

            box.innerHTML = data.messages.map(msg => `
                <div class="chat-bubble ${msg.sender_role === "admin" ? "chat-bubble-mine" : "chat-bubble-theirs"}">
                    <strong>${escapeHTML(msg.sender_name)}</strong>
                    <p>${escapeHTML(msg.message)}</p>
                </div>
            `).join("");

            box.scrollTop = box.scrollHeight;

        } catch (error) {
            box.innerHTML = `<p>Could not load messages.</p>`;
        }
    }

    document.addEventListener("click", async event => {
        const listItem = event.target.closest("[data-open-thread]");
        if (listItem) {
            openAdminThread(listItem.dataset.openThread);
            return;
        }

        if (event.target.id === "adminSendReplyBtn") {
            const input = document.getElementById("adminReplyInput");
            const message = input.value.trim();
            if (!message) return;

            try {
                const response = await apiFetch(`${API_URL}/api/admin/support/conversations/${activeAdminComplaintId}/messages`, {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ message })
                });

                const data = await response.json();

                if (!data.success) {
                    showToast(data.message || "Could not send reply.", "error");
                    return;
                }

                input.value = "";
                loadAdminThreadMessages(activeAdminComplaintId);

            } catch (error) {
                showToast("Network error sending reply.", "error");
            }
            return;
        }

        if (event.target.id === "resolveConversationBtn") {
            try {
                await apiFetch(`${API_URL}/api/admin/support/conversations/${activeAdminComplaintId}`, {
                    method: "PATCH",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ status: "Resolved" })
                });

                showToast("Conversation marked as resolved.", "success");
                loadSupportConversations();
                openAdminThread(activeAdminComplaintId);

            } catch (error) {
                showToast("Network error resolving conversation.", "error");
            }
        }
    });


    // Keep the sidebar complaint badge current while the admin dashboard stays open.
    setInterval(() => {
        if (!document.hidden) loadSupportConversations();
    }, 60000);

    /* =====================================================
           LOAD ADMIN SETTINGS
        ===================================================== */

    async function loadSettings() {
        try {
            const response = await apiFetch(`${API_URL}/api/admin/settings`, { credentials: "include" });
            const data = await response.json();

            if (data.success) {
                document.getElementById("maintenanceModeToggle").checked = data.maintenanceMode;
                document.getElementById("usdNgnRateInput").value = data.usdNgnRate;
                document
                    .getElementById(
                        "paymentsEnabledToggle"
                    ).checked =
                    Boolean(
                        data.paymentsEnabled
                    );

                document
                    .getElementById(
                        "autoFulfillmentToggle"
                    ).checked =
                    Boolean(
                        data.autoFulfillmentEnabled
                    );

                document
                    .getElementById(
                        "maxQuantityInput"
                    ).value =
                    Number(
                        data.maxQuantity || 20
                    );

                document
                    .getElementById(
                        "pendingOrderExpiryInput"
                    ).value =
                    Number(
                        data.pendingOrderExpiryHours ||
                        24
                    );

                document
                    .getElementById(
                        "storeAnnouncementInput"
                    ).value =
                    data.storeAnnouncement || "";

                document
                    .getElementById(
                        "notificationsEnabledToggle"
                    ).checked =
                    Boolean(
                        data.notificationsEnabled
                    );

                document
                    .getElementById(
                        "notifyFailedFulfillmentToggle"
                    ).checked =
                    Boolean(
                        data.notifyFailedFulfillment
                    );

                document
                    .getElementById(
                        "notifyNewComplaintToggle"
                    ).checked =
                    Boolean(
                        data.notifyNewComplaint
                    );

                document
                    .getElementById(
                        "notifyPaymentErrorToggle"
                    ).checked =
                    Boolean(
                        data.notifyPaymentError
                    );

                document
                    .getElementById(
                        "notifyPaidOrderToggle"
                    ).checked =
                    Boolean(
                        data.notifyPaidOrder
                    );

                document
                    .getElementById(
                        "notificationEmailInput"
                    ).value =
                    data.notificationEmail || "";

                window.hiroSettings =
                    data;
            }
        } catch (error) {
            showToast("Unable to load settings.", "error");
        }

        loadSystemStatus();
        renderStoreOperations();
    }

    function renderStoreOperations() {

        const container =
            document.getElementById(
                "storeOperationsList"
            );

        if (!container) {
            return;
        }


        const settings =
            window.hiroSettings || {};

        const analytics =
            window.hiroAnalytics || {};

        const orders =
            analytics.orders || {};

        const fulfillment =
            analytics.fulfillment || {};


        const paymentsEnabled =
            settings.paymentsEnabled !== false;

        const autoFulfillmentEnabled =
            settings.autoFulfillmentEnabled !== false;

        const exchangeRate =
            Number(
                settings.usdNgnRate || 0
            );

        const maxQuantity =
            Number(
                settings.maxQuantity || 0
            );

        const expiryHours =
            Number(
                settings.pendingOrderExpiryHours ||
                0
            );

        const announcement =
            String(
                settings.storeAnnouncement ||
                ""
            ).trim();


        const rows = [

            {
                label:
                    "Payments",

                value:
                    paymentsEnabled
                        ? "Enabled"
                        : "Disabled",

                state:
                    paymentsEnabled
                        ? "ok"
                        : "warning"
            },


            {
                label:
                    "Automatic Fulfillment",

                value:
                    autoFulfillmentEnabled
                        ? "Enabled"
                        : "Disabled",

                state:
                    autoFulfillmentEnabled
                        ? "ok"
                        : "warning"
            },


            {
                label:
                    "Pending Checkouts",

                value:
                    String(
                        Number(
                            orders.pending || 0
                        )
                    ),

                state:
                    Number(
                        orders.pending || 0
                    ) > 5
                        ? "warning"
                        : "ok"
            },


            {
                label:
                    "Processing Fulfillments",

                value:
                    String(
                        Number(
                            fulfillment.processing ||
                            0
                        )
                    ),

                state:
                    Number(
                        fulfillment.processing ||
                        0
                    ) > 0
                        ? "warning"
                        : "ok"
            },


            {
                label:
                    "Failed Fulfillments",

                value:
                    String(
                        Number(
                            fulfillment.failed ||
                            0
                        )
                    ),

                state:
                    Number(
                        fulfillment.failed ||
                        0
                    ) > 0
                        ? "bad"
                        : "ok"
            },


            {
                label:
                    "USD → NGN Rate",

                value:
                    exchangeRate > 0
                        ? `₦${exchangeRate.toLocaleString(
                            "en-NG"
                        )}`
                        : "Not set",

                state:
                    exchangeRate > 0
                        ? "ok"
                        : "warning"
            },


            {
                label:
                    "Maximum Quantity",

                value:
                    maxQuantity > 0
                        ? String(maxQuantity)
                        : "Not set",

                state:
                    maxQuantity > 0
                        ? "ok"
                        : "warning"
            },


            {
                label:
                    "Pending Order Expiry",

                value:
                    expiryHours > 0
                        ? `${expiryHours} hour${expiryHours === 1
                            ? ""
                            : "s"
                        }`
                        : "Not set",

                state:
                    expiryHours > 0
                        ? "ok"
                        : "warning"
            },


            {
                label:
                    "Store Announcement",

                value:
                    announcement
                        ? "Active"
                        : "None",

                state:
                    announcement
                        ? "ok"
                        : "neutral"
            }

        ];


        container.innerHTML =
            rows
                .map(row => {

                    let dotClass =
                        "ok";

                    if (
                        row.state ===
                        "bad"
                    ) {
                        dotClass =
                            "bad";
                    }

                    else if (
                        row.state ===
                        "warning"
                    ) {
                        dotClass =
                            "warning";
                    }

                    else if (
                        row.state ===
                        "neutral"
                    ) {
                        dotClass =
                            "neutral";
                    }


                    return `
                    <div class="status-row">

                        <span>

                            <span
                                class="status-dot ${dotClass}"
                            ></span>

                            ${escapeHTML(
                        row.label
                    )}

                        </span>

                        <span>
                            ${escapeHTML(
                        row.value
                    )}
                        </span>

                    </div>
                `;
                })
                .join("");
    }

    async function loadSystemStatus() {
        const container =
            document.getElementById(
                "systemStatusList"
            );

        if (!container) return;

        try {
            const response =
                await apiFetch(
                    `${API_URL}/api/admin/system-status`,
                    {
                        credentials:
                            "include"
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {
                container.innerHTML =
                    `<p>Unable to load system status.</p>`;

                return;
            }

            const system =
                data.system || {};

            const paystackOk =
                Boolean(
                    system.paystack
                        ?.configured
                );

            const fzrOk =
                Boolean(
                    system.fzr
                        ?.configured
                );

            const smtpStatus =
                system.smtp
                    ?.status ||
                "unknown";

            const smtpOk =
                smtpStatus ===
                "ready";

            const databaseOk =
                system.database
                    ?.status ===
                "healthy";

            const productionOk =
                system.environment ===
                "production";

            let webhookText =
                "Never received";

            if (
                system.lastPaystackWebhook
            ) {
                const date =
                    new Date(
                        system.lastPaystackWebhook
                    );

                webhookText =
                    Number.isNaN(
                        date.getTime()
                    )
                        ? system.lastPaystackWebhook
                        : date.toLocaleString(
                            "en-NG"
                        );
            }

            const rows = [
                {
                    label:
                        "Database",
                    ok:
                        databaseOk,
                    value:
                        databaseOk
                            ? "Healthy"
                            : "Error"
                },

                {
                    label:
                        "Paystack",
                    ok:
                        paystackOk,
                    value:
                        paystackOk
                            ? "Configured"
                            : "Missing"
                },

                {
                    label:
                        "FZR Supplier API",
                    ok:
                        fzrOk,
                    value:
                        fzrOk
                            ? "Configured"
                            : "Missing"
                },

                {
                    label:
                        "Email (SMTP)",
                    ok:
                        smtpOk,
                    value:
                        smtpOk
                            ? "Ready"
                            : smtpStatus ===
                                "error"
                                ? "Error"
                                : "Checking"
                },

                {
                    label:
                        "Environment",
                    ok:
                        productionOk,
                    value:
                        productionOk
                            ? "Production"
                            : "Development"
                }
            ];

            container.innerHTML =
                rows
                    .map(
                        row => `
                        <div class="status-row">

                            <span>
                                <span
                                    class="status-dot ${row.ok
                                ? "ok"
                                : "bad"
                            }"
                                ></span>

                                ${escapeHTML(
                                row.label
                            )}
                            </span>

                            <span>
                                ${escapeHTML(
                                row.value
                            )}
                            </span>

                        </div>
                    `
                    )
                    .join("")
                +

                `
                    <div class="status-row">

                        <span>
                            <span
                                class="status-dot ${system.lastPaystackWebhook
                    ? "ok"
                    : "bad"
                }"
                            ></span>

                            Last Paystack Webhook
                        </span>

                        <span>
                            ${escapeHTML(
                    webhookText
                )}
                        </span>

                    </div>
                `;

        } catch (error) {

            console.error(
                "System status load failed:",
                error
            );

            container.innerHTML =
                `<p>Network error loading system status.</p>`;
        }
    }

    function setSystemStatus(
        id,
        text,
        state
    ) {

        const element =
            document.getElementById(id);

        if (!element) {
            return;
        }

        element.textContent =
            text;


        element.classList.remove(
            "status-good",
            "status-warning",
            "status-bad"
        );


        if (state === "good") {

            element.classList.add(
                "status-good"
            );

        } else if (
            state === "bad"
        ) {

            element.classList.add(
                "status-bad"
            );

        } else {

            element.classList.add(
                "status-warning"
            );
        }
    }

    document.getElementById("saveSettingsBtn")
        ?.addEventListener("click", async () => {
            const btn = document.getElementById("saveSettingsBtn");
            btn.disabled = true;

            try {
                const response = await apiFetch(`${API_URL}/api/admin/settings`, {
                    method: "PATCH",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({

                        maintenanceMode:
                            document
                                .getElementById(
                                    "maintenanceModeToggle"
                                )
                                .checked,

                        usdNgnRate:
                            Number(
                                document
                                    .getElementById(
                                        "usdNgnRateInput"
                                    )
                                    .value
                            ),

                        paymentsEnabled:
                            document
                                .getElementById(
                                    "paymentsEnabledToggle"
                                )
                                .checked,

                        autoFulfillmentEnabled:
                            document
                                .getElementById(
                                    "autoFulfillmentToggle"
                                )
                                .checked,

                        maxQuantity:
                            Number(
                                document
                                    .getElementById(
                                        "maxQuantityInput"
                                    )
                                    .value
                            ),

                        pendingOrderExpiryHours:
                            Number(
                                document
                                    .getElementById(
                                        "pendingOrderExpiryInput"
                                    )
                                    .value
                            ),

                        storeAnnouncement:
                            document
                                .getElementById(
                                    "storeAnnouncementInput"
                                )
                                .value
                                .trim(),

                        notificationsEnabled:
                            document
                                .getElementById(
                                    "notificationsEnabledToggle"
                                )
                                .checked,

                        notifyFailedFulfillment:
                            document
                                .getElementById(
                                    "notifyFailedFulfillmentToggle"
                                )
                                .checked,

                        notifyNewComplaint:
                            document
                                .getElementById(
                                    "notifyNewComplaintToggle"
                                )
                                .checked,

                        notifyPaymentError:
                            document
                                .getElementById(
                                    "notifyPaymentErrorToggle"
                                )
                                .checked,

                        notifyPaidOrder:
                            document
                                .getElementById(
                                    "notifyPaidOrderToggle"
                                )
                                .checked,

                        notificationEmail:
                            document
                                .getElementById(
                                    "notificationEmailInput"
                                )
                                .value
                                .trim()
                    })
                });

                const data = await response.json();

                if (!data.success) {
                    showToast(data.message || "Unable to save settings.", "error");
                    btn.disabled = false;
                    return;
                }

                showToast("Settings saved.", "success");
                await loadSettings();
                btn.disabled = false;

            } catch (error) {
                showToast("Network error saving settings.", "error");
                btn.disabled = false;
            }
        });

    document
        .getElementById(
            "saveNotificationSettingsBtn"
        )
        ?.addEventListener(
            "click",
            () => {

                document
                    .getElementById(
                        "saveSettingsBtn"
                    )
                    ?.click();
            }
        );


    /* =====================================================
       CUSTOMER LIST
    ===================================================== */

    function renderCustomerList(
        customers
    ) {

        const container =
            $("#customersList");

        if (!container) {
            return;
        }


        if (!customers.length) {

            container.innerHTML = `
                <div class="empty-state">

                    <div class="empty-icon">
                        ♙
                    </div>

                    <h4>
                        No customers loaded
                    </h4>

                    <p>
                        Customer information will appear here.
                    </p>

                </div>
            `;

            return;
        }


        const sorted = [...customers].sort((a, b) => {
            // Sort by total spending (numeric). Fall back to 0 when missing.
            return Number(b.totalSpending || 0) - Number(a.totalSpending || 0);
        });


        container.innerHTML =
            sorted.map(
                customer => `
                    <div class="customer-row" data-customer-email="${escapeHTML(customer.email)}" role="button" tabindex="0">

                        <div class="customer-row-avatar">
                            ${escapeHTML(
                    customer.email
                        .charAt(0)
                        .toUpperCase()
                )}
                        </div>


                        <div class="customer-row-info">

                            <strong>
                                ${escapeHTML(
                    customer.email
                )}
                            </strong>

                        <small>
                                ${customer.orderCount}
                                order${customer.orderCount === 1
                        ? ""
                        : "s"
                    }
                            </small>

                        </div>


                        <strong class="customer-row-spend">
                            ${formatCurrency(
                        customer.totalSpending
                    )}
                   </strong>
                    </div>
                `
            ).join("");
    }

    function openCustomerOrdersModal(email) {
        const customerOrders = orders.filter(o => o.customer?.email === email);

        const existing = document.getElementById("customerOrdersModal");
        if (existing) existing.remove();

        const modal = document.createElement("div");
        modal.id = "customerOrdersModal";
        modal.className = "checkout-modal";
        modal.style.display = "flex";

        const ordersHTML = customerOrders.length
            ? customerOrders.map(o => `
                <div class="customer-order-row">
                    <div>
                        <strong>${escapeHTML(o.orderId)}</strong>
                        <small>${o.paidAt ? escapeHTML(new Date(o.paidAt).toLocaleString()) : ""}</small>
                    </div>
                    <div class="customer-order-row-right">
                        <span class="fulfillment-badge">${escapeHTML(o.status)}</span>
                        <strong>${formatCurrency(o.orderTotal || o.amount || 0)}</strong>
                    </div>
                </div>
            `).join("")
            : `<p class="empty-state">No orders found for this customer.</p>`;

        modal.innerHTML = `
            <div class="checkout-box" style="max-width: 480px;">
                <button type="button" class="close-complaint" id="closeCustomerOrdersModal" aria-label="Close">&times;</button>
                <h2>Order History</h2>
                <p class="complaint-order-ref">${escapeHTML(email)}</p>
                <div class="customer-orders-list">${ordersHTML}</div>
            </div>
        `;

        document.body.appendChild(modal);

        document.getElementById("closeCustomerOrdersModal").addEventListener("click", () => modal.remove());
        modal.addEventListener("click", (e) => { if (e.target === modal) modal.remove(); });
    }

    function formatNaira(value) {
        return new Intl.NumberFormat(
            "en-NG",
            {
                style: "currency",
                currency: "NGN",
                maximumFractionDigits: 0
            }
        ).format(
            Number(value || 0)
        );
    }


    async function loadAnalytics() {
        try {

            const response =
                await fetch(
                    `${API_URL}/api/admin/analytics`,
                    {
                        method: "GET",
                        credentials: "include",
                        headers: {
                            Accept: "application/json"
                        }
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {
                throw new Error(
                    data.message ||
                    "Unable to load analytics."
                );
            }

            const analytics =
                data.analytics || {};

            window.hiroAnalytics =
                analytics;

            const money =
                analytics.money || {};

            const orders =
                analytics.orders || {};

            const fulfillment =
                analytics.fulfillment || {};

            const customers =
                analytics.customers || {};


            /* MONEY */

            setText(
                "analyticsTotalRevenue",
                formatNaira(
                    money.totalRevenue
                )
            );

            setText(
                "analyticsGrossProfit",
                formatNaira(
                    money.grossProfit
                )
            );

            setText(
                "analyticsProfitMargin",
                `${Number(
                    money.profitMargin || 0
                ).toFixed(1)}%`
            );

            setText(
                "analyticsAov",
                formatNaira(
                    money.averageOrderValue
                )
            );

            setText(
                "analyticsTodayRevenue",
                formatNaira(
                    money.todayRevenue
                )
            );

            setText(
                "analyticsSevenDayRevenue",
                formatNaira(
                    money.sevenDayRevenue
                )
            );

            setText(
                "analyticsMonthRevenue",
                formatNaira(
                    money.monthRevenue
                )
            );

            setText(
                "analyticsSupplierCost",
                formatNaira(
                    money.supplierCost
                )
            );


            /* ORDERS */

            setText(
                "analyticsOrdersTotal",
                orders.total || 0
            );

            setText(
                "analyticsOrdersPaid",
                orders.paid || 0
            );

            setText(
                "analyticsOrdersPending",
                orders.pending || 0
            );

            setText(
                "analyticsOrdersProcessing",
                orders.processing || 0
            );

            setText(
                "analyticsOrdersCompleted",
                orders.completed || 0
            );

            setText(
                "analyticsOrdersFailed",
                orders.failed || 0
            );

            setText(
                "analyticsOrdersCancelled",
                orders.cancelled || 0
            );

            setText(
                "analyticsOrdersRefunded",
                orders.refunded || 0
            );


            /* FULFILLMENT */

            setText(
                "analyticsFulfillmentRate",
                `${Number(
                    fulfillment.successRate || 0
                ).toFixed(1)}%`
            );

            setText(
                "analyticsFulfillmentCompleted",
                fulfillment.completed || 0
            );

            setText(
                "analyticsFulfillmentProcessing",
                fulfillment.processing || 0
            );

            setText(
                "analyticsFulfillmentFailed",
                fulfillment.failed || 0
            );


            /* CUSTOMERS */

            setText(
                "analyticsCustomersTotal",
                customers.total || 0
            );

            setText(
                "analyticsCustomersRepeat",
                customers.repeat || 0
            );

            setText(
                "analyticsCustomersNew",
                customers.newThisMonth || 0
            );

            setText(
                "analyticsRefundedValue",
                formatNaira(
                    money.refundedOrderValue
                )
            );


            renderDailySales(
                analytics.dailySales || []
            );

            renderTopPackages(
                analytics.packages || []
            );

            renderTopCustomers(
                analytics.topCustomers || []
            );
            renderDashboard();
            renderStoreOperations();
            await loadProfit();

        } catch (error) {

            console.error(
                "Analytics load failed:",
                error
            );
        }
    }


    const profitCurrency = value => new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 2 }).format(Number(value || 0));

    async function loadProfit() {
        const request = ++profitRequest;
        setText("profitStatus", "Loading profit report…");
        try {
            const response = await apiFetch(`${API_URL}/api/admin/profit?period=${profitPeriod}`);
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || "Unable to load profit report.");
            if (request !== profitRequest) return;
            profitReport = data.profit;
            renderProfit();
        } catch (error) {
            if (request !== profitRequest) return;
            // Keep the last good report visibly marked as stale.
            setText("profitStatus", `Refresh failed. ${profitReport ? "Previous report shown. " : ""}${error.message}`);
        }
    }

    function renderProfit() {
        if (!profitReport) return;
        const report = profitReport;
        document.querySelectorAll("[data-profit-period]").forEach(button => {
            button.setAttribute("aria-pressed", String(button.dataset.profitPeriod === report.period));
        });
        setText("profitRevenue", profitCurrency(report.revenue));
        setText("profitCost", profitCurrency(report.supplierCost));
        setText("profitFees", `${profitCurrency(report.paystackFees)}${report.missingFees ? " recorded" : ""}`);
        setText("profitNet", report.netProfit === null ? "Incomplete" : profitCurrency(report.netProfit));
        setText("profitMargin", report.netMargin === null ? "Margin pending" : `${report.netMargin.toFixed(2)}% net margin`);
        const notes = [`${report.orderCount} paid order(s).`];
        if (report.missingFees) notes.push(`${report.missingFees} order(s) missing actual Paystack fees.`);
        if (report.missingCosts) notes.push(`${report.missingCosts} order(s) missing supplier cost snapshots.`);
        if (report.unsettledOrders) notes.push(`${report.unsettledOrders} order(s) awaiting complete delivery; supplier costs are purchase snapshots.`);
        if (report.problemOrders) notes.push(`${report.problemOrders} order(s) need delivery review.`);
        setText("profitStatus", notes.join(" "));
        const recoverButton = $("#recoverFeesBtn");
        if (recoverButton) recoverButton.hidden = !report.missingFees;
        const container = $("#profitProducts");
        if (!container) return;
        const rows = report.products.filter(product => product.categoryId === profitCategory);
        const pricing = report.pricing.find(item => item.categoryId === profitCategory);
        const pricingNote = pricing?.lastSyncedAt ? `Last FZR refresh: ${new Date(pricing.lastSyncedAt).toLocaleString()}.` : "Supplier prices are saved starting values; live refresh not confirmed yet.";
        container.innerHTML = categoryTabs("data-profit-category", profitCategory) +
            `<p class="hiro-report-note">${escapeHTML(pricingNote)} ${escapeHTML(pricing?.warning || "")} USD rate: ${profitCurrency(report.exchangeRate)}.</p>` +
            `<div class="hiro-table-scroll"><table class="hiro-table"><thead><tr><th scope="col">Product</th><th scope="col">FZR cost</th><th scope="col">Your price</th><th scope="col">Est. fee</th><th scope="col">Est. profit</th><th scope="col">Margin</th></tr></thead><tbody>${rows.map(product => {
                const loss = product.expectedNetProfit < 0;
                const low = product.expectedMargin < 10;
                const tag = loss ? "Loss" : low ? "Low margin" : "";
                return `<tr><th scope="row">${escapeHTML(product.title)} ${!product.available ? '<span class="hiro-muted">Unavailable</span>' : ''}</th>
                <td>${profitCurrency(product.supplierPriceNgn)}<small class="hiro-muted">$${Number(product.supplierPriceUsd).toFixed(4)}${!product.supplierSyncedAt ? " · saved" : ""}</small></td>
                <td>${profitCurrency(product.retailPriceNgn)}</td><td>${profitCurrency(product.estimatedPaystackFee)}</td>
                <td class="${loss ? 'hiro-loss' : ''}">${profitCurrency(product.expectedNetProfit)}</td>
                <td>${product.expectedMargin.toFixed(1)}% ${tag ? `<span class="hiro-margin-tag ${loss ? 'hiro-loss' : ''}">${tag}</span>` : ''}</td></tr>`;
            }).join("") || '<tr><td colspan="6">No products in this region.</td></tr>'}</tbody></table></div>`;
    }

    document.addEventListener("click", async event => {
        const period = event.target.closest("[data-profit-period]");
        if (period) { profitPeriod = period.dataset.profitPeriod; await loadProfit(); return; }
        const category = event.target.closest("[data-profit-category]");
        if (category) { profitCategory = category.dataset.profitCategory; renderProfit(); return; }
        const recovery = event.target.closest("#recoverFeesBtn");
        if (!recovery || recovery.disabled) return;
        recovery.disabled = true;
        recovery.textContent = "Retrieving…";
        try {
            const response = await apiFetch(`${API_URL}/api/admin/paystack-fees/recover`, { method: "POST" });
            const data = await response.json();
            if (!response.ok || !data.success) throw new Error(data.message || "Unable to retrieve fees.");
            showToast(`${data.recovered} fee(s) recovered; ${data.unavailable} unavailable.`, "success");
            await loadProfit();
        } catch (error) { showToast(error.message, "error"); }
        finally { recovery.disabled = false; recovery.textContent = "Retrieve missing fees (10 orders)"; }
    });

    function setText(id, value) {
        const element =
            document.getElementById(id);

        if (element) {
            element.textContent = value;
        }
    }


    function renderDailySales(rows) {

        const container =
            document.getElementById(
                "analyticsDailySales"
            );

        if (!container) return;

        if (!rows.length) {
            container.innerHTML =
                `<p class="empty-state">
        No sales in the last 7 days.
      </p>`;

            return;
        }

        const maxRevenue =
            Math.max(
                ...rows.map(
                    row =>
                        Number(
                            row.revenue || 0
                        )
                ),
                1
            );

        container.innerHTML =
            rows.map(row => {

                const revenue =
                    Number(
                        row.revenue || 0
                    );

                const width =
                    Math.max(
                        3,
                        revenue /
                        maxRevenue *
                        100
                    );

                return `
        <div class="analytics-bar-row">

          <div>
            ${escapeHTML(
                    row.day
                )}
          </div>

          <div class="analytics-bar-track">
            <div
              class="analytics-bar-fill"
              style="width:${width}%"
            ></div>
          </div>

          <div class="analytics-bar-value">
            ${formatNaira(revenue)}
            <small>
              (${Number(
                    row.orders || 0
                )} orders)
            </small>
          </div>

        </div>
      `;
            }).join("");
    }


    function renderTopPackages(packages) {

        const container =
            document.getElementById(
                "analyticsTopPackages"
            );

        if (!container) return;

        if (!packages.length) {
            container.innerHTML =
                "<p>No sales yet.</p>";
            return;
        }

        container.innerHTML =
            packages
                .slice(0, 10)
                .map(item => `
        <div class="analytics-table-row">

          <div class="analytics-table-main">
            <strong>
              ${escapeHTML(
                    item.title
                )}
            </strong>

            <small>
              ${Number(
                    item.unitsSold || 0
                )} units
              ·
              ${Number(
                    item.margin || 0
                ).toFixed(1)}% margin
            </small>
          </div>

          <div class="analytics-table-value">
            ${formatNaira(
                    item.profit
                )}
            <small>
              profit
            </small>
          </div>

        </div>
      `)
                .join("");
    }


    function renderTopCustomers(customers) {

        const container =
            document.getElementById(
                "analyticsTopCustomers"
            );

        if (!container) return;

        if (!customers.length) {
            container.innerHTML =
                "<p>No customer data yet.</p>";
            return;
        }

        container.innerHTML =
            customers
                .map(customer => `
        <div class="analytics-table-row">

          <div class="analytics-table-main">
            <strong>
              ${escapeHTML(
                    customer.name ||
                    "Customer"
                )}
            </strong>

            <small>
              ${escapeHTML(
                    customer.email ||
                    ""
                )}
              ·
              ${Number(
                    customer.orderCount ||
                    0
                )} orders
            </small>
          </div>

          <div class="analytics-table-value">
            ${formatNaira(
                    customer.totalSpending
                )}
          </div>

        </div>
      `)
                .join("");
    }

    /* =====================================================
       PAGE TITLES / SUBTITLES
    ===================================================== */

    function updatePageData() {

        const currentSection =
            $(".admin-section.active");


        if (!currentSection) {
            return;
        }


        const sectionId =
            currentSection.id
                .replace(
                    "Section",
                    ""
                );


        const pageData = {

            dashboard: {
                title: "Dashboard",
                subtitle:
                    "Welcome back, Administrator."
            },

            orders: {
                title: "Orders",
                subtitle:
                    "View and manage every customer order."
            },

            processing: {
                title: "Processing Orders",
                subtitle:
                    "Orders that still need to be fulfilled."
            },

            completed: {
                title: "Completed Orders",
                subtitle:
                    "Orders that have been successfully fulfilled."
            },

            refunded: {
                title: "Refunded Orders",
                subtitle: "Orders that have been refunded to customers."
            },

            products: {
                title: "Products",
                subtitle:
                    "Manage your available products and services."
            },

            customers: {
                title: "Customers",
                subtitle:
                    "Understand your customers and their purchases."
            },

            complaints: {
                title: "Complaints",
                subtitle:
                    "Review and respond to customer-reported issues."
            },

            analytics: {
                title: "Analytics",
                subtitle:
                    "Understand how your Hiro Store is performing."
            },

            settings: {
                title: "Settings",
                subtitle:
                    "Configure your administration environment."
            }

        };


        const data =
            pageData[
            sectionId
            ] ||
            pageData.dashboard;


        setText(
            "#pageTitle",
            data.title
        );


        setText(
            "#pageSubtitle",
            data.subtitle
        );
    }


    /* =====================================================
       NAVIGATION
    ===================================================== */

    function showSection(
        sectionName
    ) {

        if (!sectionName) {
            return;
        }


        $$(".admin-section")
            .forEach(section => {

                section.classList.remove(
                    "active"
                );
            });


        const target =
            $(`#${sectionName}Section`);


        if (!target) {
            return;
        }


        target.classList.add(
            "active"
        );


        $$(".nav-item")
            .forEach(button => {

                button.classList.toggle(
                    "active",
                    button.dataset.section ===
                    sectionName
                );
            });


        updatePageData();


        closeMobileSidebar();


        window.scrollTo({
            top: 0,
            behavior: "smooth"
        });
    }


    /* =====================================================
       ORDER MODAL
    ===================================================== */

    function openOrderModal(
        orderId
    ) {

        const order =
            orders.find(
                item =>
                    getOrderId(item) ===
                    String(orderId)
            );


        if (!order) {
            return;
        }


        selectedOrder =
            order;


        const modal =
            $("#orderModal");


        const title =
            $("#orderModalTitle");


        const body =
            $("#orderModalBody");


        if (
            !modal ||
            !body
        ) {
            return;
        }


        if (title) {

            title.textContent =
                getOrderId(order);
        }


        renderOrderModalBody(
            order
        );


        updateModalButtons();


        modal.setAttribute(
            "aria-hidden",
            "false"
        );


        document.body.classList.add(
            "modal-open"
        );
    }


    /* =====================================================
       MODAL BODY
    ===================================================== */

    function renderOrderModalBody(
        order
    ) {

        const body =
            $("#orderModalBody");


        if (!body) {
            return;
        }


        const items =
            getItems(order);

        const paymentStatus =
            normalizeStatus(
                getPaymentStatus(order)
            );

        const hasConfirmedPayment =
            Boolean(
                order?.paidAt ||
                order?.paid_at
            ) &&
            getAmountCharged(order) > 0 &&
            !["refunded", "cancelled"].includes(paymentStatus);


        body.innerHTML = `

            <div class="modal-summary-grid">


                <div class="modal-summary-card">

                    <small>
                        ORDER TOTAL
                    </small>

                    <strong>
                        ${formatCurrency(
            getOrderTotal(order)
        )}
                    </strong>

                </div>


                <div class="modal-summary-card">

                    <small>
                        AMOUNT CHARGED
                    </small>

                    <strong>
                        ${formatCurrency(
            getAmountCharged(order)
        )}
                    </strong>

                </div>


                <div class="modal-summary-card">

                    <small>
                        STATUS
                    </small>

                    <strong>
                        ${escapeHTML(
            getOrderStatus(order)
        )}
                    </strong>

                </div>


                <div class="modal-summary-card">

                    <small>
                        REFERENCE
                    </small>

                    <strong>
                        ${escapeHTML(
            getReference(order)
        )}
                    </strong>

                </div>


                <div class="modal-summary-card">

                    <small>
                        CUSTOMER
                    </small>

                    <strong>
                        ${escapeHTML(
            getCustomerEmail(order)
        )}
                    </strong>

                </div>


                <div class="modal-summary-card">

                    <small>
                        PHONE
                    </small>

                    <strong>
                        ${escapeHTML(
            getCustomerPhone(order)
        )}
                    </strong>

                </div>

            </div>


            <div class="modal-items-section">

                <h3>
                    Purchased Items
                </h3>


                <div class="modal-items-list">

                    ${items.length
                ? items.map(
                    item => `
                                    <div class="modal-item">

                                        <div class="modal-item-main">

                                            <strong>
                                                ${escapeHTML(
                        item?.title ||
                        "Product"
                    )}
                                            </strong>

                                            <small>
                                                Quantity:
                                                ${Number(
                        item?.qty || 1
                    )}

                                                ·

                                                Price:
                                                ${formatCurrency(
                        item?.price
                    )}
                                            </small>

                                        </div>


                              <div class="modal-item-meta">

                                            <span>
                                                Player:
                                                ${escapeHTML(
                        item?.playerId ||
                        "—"
                    )}
                                            </span>

                                            <span>
                                                Server:
                                                ${escapeHTML(
                        item?.serverId ||
                        "—"
                    )}
                                            </span>

                                            <span class="fulfillment-badge fulfillment-${escapeHTML(
                        (item?.fulfillmentStatus || "Pending").toLowerCase()
                    )}">
                                                ${escapeHTML(
                        item?.fulfillmentStatus || "Pending"
                    )}
                                            </span>

                                            ${hasConfirmedPayment && item?.fulfillmentStatus === "Pending"
                            ? `<button type="button" class="admin-action-btn fulfill" data-fulfill-item="${item.id}" data-fulfill-order="${escapeHTML(order.orderId)}">Fulfill Now</button>`
                            : ""
                        }

                                            ${hasConfirmedPayment && item?.fulfillmentStatus === "Processing" && item?.fzrOrderId
                            ? `<button type="button" class="admin-action-btn check" data-check-item="${item.id}" data-check-order="${escapeHTML(order.orderId)}">Check FZR Status</button>`
                            : ""
                        }

                                            ${hasConfirmedPayment && item?.fulfillmentStatus === "Failed"
                            ? `<button type="button" class="admin-action-btn retry" data-retry-item="${item.id}" data-retry-order="${escapeHTML(order.orderId)}">Retry Delivery</button>`
                            : ""
                        }

                                            ${item?.fulfillmentError
                            ? `<small style="display:block;width:100%;color:#ffb4b4;margin-top:6px;">${escapeHTML(item.fulfillmentError)}</small>`
                            : ""
                        }

                                            ${hasConfirmedPayment && item?.fulfillmentStatus === "Review Required" && !item?.fzrOrderId
                            ? `<button type="button" class="admin-action-btn retry" data-confirm-no-fzr-item="${item.id}" data-confirm-no-fzr-order="${escapeHTML(order.orderId)}">I Checked FZR — No Order Exists</button>`
                            : ""
                        }

                                        </div>

                                    </div>
                                `
                ).join("")
                : `
                                <div class="modal-no-items">
                                    No items recorded.
                                </div>
                            `
            }

                </div>

            </div>


            <div class="modal-dates">

                <div>
                    <span>
                        Paid
                    </span>

                    <strong>
                        ${escapeHTML(
                formatDate(
                    order.paidAt ||
                    order.paid_at
                )
            )}
                    </strong>
                </div>


                <div>
                    <span>
                        Created
                    </span>

                    <strong>
                        ${escapeHTML(
                formatDate(
                    getOrderDate(order)
                )
            )}
                    </strong>
                </div>

            </div>

        `;
    }


    /* =====================================================
       MODAL BUTTONS
    ===================================================== */

    function updateModalButtons() {

        if (!selectedOrder) {
            return;
        }

        const cancelBtn =
            $("#cancelOrderBtn");

        const refundBtn =
            $("#markRefundedBtn");

        const paymentStatus =
            normalizeStatus(
                getPaymentStatus(
                    selectedOrder
                )
            );

        const hasConfirmedPayment =
            Boolean(
                selectedOrder.paidAt ||
                selectedOrder.paid_at
            ) &&
            getAmountCharged(
                selectedOrder
            ) > 0;

        if (cancelBtn) {
            cancelBtn.style.display =
                !hasConfirmedPayment &&
                    !["cancelled", "refunded"].includes(paymentStatus)
                    ? "inline-flex"
                    : "none";
        }

        if (refundBtn) {
            refundBtn.style.display =
                hasConfirmedPayment &&
                    !["cancelled", "refunded"].includes(paymentStatus)
                    ? "inline-flex"
                    : "none";
        }
    }


    /* =====================================================
       CLOSE MODAL
    ===================================================== */

    function closeOrderModal() {

        const modal =
            $("#orderModal");


        if (!modal) {
            return;
        }


        modal.setAttribute(
            "aria-hidden",
            "true"
        );


        selectedOrder =
            null;


        document.body.classList.remove(
            "modal-open"
        );
    }


    /* =====================================================
    RENDER PRODUCTS (basic)
 ===================================================== */
    function categoryTabs(attribute, active) {
        return `<div class="hiro-tabs" aria-label="Catalog region">${[
            ["mobile_legends_global", "🌍 Global"], ["mobile_legends_philippines", "🇵🇭 Philippines"]
        ].map(([id, label]) => `<button type="button" ${attribute}="${id}" aria-pressed="${id === active}">${label}</button>`).join("")}</div>`;
    }

    function renderProducts() {
        const container = $("#adminProductsList");
        if (!container) return;
        const search = ($("#productSearch")?.value || "").trim().toLowerCase();
        const rows = products.filter(product => product.categoryId === productCategory && String(product.title || product.offerId).toLowerCase().includes(search)).map(product => ({ ...product, ...productDrafts.get(String(product.id)) }));
        container.innerHTML = categoryTabs("data-product-category", productCategory) +
            `<div class="hiro-table-scroll"><table class="hiro-table"><thead><tr><th scope="col">Product</th><th scope="col">Your price (₦)</th><th scope="col">Available</th><th scope="col">Action</th></tr></thead><tbody>${rows.map(product => `
                <tr data-product-id="${product.id}"><th scope="row">${escapeHTML(product.title || product.offerId)}</th>
                <td><input type="number" class="product-price-input" data-product-price="${product.id}" value="${product.retailPriceNgn ?? 0}" min="0" step="1" aria-label="Selling price for ${escapeHTML(product.title)}"></td>
                <td><label class="hiro-switch"><input type="checkbox" data-product-available="${product.id}" ${product.available ? "checked" : ""} aria-label="Availability for ${escapeHTML(product.title)}"><span aria-hidden="true"></span></label></td>
                <td><button type="button" class="admin-secondary-btn product-save-btn" data-product-save="${product.id}" aria-label="Save ${escapeHTML(product.title)}">Save</button></td></tr>`).join("") || '<tr><td colspan="4">No products in this region.</td></tr>'}</tbody></table></div>`;
    }

    document.addEventListener("input", event => {
        if (event.target.id === "productSearch") { renderProducts(); return; }
        const row = event.target.closest("[data-product-id]");
        if (!row) return;
        productDrafts.set(row.dataset.productId, {
            retailPriceNgn: row.querySelector("[data-product-price]").value,
            available: row.querySelector("[data-product-available]").checked
        });
        const button = row.querySelector("[data-product-save]");
        if (!button.disabled) button.textContent = "Save";
    });

    document.addEventListener("click", event => {
        const tab = event.target.closest("[data-product-category]");
        if (!tab || tab.getAttribute("aria-pressed") === "true") return;
        productCategory = tab.dataset.productCategory;
        renderProducts();
    });

    /* =====================================================
       UPDATE PRODUCT (price / availability)
    ===================================================== */
    async function updateProduct(productId) {
        const card = document.querySelector(`[data-product-id="${productId}"]`);
        if (!card) return;

        const priceInput = card.querySelector("[data-product-price]");
        const availableInput = card.querySelector("[data-product-available]");
        const saveBtn = card.querySelector("[data-product-save]");

        if (saveBtn.disabled) return;
        const retailPriceNgn = Number(priceInput.value);

        if (!priceInput.value.trim() || !Number.isFinite(retailPriceNgn) || retailPriceNgn < 0) {
            showToast("Enter a valid price.", "error");
            return;
        }

        saveBtn.disabled = true;
        saveBtn.textContent = "Saving...";

        try {
            const response = await apiFetch(
                `${API_URL}/api/admin/products/${productId}`,
                {
                    method: "PATCH",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({
                        retailPriceNgn,
                        available: availableInput.checked
                    })
                }
            );

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || "Unable to update product.");
            }

            showToast("Product updated.", "success");
            // Update only this row so unsaved edits to other products survive.
            const product = products.find(item => String(item.id) === String(productId));
            if (product) Object.assign(product, data.product);
            productDrafts.delete(String(productId));
            priceInput.value = data.product.retailPriceNgn;
            availableInput.checked = Boolean(data.product.available);
            saveBtn.disabled = false;
            saveBtn.textContent = "Saved";
            if (profitReport) loadProfit();

        } catch (error) {
            showToast(error.message || "Network error updating product.", "error");
            saveBtn.disabled = false;
            saveBtn.textContent = "Save";
        }
    }

    document.addEventListener("click", event => {
        const saveBtn = event.target.closest("[data-product-save]");
        if (!saveBtn) return;

        updateProduct(saveBtn.dataset.productSave);
    });

    /* =====================================================
       UPDATE ORDER STATUS (fixed)
    ===================================================== */
    async function updateOrderStatus(orderId, status) {
        if (!orderId) return;

        try {
            showToast(`Updating order...`);

            const response = await apiFetch(
                `${API_URL}/api/admin/orders/${encodeURIComponent(orderId)}/status`,
                {
                    method: "PATCH",
                    credentials: "include",
                    headers: {
                        "Content-Type": "application/json",
                        "Accept": "application/json"
                    },
                    body: JSON.stringify({ status })
                }
            );

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.message || "Unable to update order.");
            }

            showToast(`Order marked ${status}.`, "success");

            // Refresh admin orders silently
            await loadOrders(false);

            // Re-open modal for updated order (if still present)
            const updated = orders.find(o => getOrderId(o) === String(orderId));

            if (updated) {
                selectedOrder = updated;
                openOrderModal(orderId);
            } else {
                closeOrderModal();
            }

        } catch (error) {
            console.error("Status update failed:", error);
            showToast("Could not update order status.", "error");
        }
    }


    /* =====================================================
       MOBILE SIDEBAR
    ===================================================== */

    function openMobileSidebar() {

        const sidebar =
            $("#sidebar");


        const overlay =
            $("#sidebarOverlay");


        sidebar?.classList.add(
            "mobile-open"
        );


        overlay?.classList.add(
            "active"
        );


        document.body.classList.add(
            "sidebar-open"
        );
    }


    function closeMobileSidebar() {

        const sidebar =
            $("#sidebar");


        const overlay =
            $("#sidebarOverlay");


        sidebar?.classList.remove(
            "mobile-open"
        );


        overlay?.classList.remove(
            "active"
        );


        document.body.classList.remove(
            "sidebar-open"
        );
    }


    /* =====================================================
       REFRESH
    ===================================================== */

    function refreshData() {

        loadOrders(
            true
        );
    }


    /* =====================================================
       EXPORT ORDERS
    ===================================================== */

    function exportOrders() {

        if (!orders.length) {

            showToast(
                "There are no orders to export.",
                "error"
            );

            return;
        }


        const rows = [

            [
                "Order ID",
                "Reference",
                "Customer",
                "Phone",
                "Purchase",
                "Order Total",
                "Amount Charged",
                "Status",
                "Date"
            ]

        ];


        orders.forEach(order => {

            const items =
                getItems(order);


            const purchase =
                items
                    .map(
                        item =>
                            item?.title ||
                            "Product"
                    )
                    .join(" | ");


            rows.push([

                getOrderId(order),

                getReference(order),

                getCustomerEmail(order),

                getCustomerPhone(order),

                purchase,

                getOrderTotal(order),

                getAmountCharged(order),

                getOrderStatus(order),

                formatDate(
                    getOrderDate(order)
                )

            ]);
        });


        const csv =
            rows
                .map(
                    row =>
                        row.map(
                            value =>
                                `"${String(
                                    value ?? ""
                                ).replace(
                                    /"/g,
                                    '""'
                                )}"`
                        ).join(",")
                )
                .join("\n");


        const blob =
            new Blob(
                [csv],
                {
                    type:
                        "text/csv;charset=utf-8;"
                }
            );


        const url =
            URL.createObjectURL(
                blob
            );


        const link =
            document.createElement(
                "a"
            );


        link.href =
            url;


        link.download =
            `hiro-store-orders-${new Date()
                .toISOString()
                .slice(0, 10)
            }.csv`;


        document.body.appendChild(
            link
        );


        link.click();


        link.remove();


        URL.revokeObjectURL(
            url
        );


        showToast(
            "Orders exported successfully.",
            "success"
        );
    }


    /* =====================================================
       EVENT LISTENERS
    ===================================================== */

    function setupEvents() {

        document.addEventListener("click", (event) => {
            const customerRow = event.target.closest("[data-customer-email]");
            if (customerRow) openCustomerOrdersModal(customerRow.dataset.customerEmail);
        });

        document
            .getElementById("refreshAnalyticsBtn")
            ?.addEventListener(
                "click",
                loadAnalytics
            );

        document
            .getElementById(
                "refreshSystemStatusBtn"
            )
            ?.addEventListener(
                "click",
                loadSystemStatus
            );

        /* ---------------------------------------------
           NAVIGATION
        --------------------------------------------- */

        $$(".nav-item")
            .forEach(button => {

                button.addEventListener(
                    "click",
                    () => {

                        showSection(
                            button.dataset.section
                        );
                    }
                );
            });


        /* ---------------------------------------------
           ALL DATA-SECTION BUTTONS
        --------------------------------------------- */

        $$("[data-section]")
            .forEach(button => {

                if (
                    button.classList.contains(
                        "nav-item"
                    )
                ) {
                    return;
                }


                button.addEventListener(
                    "click",
                    () => {

                        showSection(
                            button.dataset.section
                        );
                    }
                );
            });

        /* ---------------------------------------------
           REFRESH
        --------------------------------------------- */

        $("#refreshBtn")
            ?.addEventListener(
                "click",
                refreshData
            );


        $("#heroRefreshBtn")
            ?.addEventListener(
                "click",
                refreshData
            );


        /* ---------------------------------------------
           SEARCH
        --------------------------------------------- */

        $("#orderSearch")
            ?.addEventListener(
                "input",
                renderOrders
            );


        /* ---------------------------------------------
           FILTERS
        --------------------------------------------- */

        $("#statusFilter")
            ?.addEventListener(
                "change",
                renderOrders
            );


        $("#dateFilter")
            ?.addEventListener(
                "change",
                renderOrders
            );


        /* ---------------------------------------------
           SALES PERIOD
        --------------------------------------------- */

        $("#salesPeriod")
            ?.addEventListener(
                "change",
                () => {

                    renderDashboard();

                    showToast(
                        `Showing last ${$("#salesPeriod")?.value ||
                        7
                        } days.`
                    );
                }
            );


        /* ---------------------------------------------
           EXPORT
        --------------------------------------------- */

        $("#exportOrdersBtn")
            ?.addEventListener(
                "click",
                exportOrders
            );


        /* ---------------------------------------------
           VIEW ORDER
        --------------------------------------------- */

        document.addEventListener(
            "click",
            event => {

                const viewButton =
                    event.target.closest(
                        "[data-view-order]"
                    );


                if (viewButton) {

                    openOrderModal(
                        viewButton.dataset.viewOrder
                    );

                    return;
                }


                const recentRow =
                    event.target.closest(
                        "[data-order-id]"
                    );


                if (recentRow) {

                    openOrderModal(
                        recentRow.dataset.orderId
                    );
                }
            }
        );


        /* ---------------------------------------------
           FULFILL PENDING ITEM
        --------------------------------------------- */

        document.addEventListener(
            "click",
            async event => {

                const fulfillButton =
                    event.target.closest(
                        "[data-fulfill-item]"
                    );

                if (!fulfillButton) return;

                fulfillButton.disabled = true;
                fulfillButton.textContent = "Submitting...";

                try {
                    const response = await apiFetch(
                        `${API_URL}/api/admin/orders/${fulfillButton.dataset.fulfillOrder}/items/${fulfillButton.dataset.fulfillItem}/fulfill`,
                        { method: "POST", credentials: "include" }
                    );

                    const data = await response.json();

                    if (!response.ok || !data.success) {
                        throw new Error(data.message || "Fulfillment failed.");
                    }

                    showToast(data.message, "success");
                    await loadOrders(false);

                    if (selectedOrder) {
                        openOrderModal(selectedOrder.orderId);
                    }

                } catch (error) {
                    showToast(error.message || "Unable to fulfill item.", "error");
                    fulfillButton.disabled = false;
                    fulfillButton.textContent = "Fulfill Now";
                }
            }
        );


        /* ---------------------------------------------
           CHECK FZR STATUS
        --------------------------------------------- */

        document.addEventListener(
            "click",
            async event => {

                const checkButton =
                    event.target.closest(
                        "[data-check-item]"
                    );

                if (!checkButton) return;

                checkButton.disabled = true;
                checkButton.textContent = "Checking...";

                try {
                    const response = await apiFetch(
                        `${API_URL}/api/admin/orders/${checkButton.dataset.checkOrder}/items/${checkButton.dataset.checkItem}/check-status`,
                        { method: "POST", credentials: "include" }
                    );

                    const data = await response.json();

                    if (!response.ok || !data.success) {
                        throw new Error(data.message || "Unable to check FZR status.");
                    }

                    showToast(data.message, "success");
                    await loadOrders(false);

                    if (selectedOrder) {
                        openOrderModal(selectedOrder.orderId);
                    }

                } catch (error) {
                    showToast(error.message || "Unable to check FZR status.", "error");
                    checkButton.disabled = false;
                    checkButton.textContent = "Check FZR Status";
                }
            }
        );


        /* ---------------------------------------------
           CONFIRM AMBIGUOUS FZR FAILURE IS SAFE TO RETRY
        --------------------------------------------- */
        document.addEventListener("click", async event => {
            const button = event.target.closest("[data-confirm-no-fzr-item]");
            if (!button) return;

            const confirmed = window.confirm(
                "Only continue if you checked FZR order history for this player/order and confirmed NO supplier order was created. This will enable Retry Delivery."
            );
            if (!confirmed) return;

            button.disabled = true;
            button.textContent = "Recording review...";

            try {
                const response = await apiFetch(
                    `${API_URL}/api/admin/orders/${button.dataset.confirmNoFzrOrder}/items/${button.dataset.confirmNoFzrItem}/confirm-no-fzr-order`,
                    {
                        method: "POST",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ confirmed: true })
                    }
                );
                const data = await response.json();
                if (!response.ok || !data.success) throw new Error(data.message || "Could not record review.");

                showToast(data.message, "success");
                await loadOrders(false);
                if (selectedOrder) openOrderModal(selectedOrder.orderId);
            } catch (error) {
                showToast(error.message || "Could not record FZR review.", "error");
                button.disabled = false;
                button.textContent = "I Checked FZR — No Order Exists";
            }
        });

        /* ---------------------------------------------
           RETRY FAILED ITEM
        --------------------------------------------- */

        document.addEventListener(
            "click",
            async event => {

                const retryButton =
                    event.target.closest(
                        "[data-retry-item]"
                    );

                if (!retryButton) return;

                retryButton.disabled = true;
                retryButton.textContent = "Retrying...";

                try {
                    const response = await apiFetch(
                        `${API_URL}/api/admin/orders/${retryButton.dataset.retryOrder}/items/${retryButton.dataset.retryItem}/retry`,
                        { method: "POST", credentials: "include" }
                    );

                    const data = await response.json();

                    if (!data.success) {
                        showToast(data.message || "Retry failed.", "error");
                        retryButton.disabled = false;
                        retryButton.textContent = "Retry Delivery";
                        return;
                    }

                    showToast(data.message, "success");

                    // Refresh the modal + underlying order list
                    if (selectedOrder) {
                        openOrderModal(selectedOrder.orderId);
                    }
                    loadOrders?.();

                } catch (error) {
                    showToast("Network error retrying delivery.", "error");
                    retryButton.disabled = false;
                    retryButton.textContent = "Retry Delivery";
                }
            }
        );

        /* ---------------------------------------------
           CLOSE MODAL
        --------------------------------------------- */

        $("#closeOrderModal")
            ?.addEventListener(
                "click",
                closeOrderModal
            );


        $("#cancelOrderModal")
            ?.addEventListener(
                "click",
                closeOrderModal
            );


        $("#orderModal")
            ?.addEventListener(
                "click",
                event => {

                    if (
                        event.target.id ===
                        "orderModal"
                    ) {
                        closeOrderModal();
                    }
                }
            );


        /* ---------------------------------------------
           ESCAPE KEY
        --------------------------------------------- */

        document.addEventListener(
            "keydown",
            event => {

                if (
                    event.key === "Escape"
                ) {

                    closeOrderModal();

                    closeMobileSidebar();
                }
            }
        );


        /* ---------------------------------------------
           CANCEL UNPAID ORDER
        --------------------------------------------- */

        $("#cancelOrderBtn")
            ?.addEventListener(
                "click",
                () => {
                    if (!selectedOrder) return;

                    updateOrderStatus(
                        getOrderId(selectedOrder),
                        "Cancelled"
                    );
                }
            );


        /* ---------------------------------------------
           MARK REFUNDED
        --------------------------------------------- */

        $("#markRefundedBtn")
            ?.addEventListener(
                "click",
                () => {
                    if (!selectedOrder) return;

                    updateOrderStatus(
                        getOrderId(selectedOrder),
                        "Refunded"
                    );
                }
            );


        /* ---------------------------------------------
           MOBILE MENU
        --------------------------------------------- */

        $("#mobileMenuBtn")
            ?.addEventListener(
                "click",
                openMobileSidebar
            );


        $("#sidebarClose")
            ?.addEventListener(
                "click",
                closeMobileSidebar
            );


        $("#sidebarOverlay")
            ?.addEventListener(
                "click",
                closeMobileSidebar
            );
    }


    /* =====================================================
       TEXT HELPER
    ===================================================== */

    function setText(
        selector,
        value
    ) {

        const element =
            document.getElementById(selector) ||
            $(selector);

        if (!element) {
            return;
        }

        element.textContent =
            value;
    }

    async function loadUnmatchedPayments() {

        const container =
            document.getElementById(
                "unmatchedPaymentsList"
            );

        if (!container) {
            return;
        }

        try {

            const response =
                await apiFetch(
                    `${API_URL}/api/admin/unmatched-payments`,
                    {
                        credentials:
                            "include"
                    }
                );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success
            ) {
                throw new Error(
                    data.message ||
                    "Unable to load payments."
                );
            }

            const payments =
                data.payments || [];

            if (!payments.length) {

                container.innerHTML = `
                <div class="empty-state">
                    <h4>
                        No unmatched payments
                    </h4>

                    <p>
                        Everything is reconciled.
                    </p>
                </div>
            `;

                return;
            }

            container.innerHTML =
                payments.map(payment => `

        <div class="status-row">

            <div>

                <strong>
                    ${escapeHTML(
                    payment.reference
                )}
                </strong>

                <small>
                    ${escapeHTML(
                    payment.email ||
                    "Unknown customer"
                )}
                    · Player:
                    ${escapeHTML(
                    payment.playerId ||
                    "N/A"
                )}
                    · Server:
                    ${escapeHTML(
                    payment.serverId ||
                    "N/A"
                )}
                </small>

            </div>

            <div>

                <strong>
                    ${formatCurrency(
                    payment.amountNgn
                )}
                </strong>

                <small>
                    ${escapeHTML(
                    payment.resolutionStatus
                )}
                </small>

                ${payment.resolutionStatus ===
                        "Unresolved"
                        ? `
                            <button
                                type="button"
                                class="admin-action-btn recover"
                                data-recover-payment="${payment.id}"
                            >
                                Recover Payment
                            </button>
                        `
                        : ""
                    }

            </div>

        </div>

    `).join("");

        } catch (error) {

            console.error(
                "Unmatched payments load failed:",
                error
            );

            container.innerHTML =
                `<p>Unable to load unmatched payments.</p>`;
        }
    }

    document.addEventListener(
        "click",
        async event => {

            const button =
                event.target.closest(
                    "[data-recover-payment]"
                );

            if (!button) {
                return;
            }

            const paymentId =
                Number(
                    button.dataset
                        .recoverPayment
                );

            const orderId =
                window.prompt(
                    "Enter the Hiro Order ID to attach this payment to.\nExample: HIRO-20260912-80321F65"
                );

            if (!orderId) {
                return;
            }

            const confirmed =
                window.confirm(
                    `Recover this successful payment into ${orderId}?\n\nThe server will verify amount, customer, payment state and fulfillment state before changing anything.`
                );

            if (!confirmed) {
                return;
            }

            button.disabled = true;

            try {
                const response =
                    await apiFetch(
                        `${API_URL}/api/admin/unmatched-payments/${paymentId}/recover`,
                        {
                            method: "POST",
                            credentials:
                                "include",

                            headers: {
                                "Content-Type":
                                    "application/json"
                            },

                            body:
                                JSON.stringify({
                                    orderId:
                                        orderId.trim()
                                })
                        }
                    );

                const data =
                    await response.json();

                if (
                    !response.ok ||
                    !data.success
                ) {
                    showToast(
                        data.message ||
                        "Unable to recover payment.",
                        "error"
                    );

                    button.disabled =
                        false;

                    return;
                }

                showToast(
                    data.message,
                    "success"
                );

                await Promise.all([
                    loadUnmatchedPayments(),
                    loadOrders()
                ]);

            } catch (error) {

                showToast(
                    "Network error recovering payment.",
                    "error"
                );

                button.disabled =
                    false;
            }
        }
    );

    /* =====================================================
       VERIFY ADMIN SESSION
    ===================================================== */


    async function verifyAdminSession() {
        try {
            const response = await fetch(
                `${API_URL}/api/admin/session`,
                {
                    method: "GET",
                    credentials: "include"
                }
            );

            const data =
                await response.json();

            if (
                !response.ok ||
                !data.success ||
                !data.authenticated ||
                data.user?.role !== "admin"
            ) {
                showToast(
                    "Administrator access required.",
                    "error"
                );

                return false;
            }

            console.log(
                "Admin session verified:",
                data.user
            );

            return true;

        } catch (error) {
            console.error(
                "Admin session verification failed:",
                error
            );

            showToast(
                "Unable to verify administrator session.",
                "error"
            );

            return false;
        }
    }


    /* =====================================================
       INITIALIZATION
    ===================================================== */

    async function init() {
        setupEvents();

        await loadCsrfToken();

        const authenticated =
            await verifyAdminSession();

        if (!authenticated) {
            return;
        }

        await Promise.all([
            loadOrders(),
            loadCustomers(),
            loadProducts(),
            loadAnalytics(),
            loadSupportConversations(),
            loadSettings(),
            loadSystemStatus(),
            loadUnmatchedPayments()
        ]);
    }



    /* =====================================================
       START
    ===================================================== */

    if (
        document.readyState ===
        "loading"
    ) {

        document.addEventListener(
            "DOMContentLoaded",
            init
        );

    } else {

        init();
    }


})();