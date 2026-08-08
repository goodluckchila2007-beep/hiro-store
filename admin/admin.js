/* =========================================================
   HIRO STORE — ADMIN DASHBOARD
========================================================= */

(() => {
    "use strict";

    const API_URL = "http://localhost:3000";

    let orders = [];
    let selectedOrder = null;

    /* =====================================================
       DOM HELPERS
    ===================================================== */

    const $ = (selector) => document.querySelector(selector);

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
        if (!date) return "—";

        const parsed = new Date(date);

        if (Number.isNaN(parsed.getTime())) {
            return "—";
        }

        return parsed.toLocaleString("en-NG");
    }


    function escapeHTML(value) {
        return String(value ?? "").replace(/[&<>"']/g, char => ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#039;"
        })[char]);
    }


    /* =====================================================
       ORDER VALUE HELPERS
    ===================================================== */

    function getOrderTotal(order) {
        return Number(
            order.orderTotal ??
            order.order_total ??
            0
        );
    }


    function getAmountCharged(order) {
        return Number(
            order.amountCharged ??
            order.amount_charged ??
            0
        );
    }


    function getOrderId(order) {
        return String(
            order.orderId ??
            order.order_id ??
            "—"
        );
    }


    /* =====================================================
       TOAST
    ===================================================== */

    function showToast(message) {

        const container = $("#adminToastContainer");

        if (!container) return;

        const toast = document.createElement("div");

        toast.className = "admin-toast";

        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(() => {
            toast.remove();
        }, 3000);
    }


    /* =====================================================
       LOAD ORDERS FROM SQLITE
    ===================================================== */

    async function loadOrders() {

        try {

            showToast("Loading orders...");

            const response = await fetch(
                `${API_URL}/orders`
            );

            if (!response.ok) {
                throw new Error(
                    `Server returned ${response.status}`
                );
            }

            const data = await response.json();

            if (!data.success) {
                throw new Error(
                    data.message ||
                    "Unable to load orders."
                );
            }

            orders = Array.isArray(data.orders)
                ? data.orders
                : [];

            console.log("Orders loaded from SQLite:", orders);

            renderDashboard();
            renderOrders();
            renderProcessing();
            renderCompleted();
            updateNavigationCounts();

            showToast(
                `${orders.length} order(s) loaded.`
            );

        } catch (error) {

            console.error(
                "Could not load orders:",
                error
            );

            showToast(
                "Could not connect to the Hiro Store server."
            );
        }
    }


    /* =====================================================
       DASHBOARD
    ===================================================== */

    function renderDashboard() {

        const totalOrders =
            orders.length;


        /*
           IMPORTANT:

           Revenue uses AMOUNT CHARGED,
           not orderTotal.

           Example:

           Order Total = ₦1,200
           Amount Charged = ₦1,218

           Revenue = ₦1,218
        */

        const totalRevenue =
            orders.reduce(
                (sum, order) =>
                    sum + getAmountCharged(order),
                0
            );


        const processing =
            orders.filter(
                order =>
                    String(order.status || "")
                        .toLowerCase() === "processing"
            ).length;


        const completed =
            orders.filter(
                order =>
                    String(order.status || "")
                        .toLowerCase() === "completed"
            ).length;


        const totalOrdersEl =
            $("#totalOrders");

        const totalRevenueEl =
            $("#totalRevenue");

        const processingEl =
            $("#processingOrders");

        const completedEl =
            $("#completedOrders");


        if (totalOrdersEl) {
            totalOrdersEl.textContent =
                totalOrders;
        }


        if (totalRevenueEl) {
            totalRevenueEl.textContent =
                formatCurrency(totalRevenue);
        }


        if (processingEl) {
            processingEl.textContent =
                processing;
        }


        if (completedEl) {
            completedEl.textContent =
                completed;
        }


        renderRecentOrders();
    }


    /* =====================================================
       RECENT ORDERS
    ===================================================== */

    function renderRecentOrders() {

        const container =
            $("#recentOrders");

        if (!container) return;


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
                            b.createdAt || b.paidAt
                        ) -
                        new Date(
                            a.createdAt || a.paidAt
                        )
                )
                .slice(0, 5);


        container.innerHTML =
            recent.map(order => {

                const firstItem =
                    order.items?.[0];

                const itemText =
                    firstItem
                        ? `${firstItem.title}${order.items.length > 1
                            ? ` + ${order.items.length - 1} more`
                            : ""
                        }`
                        : "No item";


                return `
                    <div
                        class="recent-order-row"
                        style="
                            display:flex;
                            align-items:center;
                            justify-content:space-between;
                            gap:15px;
                            padding:16px 20px;
                            border-bottom:1px solid #f0f0f0;
                            cursor:pointer;
                        "
                        data-order-id="${escapeHTML(
                    getOrderId(order)
                )}"
                    >

                        <div style="min-width:0">

                            <strong
                                style="
                                    display:block;
                                    font-family:Georgia,serif;
                                    font-size:12px;
                                    color:#222;
                                "
                            >
                                ${escapeHTML(
                    getOrderId(order)
                )}
                            </strong>

                            <small
                                style="
                                    display:block;
                                    margin-top:4px;
                                    color:#999;
                                    font-size:9px;
                                "
                            >
                                ${escapeHTML(itemText)}
                            </small>

                        </div>


                        <div
                            style="
                                text-align:right;
                                flex-shrink:0;
                            "
                        >

                            <strong
                                style="
                                    display:block;
                                    font-size:12px;
                                    color:#222;
                                "
                            >
                                ${formatCurrency(
                    getAmountCharged(order)
                )}
                            </strong>

                            <small
                                style="
                                    display:block;
                                    margin-top:4px;
                                    color:#999;
                                    font-size:9px;
                                "
                            >
                                Charged
                            </small>

                        </div>

                    </div>
                `;

            }).join("");
    }


    /* =====================================================
       ALL ORDERS
    ===================================================== */

    function renderOrders() {

        const tbody =
            $("#ordersTableBody");

        if (!tbody) return;


        const search =
            ($("#orderSearch")?.value || "")
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

                        order.reference,

                        order.email,

                        order.phone,

                        ...(order.items || []).map(
                            item => item.playerId
                        ),

                        ...(order.items || []).map(
                            item => item.serverId
                        ),

                        ...(order.items || []).map(
                            item => item.title
                        )

                    ]
                        .join(" ")
                        .toLowerCase();


                    if (
                        !searchable.includes(search)
                    ) {
                        return false;
                    }
                }


                /* STATUS */

                if (
                    status !== "all" &&
                    String(order.status || "")
                        .toLowerCase() !==
                    status.toLowerCase()
                ) {
                    return false;
                }


                /* DATE */

                if (dateFilter !== "all") {

                    const orderDate =
                        new Date(
                            order.createdAt ||
                            order.paidAt
                        );

                    const now =
                        new Date();


                    if (
                        Number.isNaN(
                            orderDate.getTime()
                        )
                    ) {
                        return false;
                    }


                    if (dateFilter === "today") {

                        const sameDay =
                            orderDate.toDateString() ===
                            now.toDateString();

                        if (!sameDay) {
                            return false;
                        }
                    }


                    if (dateFilter === "week") {

                        const difference =
                            now - orderDate;

                        const sevenDays =
                            7 *
                            24 *
                            60 *
                            60 *
                            1000;

                        if (
                            difference < 0 ||
                            difference > sevenDays
                        ) {
                            return false;
                        }
                    }


                    if (dateFilter === "month") {

                        const difference =
                            now - orderDate;

                        const thirtyDays =
                            30 *
                            24 *
                            60 *
                            60 *
                            1000;

                        if (
                            difference < 0 ||
                            difference > thirtyDays
                        ) {
                            return false;
                        }
                    }
                }


                return true;
            });


        if (!filtered.length) {

            tbody.innerHTML = `
                <tr>

                    <td
                        colspan="7"
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
            filtered.map(order => {

                const items =
                    order.items || [];

                const firstItem =
                    items[0];


                const purchase =
                    firstItem
                        ? `${escapeHTML(firstItem.title)}${items.length > 1
                            ? ` <small>+ ${items.length - 1} more</small>`
                            : ""
                        }`
                        : "—";


                const statusClass =
                    String(order.status || "")
                        .toLowerCase()
                        .replace(/\s+/g, "-");


                const orderTotal =
                    getOrderTotal(order);

                const amountCharged =
                    getAmountCharged(order);


                return `
                    <tr>

                        <td>

                            <strong
                                style="
                                    display:block;
                                    color:#222;
                                    font-family:Georgia,serif;
                                "
                            >
                                ${escapeHTML(
                    getOrderId(order)
                )}
                            </strong>

                            <small
                                style="
                                    display:block;
                                    margin-top:4px;
                                    color:#999;
                                    font-size:9px;
                                "
                            >
                                ${escapeHTML(
                    order.reference || "—"
                )}
                            </small>

                        </td>


                        <td>

                            <strong
                                style="
                                    display:block;
                                    color:#444;
                                    font-size:10px;
                                "
                            >
                                ${escapeHTML(
                    order.email || "—"
                )}
                            </strong>

                            <small
                                style="
                                    display:block;
                                    margin-top:4px;
                                    color:#999;
                                    font-size:9px;
                                "
                            >
                                ${escapeHTML(
                    order.phone ||
                    "No phone"
                )}
                            </small>

                        </td>


                        <td>

                            <span>
                                ${purchase}
                            </span>

                            ${firstItem
                        ? `
                                        <small
                                            style="
                                                display:block;
                                                margin-top:5px;
                                                color:#999;
                                                font-size:9px;
                                            "
                                        >
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

                        </td>


                        <td>

                            <div
                                style="
                                    display:flex;
                                    flex-direction:column;
                                    gap:4px;
                                "
                            >

                                <strong>
                                    ${formatCurrency(
                        orderTotal
                    )}
                                </strong>

                                <small
                                    style="
                                        color:#999;
                                        font-size:9px;
                                    "
                                >
                                    Charged:
                                    ${formatCurrency(
                        amountCharged
                    )}
                                </small>

                            </div>

                        </td>


                        <td>

                            <span
                                class="status-badge ${statusClass}"
                            >
                                ${escapeHTML(
                        order.status ||
                        "Unknown"
                    )}
                            </span>

                        </td>


                        <td>

                            <span
                                style="
                                    white-space:nowrap;
                                    color:#777;
                                    font-size:10px;
                                "
                            >
                                ${formatDate(
                        order.createdAt ||
                        order.paidAt
                    )}
                            </span>

                        </td>


                        <td>

                            <button
                                class="order-action-btn"
                                data-view-order="${escapeHTML(
                        getOrderId(order)
                    )}"
                                type="button"
                            >
                                View
                            </button>

                        </td>

                    </tr>
                `;

            }).join("");
    }


    /* =====================================================
       PROCESSING
    ===================================================== */

    function renderProcessing() {

        const container =
            $("#processingOrdersList");

        if (!container) return;


        const processing =
            orders.filter(
                order =>
                    String(order.status || "")
                        .toLowerCase() ===
                    "processing"
            );


        if (!processing.length) {

            container.innerHTML = `
                <div class="empty-state">

                    <div class="empty-icon">
                        ⏳
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

        if (!container) return;


        const completed =
            orders.filter(
                order =>
                    String(order.status || "")
                        .toLowerCase() ===
                    "completed"
            );


        if (!completed.length) {

            container.innerHTML = `
                <div class="empty-state">

                    <div class="empty-icon">
                        ✅
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
       ORDER CARD
    ===================================================== */

    function createOrderCard(order) {

        const items =
            order.items || [];


        const orderTotal =
            getOrderTotal(order);

        const amountCharged =
            getAmountCharged(order);


        return `
            <div
                class="dashboard-panel"
                style="
                    padding:20px;
                "
            >

                <div
                    style="
                        display:flex;
                        justify-content:space-between;
                        gap:12px;
                        margin-bottom:16px;
                    "
                >

                    <div>

                        <strong
                            style="
                                display:block;
                                font-family:Georgia,serif;
                                font-size:14px;
                            "
                        >
                            ${escapeHTML(
            getOrderId(order)
        )}
                        </strong>

                        <small
                            style="
                                display:block;
                                margin-top:4px;
                                color:#999;
                                font-size:9px;
                            "
                        >
                            ${formatDate(
            order.createdAt
        )}
                        </small>

                    </div>


                    <span
                        class="status-badge ${String(
            order.status || ""
        ).toLowerCase()}"
                    >
                        ${escapeHTML(
            order.status ||
            "Unknown"
        )}
                    </span>

                </div>


                <div
                    style="
                        padding:12px;
                        background:#fafafa;
                        border-radius:10px;
                        margin-bottom:14px;
                    "
                >

                    ${items.map(item => `

                        <div
                            style="
                                padding:7px 0;
                                border-bottom:1px solid #eee;
                            "
                        >

                            <strong
                                style="
                                    display:block;
                                    font-size:11px;
                                "
                            >
                                ${escapeHTML(
            item.title
        )}
                            </strong>

                            <small
                                style="
                                    display:block;
                                    margin-top:3px;
                                    color:#888;
                                    font-size:9px;
                                "
                            >
                                Quantity:
                                ${Number(
            item.qty || 1
        )}

                                ·

                                Price:
                                ${formatCurrency(
            item.price
        )}

                                ·

                                Player:
                                ${escapeHTML(
            item.playerId ||
            "—"
        )}

                                ·

                                Server:
                                ${escapeHTML(
            item.serverId ||
            "—"
        )}
                            </small>

                        </div>

                    `).join("")}

                </div>


                <div
                    style="
                        display:flex;
                        justify-content:space-between;
                        align-items:center;
                        gap:10px;
                    "
                >

                    <div>

                        <strong>
                            ${formatCurrency(
            orderTotal
        )}
                        </strong>

                        <small
                            style="
                                display:block;
                                margin-top:3px;
                                color:#999;
                                font-size:9px;
                            "
                        >
                            Charged:
                            ${formatCurrency(
            amountCharged
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

        const orderCount =
            $("#navOrderCount");

        const processingCount =
            $("#navProcessingCount");


        if (orderCount) {
            orderCount.textContent =
                orders.length;
        }


        if (processingCount) {

            processingCount.textContent =
                orders.filter(
                    order =>
                        String(order.status || "")
                            .toLowerCase() ===
                        "processing"
                ).length;
        }
    }


    /* =====================================================
       OPEN ORDER MODAL
    ===================================================== */

    function openOrderModal(orderId) {

        const order =
            orders.find(
                item =>
                    getOrderId(item) ===
                    String(orderId)
            );

        if (!order) return;

        selectedOrder = order;


        const modal =
            $("#orderModal");

        const title =
            $("#orderModalTitle");

        const body =
            $("#orderModalBody");


        if (!modal || !body) return;


        if (title) {
            title.textContent =
                getOrderId(order);
        }


        const items =
            order.items || [];


        const orderTotal =
            getOrderTotal(order);

        const amountCharged =
            getAmountCharged(order);


        body.innerHTML = `

            <!-- MONEY SUMMARY -->

            <div
                style="
                    display:grid;
                    grid-template-columns:
                        repeat(2,minmax(0,1fr));
                    gap:12px;
                    margin-bottom:20px;
                "
            >

                <div
                    style="
                        padding:14px;
                        background:#fafafa;
                        border-radius:10px;
                    "
                >

                    <small
                        style="
                            color:#999;
                            font-size:9px;
                        "
                    >
                        ORDER TOTAL
                    </small>

                    <strong
                        style="
                            display:block;
                            margin-top:5px;
                            font-size:15px;
                        "
                    >
                        ${formatCurrency(
            orderTotal
        )}
                    </strong>

                </div>


                <div
                    style="
                        padding:14px;
                        background:#fafafa;
                        border-radius:10px;
                    "
                >

                    <small
                        style="
                            color:#999;
                            font-size:9px;
                        "
                    >
                        AMOUNT CHARGED
                    </small>

                    <strong
                        style="
                            display:block;
                            margin-top:5px;
                            font-size:15px;
                        "
                    >
                        ${formatCurrency(
            amountCharged
        )}
                    </strong>

                </div>


                <div
                    style="
                        padding:14px;
                        background:#fafafa;
                        border-radius:10px;
                    "
                >

                    <small
                        style="
                            color:#999;
                            font-size:9px;
                        "
                    >
                        STATUS
                    </small>

                    <strong
                        style="
                            display:block;
                            margin-top:5px;
                            font-size:12px;
                        "
                    >
                        ${escapeHTML(
            order.status ||
            "Unknown"
        )}
                    </strong>

                </div>


                <div
                    style="
                        padding:14px;
                        background:#fafafa;
                        border-radius:10px;
                    "
                >

                    <small
                        style="
                            color:#999;
                            font-size:9px;
                        "
                    >
                        REFERENCE
                    </small>

                    <strong
                        style="
                            display:block;
                            margin-top:5px;
                            font-size:10px;
                            word-break:break-all;
                        "
                    >
                        ${escapeHTML(
            order.reference ||
            "—"
        )}
                    </strong>

                </div>


                <div
                    style="
                        padding:14px;
                        background:#fafafa;
                        border-radius:10px;
                    "
                >

                    <small
                        style="
                            color:#999;
                            font-size:9px;
                        "
                    >
                        CUSTOMER
                    </small>

                    <strong
                        style="
                            display:block;
                            margin-top:5px;
                            font-size:11px;
                            word-break:break-word;
                        "
                    >
                        ${escapeHTML(
            order.email ||
            "—"
        )}
                    </strong>

                </div>


                <div
                    style="
                        padding:14px;
                        background:#fafafa;
                        border-radius:10px;
                    "
                >

                    <small
                        style="
                            color:#999;
                            font-size:9px;
                        "
                    >
                        PHONE
                    </small>

                    <strong
                        style="
                            display:block;
                            margin-top:5px;
                            font-size:11px;
                        "
                    >
                        ${escapeHTML(
            order.phone ||
            "—"
        )}
                    </strong>

                </div>

            </div>


            <h3
                style="
                    font-family:Georgia,serif;
                    font-size:14px;
                    margin-bottom:10px;
                "
            >
                Purchased Items
            </h3>


            <div
                style="
                    border:1px solid #eee;
                    border-radius:10px;
                    overflow:hidden;
                "
            >

                ${items.length
                ? items.map(item => `

                            <div
                                style="
                                    padding:14px;
                                    border-bottom:1px solid #eee;
                                "
                            >

                                <strong
                                    style="
                                        display:block;
                                        font-family:Georgia,serif;
                                        font-size:12px;
                                    "
                                >
                                    ${escapeHTML(
                    item.title
                )}
                                </strong>


                                <div
                                    style="
                                        display:grid;
                                        grid-template-columns:
                                            repeat(
                                                2,
                                                minmax(0,1fr)
                                            );
                                        gap:8px;
                                        margin-top:10px;
                                    "
                                >

                                    <small>
                                        Quantity:
                                        <strong>
                                            ${Number(
                    item.qty || 1
                )}
                                        </strong>
                                    </small>

                                    <small>
                                        Price:
                                        <strong>
                                            ${formatCurrency(
                    item.price
                )}
                                        </strong>
                                    </small>

                                    <small>
                                        Player ID:
                                        <strong>
                                            ${escapeHTML(
                    item.playerId ||
                    "—"
                )}
                                        </strong>
                                    </small>

                                    <small>
                                        Server ID:
                                        <strong>
                                            ${escapeHTML(
                    item.serverId ||
                    "—"
                )}
                                        </strong>
                                    </small>

                                </div>

                            </div>

                        `).join("")

                : `
                            <div
                                style="
                                    padding:20px;
                                    color:#999;
                                "
                            >
                                No items recorded.
                            </div>
                        `
            }

            </div>


            <div
                style="
                    margin-top:18px;
                    color:#999;
                    font-size:10px;
                    line-height:1.7;
                "
            >

                <div>
                    Paid:
                    ${formatDate(
                order.paidAt
            )}
                </div>

                <div>
                    Created:
                    ${formatDate(
                order.createdAt
            )}
                </div>

            </div>

        `;


        updateModalButtons();


        modal.setAttribute(
            "aria-hidden",
            "false"
        );
    }


    /* =====================================================
       MODAL BUTTON STATE
    ===================================================== */

    function updateModalButtons() {

        if (!selectedOrder) return;


        const processingBtn =
            $("#markProcessingBtn");

        const completedBtn =
            $("#markCompletedBtn");


        const status =
            String(
                selectedOrder.status || ""
            ).toLowerCase();


        if (processingBtn) {

            processingBtn.style.display =
                status === "processing" ||
                    status === "completed"
                    ? "none"
                    : "inline-flex";
        }


        if (completedBtn) {

            completedBtn.style.display =
                status === "completed"
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

        if (!modal) return;


        modal.setAttribute(
            "aria-hidden",
            "true"
        );

        selectedOrder = null;
    }


    /* =====================================================
       UPDATE ORDER STATUS
    ===================================================== */

    async function updateOrderStatus(
        orderId,
        status
    ) {

        try {

            const response =
                await fetch(
                    `${API_URL}/orders/${encodeURIComponent(
                        orderId
                    )}/status`,
                    {
                        method: "PATCH",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            status
                        })
                    }
                );


            const data =
                await response.json();


            if (!response.ok || !data.success) {

                throw new Error(
                    data.message ||
                    "Unable to update order."
                );
            }


            showToast(
                `Order marked ${status}.`
            );


            await loadOrders();


            const updated =
                orders.find(
                    order =>
                        getOrderId(order) ===
                        String(orderId)
                );


            if (updated) {

                selectedOrder =
                    updated;

                openOrderModal(
                    orderId
                );

            } else {

                closeOrderModal();

            }


        } catch (error) {

            console.error(
                "Status update failed:",
                error
            );

            showToast(
                "Could not update order status."
            );
        }
    }


    /* =====================================================
       NAVIGATION
    ===================================================== */

    function showSection(sectionName) {

        $$(".admin-section")
            .forEach(section => {

                section.classList.remove(
                    "active"
                );
            });


        const target =
            $(`#${sectionName}Section`);

        if (target) {
            target.classList.add("active");
        }


        $$(".nav-item")
            .forEach(button => {

                button.classList.toggle(
                    "active",
                    button.dataset.section ===
                    sectionName
                );
            });


        const pageTitle =
            $("#pageTitle");


        const titles = {
            dashboard: "Dashboard",
            orders: "Orders",
            processing: "Processing Orders",
            completed: "Completed Orders"
        };


        if (pageTitle) {

            pageTitle.textContent =
                titles[sectionName] ||
                "Dashboard";
        }
    }


    /* =====================================================
       EVENT LISTENERS
    ===================================================== */

    function setupEvents() {

        /* NAV */

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


        /* VIEW ALL */

        $$(".view-all-btn")
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


        /* REFRESH */

        $("#refreshBtn")
            ?.addEventListener(
                "click",
                loadOrders
            );


        /* SEARCH */

        $("#orderSearch")
            ?.addEventListener(
                "input",
                renderOrders
            );


        /* FILTERS */

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


        /* TABLE / CARD VIEW */

        document.addEventListener(
            "click",
            event => {

                const button =
                    event.target.closest(
                        "[data-view-order]"
                    );


                if (button) {

                    openOrderModal(
                        button.dataset.viewOrder
                    );

                    return;
                }


                const recent =
                    event.target.closest(
                        "[data-order-id]"
                    );


                if (recent) {

                    openOrderModal(
                        recent.dataset.orderId
                    );
                }
            }
        );


        /* CLOSE MODAL */

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


        /* PROCESSING */

        $("#markProcessingBtn")
            ?.addEventListener(
                "click",
                () => {

                    if (!selectedOrder) {
                        return;
                    }

                    updateOrderStatus(
                        getOrderId(selectedOrder),
                        "Processing"
                    );
                }
            );


        /* COMPLETED */

        $("#markCompletedBtn")
            ?.addEventListener(
                "click",
                () => {

                    if (!selectedOrder) {
                        return;
                    }

                    updateOrderStatus(
                        getOrderId(selectedOrder),
                        "Completed"
                    );
                }
            );


        /* MOBILE MENU */

        $("#mobileMenuBtn")
            ?.addEventListener(
                "click",
                () => {

                    $(".sidebar")
                        ?.classList.toggle(
                            "mobile-open"
                        );
                }
            );
    }


    /* =====================================================
       START
    ===================================================== */

    function init() {

        setupEvents();

        loadOrders();
    }


    document.addEventListener(
        "DOMContentLoaded",
        init
    );

})();