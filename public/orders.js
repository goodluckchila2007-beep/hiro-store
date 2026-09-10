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
            window.location.href = "index.html";
            return;
        }

        loadOrders();
    } catch (error) {
        window.location.href = "index.html";
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

            const itemsHTML = (order.items || []).map(function (item) {
                return `
                    <div class="order-item">
                        <strong>${escapeHTML(item.title)}</strong>
                        <span>${Number(item.qty || 0)} × ${formatCurrency(item.price)}</span>
                        <small>Player ID: ${escapeHTML(item.playerId || "")}</small>
                        <small>Server ID: ${escapeHTML(item.serverId || "")}</small>
                        <small class="item-fulfillment-status">${escapeHTML(item.fulfillmentStatus || "Pending")}</small>
                    </div>
                `;
            }).join("");

            return `
                <div class="order-card" role="button" tabindex="0" aria-expanded="false">
                    <div class="order-header">
                        <strong>${escapeHTML(order.orderId)}</strong>
                        <span class="order-status">${escapeHTML(order.status)}</span>
                    </div>

                    <div class="order-details">
                        <div class="order-date">${escapeHTML(date)}</div>
                        <div class="order-items">${itemsHTML}</div>

                        <div class="order-footer">
                            <strong>Total: ${formatCurrency(order.amount ?? order.total)}</strong>
                            <small>Reference: ${escapeHTML(order.reference)}</small>
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

    } catch (error) {
        container.innerHTML = `<p class="no-orders">Could not load orders. Please refresh.</p>`;
    }
}

document.getElementById("ordersLogoutBtn")?.addEventListener("click", async () => {
    try {
        await fetch(`/logout`, { method: "POST", credentials: "include" });
    } catch (error) {}
    window.location.href = "index.html";
});

document.addEventListener("DOMContentLoaded", checkLoginAndLoadOrders);
