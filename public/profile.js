const AVATAR_COUNT = 8;

let CSRF_TOKEN = null;

function escapeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
}

async function loadCsrfToken() {
    try {
        const response = await fetch(`/csrf-token`, {
            credentials: "include"
        });
        const data = await response.json();

        if (!response.ok || !data.csrfToken) {
            throw new Error("Unable to obtain CSRF token.");
        }

        CSRF_TOKEN = data.csrfToken;
    } catch (error) {
        console.error("Could not load CSRF token:", error);
    }
}

async function secureFetch(url, options = {}) {
    const method = (options.method || "GET").toUpperCase();
    const needsToken = !["GET", "HEAD", "OPTIONS"].includes(method);

    if (needsToken && !CSRF_TOKEN) {
        await loadCsrfToken();
    }

    const opts = {
        ...options,
        credentials: "include",
        headers: {
            ...(options.headers || {}),
            ...(needsToken ? { "X-CSRF-Token": CSRF_TOKEN } : {})
        }
    };

    let response = await fetch(url, opts);

    if (needsToken && response.status === 403) {
        await loadCsrfToken();
        opts.headers["X-CSRF-Token"] = CSRF_TOKEN;
        response = await fetch(url, opts);
    }

    return response;
}

async function loadProfile() {
    const container = document.getElementById("profilePage");

    try {
        const response = await fetch(`/me`, {
            credentials: "include"
        });
        const data = await response.json();

        if (!data.success || !data.authenticated || !data.user) {
            window.location.href = "index.html";
            return;
        }

        renderProfile(data.user);
    } catch (error) {
        container.innerHTML = `<div class="profile-loading">Could not load your account. Please refresh.</div>`;
    }
}

function renderProfile(user) {
    const container = document.getElementById("profilePage");
    const avatar = user.avatar || "avatar-1";

    container.innerHTML = `
        <div class="profile-greeting-card">
            <img src="img/avatars/${escapeHTML(avatar)}.png" alt="Your avatar">
            <div>
                <h1>Welcome to Hiro Store, ${escapeHTML(user.name || "Player")}</h1>
                <p>Manage your account and orders in one place.</p>
            </div>
        </div>

        <div class="profile-card" data-action="orders">
            <div class="profile-card-left">
                <div class="profile-card-icon">📦</div>
                <div class="profile-card-text">
                    <strong>My Orders</strong>
                    <span>Track purchases and view order history.</span>
                </div>
            </div>
            <div class="profile-card-arrow">›</div>
        </div>

        <div class="profile-card" data-action="details">
            <div class="profile-card-left">
                <div class="profile-card-icon">⚙️</div>
                <div class="profile-card-text">
                    <strong>Account Details</strong>
                    <span>Update your username and avatar.</span>
                </div>
            </div>
            <div class="profile-card-arrow">›</div>
        </div>

        <div class="profile-card" data-action="support">
            <div class="profile-card-left">
                <div class="profile-card-icon">🎧</div>
                <div class="profile-card-text">
                    <strong>Help Centre</strong>
                    <span>Chat with our support team.</span>
                </div>
            </div>
            <div class="profile-card-arrow">›</div>
        </div>

        <div class="account-details-panel" id="accountDetailsPanel">
            <label for="profileEmail">Email (cannot be changed)</label>
            <input type="email" id="profileEmail" value="${escapeHTML(user.email || "")}" disabled>

            <label for="profileName">Username</label>
            <input type="text" id="profileName" value="${escapeHTML(user.name || "")}">

            <button type="button" class="change-avatar-toggle" id="changeAvatarToggle">Change avatar</button>
            <div class="avatar-grid" id="avatarGrid" style="display:none;"></div>

            <button type="button" class="save-profile-btn" id="saveProfileBtn">Save Changes</button>
        </div>

        <footer class="site-footer" aria-label="Legal and support links">
            <p>&copy; 2026 HIRO OFFICIAL STORE. All rights reserved.</p>
            <nav>
                <a href="refund-policy.html">Refund &amp; Cancellation</a>
                <a href="privacy-policy.html">Privacy Policy</a>
                <a href="terms.html">Terms of Service</a>
                <a href="mailto:support@hirostore.site">Contact Support</a>
            </nav>
        </footer>
    `;

    const avatarGrid = document.getElementById("avatarGrid");
    let selectedAvatar = avatar;
    for (let i = 1; i <= AVATAR_COUNT; i++) {
        const id = `avatar-${i}`;
        const img = document.createElement("img");
        img.src = `img/avatars/${id}.png`;
        img.className = "avatar-option" + (id === avatar ? " selected" : "");
        img.dataset.avatarId = id;
        img.addEventListener("click", () => {
            selectedAvatar = id;
            document.querySelectorAll(".avatar-option").forEach(el => el.classList.remove("selected"));
            img.classList.add("selected");
        });
        avatarGrid.appendChild(img);
    }

    document.getElementById("changeAvatarToggle").addEventListener("click", () => {
        const isHidden = avatarGrid.style.display === "none";
        avatarGrid.style.display = isHidden ? "grid" : "none";
    });

    document.querySelectorAll(".profile-card").forEach(card => {
        card.addEventListener("click", () => {
            const action = card.dataset.action;
            const panel = document.getElementById("accountDetailsPanel");

            if (action === "details") {
                panel.classList.toggle("open");
                return;
            }
            panel.classList.remove("open");

            if (action === "orders") {
                window.location.href = "orders.html";
            } else if (action === "support") {
                document.getElementById("complaintModal").style.display = "flex";
                loadSupportThreadStandalone();
            }
        });
    });

    document.getElementById("saveProfileBtn").addEventListener("click", async () => {
        const name = document.getElementById("profileName").value.trim();

        try {
            const response = await secureFetch(`/me`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, avatar: selectedAvatar })
            });
            const data = await response.json();

            if (!data.success) {
                if (window.showToast) window.showToast(data.message || "Could not save changes.", "error");
                return;
            }

            if (window.showToast) window.showToast("Profile updated.", "success");
            renderProfile(data.user);
        } catch (error) {
            if (window.showToast) window.showToast("Network error saving profile.", "error");
        }
    });
}

