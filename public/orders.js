function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
}

function formatCurrency(amount) {
    const value = Number(amount || 0);
    return "₦" + value.toLocaleString("en-NG");
}

async function checkLoginAndLoadOrders() {
    try {
        const meResponse = await fetch(`/me`, { credentials: "include" });
        const meData = await meResponse.json();

        if (!meData.success || !meData.authenticated) {
            window.location.href = "/";
            return;
        }

        loadOrders();
    } catch (error) {
        window.location.href = "/";
    }
}

async function loadOrders() {
    const container = document.getElementById("ordersContainer");

    try {
        const response = await fetch(`/orders`, {
            method: "GET",
            credentials: "include",
            headers: { Accept: "application/json" }
        });

        if (!response.ok) {
            throw new Error("Failed to load orders.");
        }

        const data = await response.json();

        if (!data.success) {
            throw new Error(data.message || "Unable to load orders.");
        }

        const orders = data.orders || [];

        if (!orders.length) {
            container.innerHTML = `<p class="no-orders">No orders yet.</p>`;
            return;
        }

        container.innerHTML = orders.map(function (order) {
            const date = new Date(order.createdAt).toLocaleString();

            const items = order.items || [];
            const itemsHTML = items.map(function (item) {
                return `
                    <div class="order-item">
                        <strong>${escapeHTML(item.title)}</strong>
                        <span>${Number(item.qty || 0)} × ${formatCurrency(item.price)}</span>
                        <small>Player ID: ${escapeHTML(item.playerId || "")}</small>
                        <small>Server ID: ${escapeHTML(item.serverId || "")}</small>
                        <small class="item-fulfillment-status">Delivery: ${escapeHTML(item.fulfillmentStatus || "Pending")}</small>
                    </div>
                `;
            }).join("");

            const rawPaymentStatus = String(order.paymentStatus || "Pending");
            const paymentLabel = order.paidAt || Number(order.amountCharged || 0) > 0
                ? "Paid"
                : rawPaymentStatus === "Cancelled" ? "Cancelled" : "Awaiting Payment";
            const deliveryStatuses = items.map(item => String(item.fulfillmentStatus || "Pending"));
            let deliveryLabel = "Not Started";
            if (rawPaymentStatus === "Refunded") deliveryLabel = "Refunded";
            else if (rawPaymentStatus === "Cancelled") deliveryLabel = "Cancelled";
            else if (deliveryStatuses.some(status => status === "Failed")) deliveryLabel = "Needs Attention";
            else if (deliveryStatuses.length && deliveryStatuses.every(status => status === "Completed")) deliveryLabel = "Completed";
            else if (deliveryStatuses.some(status => status === "Processing")) deliveryLabel = "Processing";
            else if (paymentLabel === "Paid") deliveryLabel = "Pending";

            return `
                <div class="order-card" data-order-id="${escapeHTML(order.orderId)}" role="button" tabindex="0" aria-expanded="false">
                    <div class="order-header">
                        <strong>${escapeHTML(order.orderId)}</strong>
                        <span class="order-status">${escapeHTML(order.status)}</span>
                    </div>
                    <div class="order-status-grid">
                        <div><span>Payment</span><strong>${escapeHTML(paymentLabel)}</strong></div>
                        <div><span>Delivery</span><strong>${escapeHTML(deliveryLabel)}</strong></div>
                    </div>

                    <div class="order-details">
                        <div class="order-date">${escapeHTML(date)}</div>
                        <div class="order-items">${itemsHTML}</div>

                        <div class="order-footer">
                            <strong>Total: ${formatCurrency(order.orderTotal ?? order.amount ?? order.total)}</strong>
                            <small>Reference: ${escapeHTML(order.reference)}</small>
                            ${paymentLabel === "Paid" && ["Pending", "Processing"].includes(deliveryLabel)
                                ? `<small class="order-reassurance">Payment confirmed — do not pay again. We are still processing this delivery.</small>`
                                : ""}
                        </div>
                    </div>
                </div>
            `;
        }).join("");

        document.querySelectorAll(".order-card").forEach(function (card) {
            function toggleOrder() {
                const isExpanded = card.classList.contains("expanded");
                card.classList.toggle("expanded");
                card.setAttribute("aria-expanded", String(!isExpanded));
            }

            card.addEventListener("click", toggleOrder);

            card.addEventListener("keydown", function (event) {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleOrder();
                }
            });
        });

        const requestedOrderId = new URLSearchParams(window.location.search).get("order");
        if (requestedOrderId) {
            const target = Array.from(document.querySelectorAll(".order-card")).find(card => card.dataset.orderId === requestedOrderId);
            if (target) {
                target.classList.add("expanded", "tracked-order");
                target.setAttribute("aria-expanded", "true");
                target.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        }

    } catch (error) {
        container.innerHTML = `<p class="no-orders">Could not load orders. Please refresh.</p>`;
    }
}

async function logoutUser() {
    try {
        await secureFetch(
            "/logout",
            {
                method: "POST"
            }
        );
    } catch (error) {
        console.error(
            "Logout failed:",
            error
        );
    }

    window.location.href =
        "/";
}


document
    .getElementById("ordersLogoutBtn")
    ?.addEventListener(
        "click",
        logoutUser
    );


document
    .getElementById("mobileOrdersLogoutBtn")
    ?.addEventListener(
        "click",
        logoutUser
    );

const mobileMenuButton =
    document.querySelector(".mobile-menu-btn");

const navWrapper =
    document.querySelector(".nav-wrapper");

const mobileMenu =
    document.getElementById("mobileMenu");

mobileMenuButton?.addEventListener(
    "click",
    function () {

        const isOpen =
            navWrapper?.classList.toggle(
                "mobile-open"
            );

        mobileMenu?.classList.toggle(
            "mobile-menu-open",
            Boolean(isOpen)
        );

        mobileMenuButton.classList.toggle(
            "active",
            Boolean(isOpen)
        );

        mobileMenuButton.setAttribute(
            "aria-expanded",
            String(Boolean(isOpen))
        );
    }
);

mobileMenu
    ?.querySelectorAll("a")
    .forEach(link => {

        link.addEventListener(
            "click",
            function () {

                navWrapper?.classList.remove(
                    "mobile-open"
                );

                mobileMenu.classList.remove(
                    "mobile-menu-open"
                );

                mobileMenuButton?.classList.remove(
                    "active"
                );

                mobileMenuButton?.setAttribute(
                    "aria-expanded",
                    "false"
                );
            }
        );
    });

document.addEventListener("DOMContentLoaded", checkLoginAndLoadOrders);
