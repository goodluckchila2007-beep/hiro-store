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

        renderAnalytics();

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
                analytics.totalRevenue ||
                0
            );

        const profit =
            Number(
                analytics.profit ||
                0
            );

        const todaySales =
            Number(
                analytics.todaySales ||
                0
            );

        const pendingOrders =
            Number(
                analytics.pendingOrders ||
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
            }
        } catch (error) {
            showToast("Unable to load settings.", "error");
        }

        loadSystemStatus();
    }

    async function loadSystemStatus() {
        const container = document.getElementById("systemStatusList");
        if (!container) return;

        try {
            const response = await apiFetch(`${API_URL}/api/admin/system-status`, { credentials: "include" });
            const data = await response.json();

            if (!data.success) {
                container.innerHTML = `<p>Unable to load system status.</p>`;
                return;
            }

            const labels = {
                database: "Database",
                paystackConfigured: "Paystack",
                fzrConfigured: "FZR Supplier API",
                smtpConfigured: "Email (SMTP)"
            };

            container.innerHTML = Object.entries(data.status).map(([key, ok]) => `
                <div class="status-row">
                    <span><span class="status-dot ${ok ? "ok" : "bad"}"></span>${labels[key] || key}</span>
                    <span>${ok ? "OK" : "Not configured"}</span>
                </div>
            `).join("");

        } catch (error) {
            container.innerHTML = `<p>Network error loading system status.</p>`;
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
                        maintenanceMode: document.getElementById("maintenanceModeToggle").checked,
                        usdNgnRate: Number(document.getElementById("usdNgnRateInput").value)
                    })
                });

                const data = await response.json();

                if (!data.success) {
                    showToast(data.message || "Unable to save settings.", "error");
                    btn.disabled = false;
                    return;
                }

                showToast("Settings saved.", "success");
                btn.disabled = false;

            } catch (error) {
                showToast("Network error saving settings.", "error");
                btn.disabled = false;
            }
        });


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

    async function loadAnalytics() {
        try {
            const response =
                await fetch(
                    `${API_URL}/api/admin/analytics`,
                    {
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
                    "Unable to load analytics."
                );
            }

            window.hiroAnalytics =
                data.analytics;

            renderAnalytics();

        } catch (error) {
            console.error(
                "Analytics error:",
                error
            );
        }
    }


    /* =====================================================
       ANALYTICS
    ===================================================== */

    function renderAnalytics() {

        const revenue =
            orders.reduce(
                (sum, order) =>
                    sum +
                    getAmountCharged(order),
                0
            );


        const totalOrders =
            orders.length;


        const completed =
            orders.filter(
                order =>
                    normalizeStatus(
                        getOrderStatus(order)
                    ) === "completed"
            ).length;


        const processing =
            orders.filter(
                order =>
                    normalizeStatus(
                        getOrderStatus(order)
                    ) === "processing"
            ).length;


        const revenueContainer =
            $("#revenueAnalytics");


        if (revenueContainer) {

            revenueContainer.innerHTML = `

                <div class="analytics-number">

                    <span>
                        Total Revenue
                    </span>

                    <strong>
                        ${formatCurrency(
                revenue
            )}
                    </strong>

                </div>

            `;
        }


        const orderContainer =
            $("#orderAnalytics");


        if (orderContainer) {

            orderContainer.innerHTML = `

                <div class="analytics-number-grid">

                    <div>
                        <span>
                            Total
                        </span>

                        <strong>
                            ${totalOrders}
                        </strong>
                    </div>


                    <div>
                        <span>
                            Processing
                        </span>

                        <strong>
                            ${processing}
                        </strong>
                    </div>


                <div>
                        <span>
                            Completed
                        </span>

                        <strong>
                            ${completed}
                        </strong>
                    </div>

                </div>

            `;
        }

        const packages = window.hiroAnalytics?.packages || [];
        const breakdownContainer = $("#profitBreakdownTable");

        if (breakdownContainer) {
            if (!packages.length) {
                breakdownContainer.innerHTML = `<p class="empty-state">No sales data yet.</p>`;
            } else {
                breakdownContainer.innerHTML = `
                    <table class="profit-table">
                        <thead>
                            <tr>
                                <th>Package</th>
                                <th>Units Sold</th>
                                <th>Sell Price</th>
                                <th>Supplier Price</th>
                                <th>Profit</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${packages.map(pkg => `
                                <tr>
                                    <td>${escapeHTML(pkg.title)}</td>
                                    <td>${pkg.unitsSold}</td>
                                    <td>${formatCurrency(pkg.sellPrice)}</td>
                                    <td>${formatCurrency(pkg.supplierPrice)}</td>
                                    <td class="${pkg.profit >= 0 ? "profit-positive" : "profit-negative"}">${formatCurrency(pkg.profit)}</td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                `;
            }
        }
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

                                            ${item?.fulfillmentStatus === "Failed"
                            ? `<button type="button" class="btn-retry" data-retry-item="${item.id}" data-retry-order="${escapeHTML(order.orderId)}">Retry Delivery</button>`
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

        const processingBtn =
            $("#markProcessingBtn");

        const completedBtn =
            $("#markCompletedBtn");

        const refundBtn =
            $("#markRefundedBtn");

        const status =
            normalizeStatus(
                getOrderStatus(
                    selectedOrder
                )
            );

        if (processingBtn) {
            processingBtn.style.display =
                (status === "processing" ||
                    status === "completed" ||
                    status === "refunded")
                    ? "none"
                    : "inline-flex";
        }

        if (completedBtn) {
            completedBtn.style.display =
                (status === "completed" ||
                    status === "refunded")
                    ? "none"
                    : "inline-flex";
        }

        if (refundBtn) {
            refundBtn.style.display =
                status === "refunded"
                    ? "none"
                    : "inline-flex";
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
    function renderProducts() {
        const container = $("#adminProductsList");
        if (!container) return;

        if (!products.length) {
            container.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">◇</div>
                <h4>Product catalog</h4>
                <p>Your products will appear here.</p>
            </div>
        `;
            return;
        }

        const categoryLabels = {
            mobile_legends_global: "🌍 Global",
            mobile_legends_philippines: "🇵🇭 Philippines"
        };

        const grouped = {};
        products.forEach(p => {
            const cat = p.categoryId || "other";
            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(p);
        });

        container.innerHTML = Object.keys(grouped).map(cat => `
            <div class="product-category-group">
                <h2 class="product-category-heading">${escapeHTML(categoryLabels[cat] || cat)}</h2>
                <div class="product-category-grid">
                    ${grouped[cat].map(p => `
                        <div class="product-card" data-product-id="${p.id}">
                            <h3>${escapeHTML(p.title || p.offerId || "Product")}</h3>

                            <label class="product-edit-label">
                                Retail Price (₦)
                                <input
                                    type="number"
                                    class="product-price-input"
                                    data-product-price="${p.id}"
                                    value="${p.retailPriceNgn ?? 0}"
                                    min="0"
                                    step="1"
                                >
                            </label>

                            <label class="product-available-label">
                                <input
                                    type="checkbox"
                                    class="product-available-input"
                                    data-product-available="${p.id}"
                                    ${p.available ? "checked" : ""}
                                >
                                Available for purchase
                            </label>

                            <button type="button" class="btn-retry product-save-btn" data-product-save="${p.id}">
                                Save Changes
                            </button>
                        </div>
                    `).join("")}
                </div>
            </div>
        `).join("");
    }

    /* =====================================================
       UPDATE PRODUCT (price / availability)
    ===================================================== */
    async function updateProduct(productId) {
        const card = document.querySelector(`[data-product-id="${productId}"]`);
        if (!card) return;

        const priceInput = card.querySelector("[data-product-price]");
        const availableInput = card.querySelector("[data-product-available]");
        const saveBtn = card.querySelector("[data-product-save]");

        const retailPriceNgn = Number(priceInput.value);

        if (!Number.isFinite(retailPriceNgn) || retailPriceNgn < 0) {
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
            await loadProducts();

        } catch (error) {
            showToast(error.message || "Network error updating product.", "error");
            saveBtn.disabled = false;
            saveBtn.textContent = "Save Changes";
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
           PROCESSING
        --------------------------------------------- */

        $("#markProcessingBtn")
            ?.addEventListener(
                "click",
                () => {

                    if (!selectedOrder) {
                        return;
                    }


                    updateOrderStatus(
                        getOrderId(
                            selectedOrder
                        ),
                        "Processing"
                    );
                }
            );


        /* ---------------------------------------------
           COMPLETED
        --------------------------------------------- */

        $("#markCompletedBtn")
            ?.addEventListener(
                "click",
                () => {

                    if (!selectedOrder) {
                        return;
                    }


                    updateOrderStatus(
                        getOrderId(
                            selectedOrder
                        ),
                        "Completed"
                    );
                }
            );

        $("#markRefundedBtn")
            ?.addEventListener(
                "click",
                () => {
                    if (!selectedOrder) {
                        return;
                    }

                    updateOrderStatus(
                        getOrderId(
                            selectedOrder
                        ),
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
            $(selector);


        if (!element) {
            return;
        }


        element.textContent =
            value;
    }

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
            loadSettings()
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