async function loadSupportThreadStandalone() {
    const thread = document.getElementById("chatThread");
    thread.innerHTML = `<p class="chat-loading">Loading conversation...</p>`;

    try {
        const response = await fetch(`/api/support/conversation`, {
            credentials: "include"
        });
        const data = await response.json();

        if (!data.success || !data.messages || !data.messages.length) {
            thread.innerHTML = `<p class="chat-loading">Send a message to start a conversation with our team.</p>`;
            return;
        }

        thread.innerHTML = data.messages.map(msg => {
            const isCustomer = msg.sender_role === "customer";
            return `
                <div class="chat-bubble ${isCustomer ? "chat-bubble-mine" : "chat-bubble-theirs"}">
                    <strong>${escapeHTML(msg.sender_name)}</strong>
                    <p>${escapeHTML(msg.message)}</p>
                </div>
            `;
        }).join("");

        thread.scrollTop = thread.scrollHeight;
    } catch (error) {
        thread.innerHTML = `<p class="chat-loading">Could not load messages.</p>`;
    }
}

document.getElementById("sendChatBtn")?.addEventListener("click", async () => {
    const input = document.getElementById("chatMessageInput");
    const message = input.value.trim();

    if (message.length < 2) {
        if (window.showToast) window.showToast("Type a message first.", "error");
        return;
    }

    try {
        const response = await secureFetch(`/api/support/conversation`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ message })
        });
        const data = await response.json();

        if (!data.success) {
            if (window.showToast) window.showToast(data.message || "Could not send message.", "error");
            return;
        }

        input.value = "";
        loadSupportThreadStandalone();
    } catch (error) {
        if (window.showToast) window.showToast("Network error sending message.", "error");
    }
});

document.querySelector(".close-complaint")?.addEventListener("click", () => {
    document.getElementById("complaintModal").style.display = "none";
});

document.getElementById("profileLogoutBtn")?.addEventListener("click", async () => {
    try {
        await secureFetch(`/logout`, {
            method: "POST"
        });
    } catch (error) {}
    window.location.href = "index.html";
});

document.addEventListener("DOMContentLoaded", loadProfile);
