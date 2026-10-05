(function () {
  "use strict";

  // =========================================================
  // CONFIG
  // =========================================================

  // Player/server IDs should not persist indefinitely in the browser.
  // sessionStorage keeps the cart available during the current tab session
  // without leaving customer game IDs in long-lived localStorage.
  const STORAGE_KEY = "hiro_cart_v1";
  const CART_MAX_QTY = 10;
  const ORDER_HISTORY_KEY = "hiro_order_history_v1";
  // Keep the fallback aligned with the server. Products normally use the
  // retailPriceNgn value returned by /api/products.
  const FZR_EXCHANGE_RATE = 1400;

  // Set window.HIRO_API_URL only when the API is hosted separately.
  // Same-origin is the safe production default; localhost must never be
  // used by a deployed storefront.
  const API_BASE_URL = window.HIRO_API_URL || window.location.origin;

  let packages = [];
  let cart = [];

  let selectedPackage = null;
  let selectedQty = 1;
  let verifiedPlayer = null;

  window.currentUser = null;
  window.hiroPaymentsEnabled = true;


  // =========================================================
  // PRICING
  // =========================================================

  // FZR already gives us the retail USD price.
  // Convert retail USD price to NGN.
  // Do NOT add the old BlueBuff 8.5% profit again.
  function calculateSellingPrice(usdPrice) {
    const ngn = Number(usdPrice) * FZR_EXCHANGE_RATE;

    // Round to nearest ₦10
    return Math.round(ngn / 10) * 10;
  }


  // =========================================================
  // UTILITIES
  // =========================================================

  const $ = (selector, context = document) =>
    context.querySelector(selector);

  const $$ = (selector, context = document) =>
    Array.from(context.querySelectorAll(selector));

  function formatCurrency(number) {
    return "₦" + Number(number || 0).toLocaleString();
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(
      /[&<>"']/g,
      function (character) {
        const entities = {
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;"
        };

        return entities[character];
      }
    );
  }


  // =========================================================
  // TOAST SYSTEM
  // =========================================================


  function showToast(message, type = "success") {
    const container = document.getElementById("toastContainer");

    if (!container) {
      console.warn("Toast container not found:", message);
      return;
    }

    const toast = document.createElement("div");

    toast.className = `toast ${type}`;
    // Toast messages are application-generated. Keep this as text so a
    // future server/user-controlled message cannot become executable HTML.
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(function () {
      toast.classList.add("show");
    }, 10);

    setTimeout(function () {
      toast.classList.remove("show");

      setTimeout(function () {
        toast.remove();
      }, 300);
    }, 3000);
  }
  window.showToast = showToast;

  // =========================================================
  // RESEND VERIFICATION
  // ===============================================

  function showResendVerificationLink(email) {
    const existing = document.getElementById("resendVerificationBtn");
    if (existing) existing.remove();

    const btn = document.createElement("button");
    btn.id = "resendVerificationBtn";
    btn.type = "button";
    btn.textContent = "Resend verification email";
    btn.style.cssText =
      "display:block;margin:10px auto 0;background:none;border:none;color:#ff8a65;text-decoration:underline;cursor:pointer;font-size:13px;";

    btn.addEventListener("click", async function () {
      btn.disabled = true;
      btn.textContent = "Sending...";

      try {
        const response = await apiFetch(`${API_BASE_URL}/resend-verification`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: email })
        });

        const data = await response.json();
        showToast(data.message || "Check your email.", "success");
        btn.remove();

      } catch (error) {
        showToast("Network error. Please try again.", "error");
        btn.disabled = false;
        btn.textContent = "Resend verification email";
      }
    });

    const loginBtn = document.querySelector(".login-bt");
    const loginForm = loginBtn?.closest("form") || loginBtn?.parentElement;
    loginForm?.appendChild(btn);
  }

  // =========================================================
  // CSRF PROTECTION
  // =========================================================

  let CSRF_TOKEN = null;

  async function loadCsrfToken() {
    try {
      const response = await fetch(`${API_BASE_URL}/csrf-token`, {
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

  async function apiFetch(url, options = {}) {
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

    // Session regeneration (login) invalidates the old token — retry once.
    if (needsToken && response.status === 403) {
      await loadCsrfToken();
      opts.headers["X-CSRF-Token"] = CSRF_TOKEN;
      response = await fetch(url, opts);
    }

    return response;
  }


  // =========================================================
  // FZR / PAYSTACK CONFIG
  // =========================================================

  async function loadPublicStoreSettings() {
    try {
      const response =
        await fetch(
          `${API_BASE_URL}/api/store/public-settings`,
          {
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
        return;
      }

      /* -----------------------------
         PAYMENTS
      ----------------------------- */

      window.hiroPaymentsEnabled =
        data.paymentsEnabled !== false;

      syncCheckoutAvailability();


      /* -----------------------------
         ANNOUNCEMENT
      ----------------------------- */

      const announcement =
        String(
          data.announcement || ""
        ).trim();

      const banner =
        document.getElementById(
          "storeAnnouncement"
        );

      const text =
        document.getElementById(
          "storeAnnouncementText"
        );

      if (banner && text) {

        if (announcement) {
          text.textContent =
            announcement;

          banner.hidden = false;
        } else {
          text.textContent = "";
          banner.hidden = true;
        }
      }

    } catch (error) {
      console.error(
        "Could not load public store settings:",
        error
      );
    }
  }

  function syncCheckoutAvailability() {
    const checkoutButton =
      document.getElementById(
        "checkoutBtn"
      );

    if (!checkoutButton) {
      return;
    }

    if (
      window.hiroPaymentsEnabled === false
    ) {
      checkoutButton.disabled = true;

      checkoutButton.textContent =
        "⚠ Payments Temporarily Unavailable";

      checkoutButton.classList.add(
        "checkout-disabled"
      );

      checkoutButton.setAttribute(
        "aria-disabled",
        "true"
      );

    } else {

      checkoutButton.disabled = false;

      checkoutButton.textContent =
        "🔒 Secure Checkout";

      checkoutButton.classList.remove(
        "checkout-disabled"
      );

      checkoutButton.setAttribute(
        "aria-disabled",
        "false"
      );
    }
  }

  function showDiamondsSkeleton() {
    const grid = document.querySelector(".diamond-grid");
    if (!grid) return;

    const skeletonCard = `<div class="skeleton-card"><div class="skeleton-shimmer skeleton-icon"></div><div class="skeleton-shimmer skeleton-title"></div></div>`;
    grid.innerHTML = skeletonCard.repeat(6);
  }

  async function loadFzrProducts(category = "mobile_legends_global") {
    showDiamondsSkeleton();

    try {
      const response = await apiFetch(
        `${API_BASE_URL}/api/products?category=${encodeURIComponent(category)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json"
          }
        }
      );

      if (!response.ok) {
        throw new Error(
          `FZR product request failed: ${response.status}`
        );
      }

      const data = await response.json();

      if (!data.success || !Array.isArray(data.products)) {
        throw new Error(
          data.message ||
          "Invalid FZR products response."
        );
      }

      packages = data.products
        .map(function (product) {
          const retailUsd = Number(
            product.retailPriceUsd
          );

          return {
            id: String(product.offerId),

            categoryId: String(product.categoryId || category),

            title: product.title,

            usdPrice: retailUsd,

            // Keep your existing fixed/API price.
            price: Number(
              product.retailPriceNgn ||
              calculateSellingPrice(retailUsd)
            ),

            available:
              Number(product.available) === 1
          };
        });

      console.log(
        "Frontend FZR packages:",
        packages
      );

      renderFzrProductCards();

    } catch (error) {
      console.error(
        "Could not load Mobile Legends products:",
        error
      );

      showToast(
        "Unable to load Mobile Legends packages. Please refresh.",
        "error"
      );
    }
  }


  function renderFzrProductCards() {
    const grid = document.querySelector(".diamond-grid");

    if (!grid) {
      console.error("Diamond grid not found.");
      return;
    }

    if (!packages.length) {
      grid.innerHTML = `
        <div class="product-loading">
          <p>No Mobile Legends packages available.</p>
        </div>
      `;

      return;
    }

    grid.innerHTML = packages
      .filter(function (product) {
        return product.available;
      })
      .map(function (product) {
        const title =
          String(product.title || "");

        const isPass =
          title.toLowerCase().includes("pass");

        const isBonus =
          title.toLowerCase().includes("bonus");

        const isPopular =
          product.id === "weekly_pass";

        return `
          <div
            class="card"
            data-package-id="${escapeHTML(product.id)}"
          >

            ${isPopular
            ? `<span class="card-badge">POPULAR</span>`
            : ""
          }

            <div class="card-icon">
              ${isPass
            ? "🔥"
            : isBonus
              ? "🎁"
              : "💎"
          }
            </div>

            <h3>
              ${escapeHTML(product.title)}
            </h3>

          </div>
        `;
      })
      .join("");

    // Cards are dynamic, so bind them again.
    setupCardSelection();
  }

  // =========================================================
  // CART
  // =========================================================

  function loadCart() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);

      cart = raw ? JSON.parse(raw) : [];

      if (!Array.isArray(cart)) {
        cart = [];
      }
    } catch (error) {
      console.error("Could not load cart:", error);
      cart = [];
    }
  }


  function saveCart() {
    try {
      sessionStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(cart)
      );
    } catch (error) {
      console.error("Could not save cart:", error);
    }
  }


  function totalCartQty() {
    return cart.reduce(function (sum, item) {
      return sum + Number(item.qty || 0);
    }, 0);
  }


  function findCartItem(cartId) {
    return cart.find(function (item) {
      return String(item.cartId) === String(cartId);
    });
  }


  function addToCart(pkgId, qty = 1) {
    const playerId =
      document
        .querySelector("#playerId")
        ?.value
        ?.trim() || "";

    const serverId =
      document
        .querySelector("#serverId")
        ?.value
        ?.trim() || "";

    if (!playerId || !serverId) {
      showToast(
        "Please enter your Player ID and Server ID.",
        "error"
      );

      return;
    }

    if (
      !verifiedPlayer ||
      verifiedPlayer.playerId !== playerId ||
      verifiedPlayer.serverId !== serverId
    ) {
      showToast(
        "Please verify your Mobile Legends account before adding this package.",
        "warning"
      );

      return;
    }

    const pkg = packages.find(function (product) {
      return String(product.id) === String(pkgId);
    });

    if (!pkg) {
      showToast(
        "Selected package could not be found.",
        "error"
      );

      return;
    }

    const numericQty =
      Math.max(1, Math.floor(Number(qty) || 1));

    const currentTotal =
      totalCartQty();

    if (
      currentTotal + numericQty >
      CART_MAX_QTY
    ) {
      showToast(
        `Cart limit reached. Maximum ${CART_MAX_QTY} items allowed.`,
        "warning"
      );

      return;
    }

    cart.push({
      cartId:
        `${Date.now()}-${Math.random()
          .toString(36)
          .slice(2)}`,

      id: pkg.id,

      categoryId: pkg.categoryId,

      title: pkg.title,

      price: pkg.price,

      qty: numericQty,

      playerId: playerId,

      serverId: serverId,

      playerName: verifiedPlayer.playerName,

      playerRegion: verifiedPlayer.region
    });

    saveCart();

    renderCart();

    flashCartButton();

    selectedPackage = null;

    selectedQty = 1;

    const selectedBox =
      document.querySelector(".selected-box");

    if (selectedBox) {
      selectedBox.style.display = "none";
    }

    $$(".diamond-grid .card").forEach(function (card) {
      card.classList.remove("selected");
    });

    updateCartCountUI();
  }


  function removeFromCart(cartId) {
    cart = cart.filter(function (item) {
      return String(item.cartId) !== String(cartId);
    });

    saveCart();

    renderCart();
  }


  function changeQty(cartId, newQty) {
    const item = findCartItem(cartId);

    if (!item) {
      return;
    }

    newQty =
      Math.max(
        1,
        Math.floor(Number(newQty) || 1)
      );

    const currentOtherQty =
      totalCartQty() - Number(item.qty || 0);

    if (
      currentOtherQty + newQty >
      CART_MAX_QTY
    ) {
      showToast(
        `Cannot set quantity. Total cart items cannot exceed ${CART_MAX_QTY}.`,
        "warning"
      );

      renderCart();

      return;
    }

    item.qty = newQty;

    saveCart();

    renderCart();
  }


  function clearCart() {
    cart = [];

    saveCart();

    renderCart();
  }


  function renderCart() {
    const cartContainer =
      document.querySelector("#cart .cart-items") ||
      document.querySelector(".cart-items");

    if (!cartContainer) {
      return;
    }

    cartContainer.innerHTML = "";

    if (cart.length === 0) {
      cartContainer.innerHTML = `
        <div class="empty-cart">
          <div class="empty-cart-icon">🛒</div>
          <h3>Your cart is empty</h3>
          <p>
            Add a Mobile Legends package to get started.
          </p>
        </div>
      `;

      updateCartCountUI();

      return;
    }

    const list =
      document.createElement("div");

    list.className =
      "cart-items-list";

    cart.forEach(function (item) {
      const row =
        document.createElement("div");

      row.className =
        "cart-item-row";

      const icon =
        String(item.title || "")
          .toLowerCase()
          .includes("pass")
          ? "🔥"
          : "💎";

      row.innerHTML = `
        <div class="cart-product-info">

          <div class="cart-product-icon">
            ${icon}
          </div>

          <div class="cart-product-details">

            <strong>
              ${escapeHTML(item.title)}
            </strong>

            <small>
              👤 Player ID:
              ${escapeHTML(item.playerId || "")}
            </small>

            <small>
              🌐 Server ID:
              ${escapeHTML(item.serverId || "")}
            </small>

            <div class="cart-price">
              ${formatCurrency(item.price)} each
            </div>

          </div>

        </div>

        <div class="cart-actions">

          <button
            type="button"
            class="decrease"
            data-id="${escapeHTML(item.cartId)}"
            title="Decrease quantity"
          >
            −
          </button>

          <input
            class="cart-qty"
            data-id="${escapeHTML(item.cartId)}"
            type="number"
            min="1"
            max="${CART_MAX_QTY}"
            value="${Number(item.qty || 1)}"
          >

          <button
            type="button"
            class="increase"
            data-id="${escapeHTML(item.cartId)}"
            title="Increase quantity"
          >
            +
          </button>

          <button
            type="button"
            class="remove"
            data-id="${escapeHTML(item.cartId)}"
          >
            Remove
          </button>

        </div>
      `;

      list.appendChild(row);
    });

    const summary =
      document.createElement("div");

    summary.className =
      "cart-summary";

    const totalAmount =
      cart.reduce(function (sum, item) {
        return (
          sum +
          Number(item.price || 0) *
          Number(item.qty || 0)
        );
      }, 0);

    const totalQty =
      totalCartQty();

    summary.innerHTML = `
      <div class="cart-total-row">

        <div class="cart-total-label">
          Total (
          ${totalQty}
          item${totalQty === 1 ? "" : "s"}
          )
        </div>

        <div class="cart-total-value">
          ${formatCurrency(totalAmount)}
        </div>

      </div>

      <div class="cart-buttons">

        <button
          type="button"
          id="clearCartBtn"
        >
          Clear Cart
        </button>

        <button
          type="button"
          id="checkoutBtn"
        >
          🔒 Secure Checkout
        </button>

      </div>
    `;

    cartContainer.appendChild(list);

    cartContainer.appendChild(summary);

    updateCartCountUI();

    syncCheckoutAvailability();
  }


  function updateCartCountUI() {
    const qty =
      totalCartQty();

    const badge =
      document.querySelector("#cartCount");

    if (badge) {
      badge.textContent = qty;
    }

    const cartButton =
      document.querySelector(".cart-btn-main");

    if (cartButton) {
      if (selectedPackage) {
        cartButton.textContent =
          "➕ Add Selected Package";
      } else {
        cartButton.textContent =
          `🛒 View Cart (${qty})`;
      }
    }
  }


  function flashCartButton() {
    const cartButton =
      document.querySelector(".cart-btn-main");

    if (!cartButton) {
      return;
    }

    if (
      typeof cartButton.animate ===
      "function"
    ) {
      cartButton.animate(
        [
          {
            transform: "scale(1)"
          },
          {
            transform: "scale(1.05)"
          },
          {
            transform: "scale(1)"
          }
        ],
        {
          duration: 300
        }
      );
    }
  }


  // =========================================================
  // CART LISTENERS
  // =========================================================

  function setupCartListeners() {
    const cartContainer =
      document.querySelector(
        "#cart .cart-items"
      ) ||
      document.querySelector(
        ".cart-items"
      );

    if (!cartContainer) {
      return;
    }

    if (
      cartContainer.dataset.listenersBound ===
      "true"
    ) {
      return;
    }

    cartContainer.dataset.listenersBound =
      "true";

    cartContainer.addEventListener(
      "click",
      function (event) {
        const removeButton =
          event.target.closest(".remove");

        if (removeButton) {
          removeFromCart(
            removeButton.dataset.id
          );

          return;
        }

        const increaseButton =
          event.target.closest(".increase");

        if (increaseButton) {
          const id =
            increaseButton.dataset.id;

          const item =
            findCartItem(id);

          if (!item) {
            return;
          }

          changeQty(
            id,
            Number(item.qty) + 1
          );

          return;
        }

        const decreaseButton =
          event.target.closest(".decrease");

        if (decreaseButton) {
          const id =
            decreaseButton.dataset.id;

          const item =
            findCartItem(id);

          if (!item) {
            return;
          }

          changeQty(
            id,
            Math.max(
              1,
              Number(item.qty) - 1
            )
          );

          return;
        }

        if (
          event.target.id ===
          "clearCartBtn"
        ) {
          if (
            window.confirm(
              "Clear cart?"
            )
          ) {
            clearCart();
          }

          return;
        }

        if (
          event.target.id ===
          "checkoutBtn"
        ) {
          openCheckout();

          return;
        }
      }
    );

    cartContainer.addEventListener(
      "change",
      function (event) {
        if (
          event.target.matches(".cart-qty")
        ) {
          const id =
            event.target.dataset.id;

          const value =
            parseInt(
              event.target.value || "1",
              10
            );

          changeQty(
            id,
            Math.max(
              1,
              Number.isFinite(value)
                ? value
                : 1
            )
          );
        }
      }
    );
  }


  // =========================================================
  // PACKAGE SELECTION
  // =========================================================

  function setupCardSelection() {
    const cards =
      $$(".diamond-grid .card");

    const selectedBox =
      $(".selected-box");

    const titleElement =
      $("#selectedTitle");

    const priceElement =
      $("#selectedPrice");

    const quantityElement =
      $("#qtyValue");

    if (!cards.length) {
      return;
    }

    if (
      !selectedBox ||
      !titleElement ||
      !priceElement ||
      !quantityElement
    ) {
      console.error(
        "Selected package elements are missing."
      );

      return;
    }

    cards.forEach(function (card) {
      if (
        card.dataset.selectionBound ===
        "true"
      ) {
        return;
      }

      card.dataset.selectionBound =
        "true";

      card.addEventListener(
        "click",
        function () {
          const packageId =
            card.dataset.packageId;

          if (!packageId) {
            console.error(
              "Card missing data-package-id:",
              card
            );

            showToast(
              "Package configuration error.",
              "error"
            );

            return;
          }

          const pkg =
            packages.find(function (product) {
              return (
                String(product.id) ===
                String(packageId)
              );
            });

          if (!pkg) {
            console.error(
              "Package not found:",
              packageId
            );

            return;
          }

          cards.forEach(function (otherCard) {
            otherCard.classList.remove(
              "selected"
            );
          });

          card.classList.add("selected");

          selectedPackage =
            pkg;

          selectedQty = 1;

          titleElement.textContent =
            selectedPackage.title;

          priceElement.textContent =
            formatCurrency(
              selectedPackage.price *
              selectedQty
            );

          quantityElement.textContent =
            selectedQty;

          selectedBox.style.display =
            "flex";

          updateCartCountUI();

          selectedBox.scrollIntoView({
            behavior: "smooth",
            block: "center"
          });
        }
      );
    });

    const plusButton =
      $("#qtyPlus");

    const minusButton =
      $("#qtyMinus");

    if (
      plusButton &&
      plusButton.dataset.bound !== "true"
    ) {
      plusButton.dataset.bound =
        "true";

      plusButton.addEventListener(
        "click",
        function () {
          if (!selectedPackage) {
            return;
          }

          if (
            selectedQty >=
            CART_MAX_QTY
          ) {
            showToast(
              `Maximum quantity is ${CART_MAX_QTY}.`,
              "warning"
            );

            return;
          }

          selectedQty++;

          quantityElement.textContent =
            selectedQty;

          priceElement.textContent =
            formatCurrency(
              selectedPackage.price *
              selectedQty
            );
        }
      );
    }

    if (
      minusButton &&
      minusButton.dataset.bound !== "true"
    ) {
      minusButton.dataset.bound =
        "true";

      minusButton.addEventListener(
        "click",
        function () {
          if (!selectedPackage) {
            return;
          }

          if (selectedQty <= 1) {
            return;
          }

          selectedQty--;

          quantityElement.textContent =
            selectedQty;

          priceElement.textContent =
            formatCurrency(
              selectedPackage.price *
              selectedQty
            );
        }
      );
    }
  }

  // =========================================================
  // PLAYER VERIFICATION
  // =========================================================

  function setupPlayerVerify() {
    const verifyButton = document.querySelector(".verify-btn");

    if (!verifyButton) {
      return;
    }

    if (verifyButton.dataset.bound === "true") {
      return;
    }

    verifyButton.dataset.bound = "true";

    verifyButton.addEventListener("click", async function () {
      const inputs = $$(".id-input");
      inputs.forEach(function (input) {
        if (input.dataset.verifyResetBound === "true") {
          return;
        }

        input.dataset.verifyResetBound = "true";

        input.addEventListener("input", function () {
          verifiedPlayer = null;

          const output = $("#playerName");

          if (output) {
            output.textContent = "";
          }
        });
      });

      const playerId = inputs[0]?.value?.trim() || "";
      const serverId = inputs[1]?.value?.trim() || "";

      const output = $("#playerName");

      if (!playerId || !serverId) {
        showToast(
          "Please enter your Player ID and Server ID.",
          "error"
        );
        return;
      }

      // Show checking state
      if (output) {
        output.textContent = "Verifying account...";
      }

      try {
        const response = await apiFetch(`${API_BASE_URL}/api/validate-player`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            player_id: playerId,
            zone_id: serverId
          })
        });

        const data = await response.json();

        console.log("Player validation:", data);

        if (!response.ok || !data.ok) {
          throw new Error(
            data.error || "Unable to verify player."
          );
        }

        if (!data.valid) {
          if (output) {
            output.textContent = "Account not found";
          }

          showToast(
            "Invalid Player ID or Server ID.",
            "error"
          );

          return;
        }

        // REAL FZR PLAYER NAME
        verifiedPlayer = {
          playerId: playerId,
          serverId: serverId,
          playerName: data.player_name || "Account verified",
          region: data.region || ""
        };

        if (output) {
          output.textContent = data.player_name || "Account verified";
        }

        const liveResult =
          document.querySelector(".player-result");

        if (liveResult) {
          liveResult.setAttribute("aria-live", "polite");
        }

        showToast(
          `Account verified: ${data.player_name}`,
          "success"
        );

      } catch (error) {
        console.error("Player verification error:", error);

        if (output) {
          output.textContent = "Verification failed";
        }

        showToast(
          "Unable to verify account. Please try again.",
          "error"
        );
      }
    });
  }
  // =========================================================
  // AUTHENTICATION
  // =========================================================

  /*
   * ========================================================
   * AUTHENTICATION BUTTON FIX
   * ========================================================
   *
   * There must be ONE actual .login-btn.
   *
   * Logged out:
   *     Login
   *
   * Logged in:
   *     Logout
   *
   * We never display the customer's name inside the button.
   *
   * The same physical DOM button is moved into the mobile
   * menu. It is never cloned.
   */


  function getPrimaryLoginButton() {
    const buttons =
      $$(".login-btn");

    if (!buttons.length) {
      return null;
    }

    /*
     * Keep the first real .login-btn.
     * Hide any accidental duplicate buttons.
     */
    const primary =
      buttons[0];

    buttons.forEach(function (button, index) {
      if (index === 0) {
        button.style.display = "";
        button.removeAttribute(
          "aria-hidden"
        );

        button.disabled =
          false;
      } else {
        button.style.display =
          "none";

        button.disabled =
          true;

        button.setAttribute(
          "aria-hidden",
          "true"
        );
      }
    });

    /*
     * Hide any legacy logout buttons.
     */
    $$(".logout-btn").forEach(
      function (button) {
        button.style.display =
          "none";

        button.disabled =
          true;

        button.setAttribute(
          "aria-hidden",
          "true"
        );
      }
    );

    return primary;
  }


  function setAuthButtonState(isLoggedIn) {
    const loginButton =
      getPrimaryLoginButton();

    if (!loginButton) {
      console.error(
        "No .login-btn found."
      );

      return;
    }

    /*
     * Remove any old inline handler state.
     */
    loginButton.dataset.authState =
      isLoggedIn
        ? "logged-in"
        : "logged-out";

    loginButton.dataset.logoutLoading =
      "false";

    loginButton.disabled =
      false;

    loginButton.style.pointerEvents =
      "auto";

    loginButton.style.cursor =
      "pointer";

    if (isLoggedIn) {
      /*
       * NEVER show the user's name.
       */
      loginButton.textContent =
        "Logout";

      loginButton.setAttribute(
        "aria-label",
        "Logout"
      );

      loginButton.setAttribute(
        "title",
        "Logout"
      );

    } else {
      loginButton.textContent =
        "Login";

      loginButton.setAttribute(
        "aria-label",
        "Login"
      );

      loginButton.setAttribute(
        "title",
        "Login"
      );
    }
  }


  async function loadLoggedInUser() {
    return restoreLoginSession();
  }


  async function restoreLoginSession() {
    try {
      const response =
        await apiFetch(
          `${API_BASE_URL}/me`,
          {
            method: "GET",
            credentials: "include",
            headers: {
              Accept:
                "application/json"
            }
          }
        );

      let data = {};

      try {
        data =
          await response.json();
      } catch (error) {
        console.warn(
          "Session response was not JSON."
        );
      }

      console.log(
        "Session restore:",
        data
      );

      if (
        response.ok &&
        data.success &&
        data.authenticated &&
        data.user
      ) {
        window.currentUser =
          data.user;

        /*
         * Refresh button to Logout.
         */
        setAuthButtonState(true);

        /*
         * Load orders for logged-in user.
         */
        await renderOrderHistory();

        return true;
      }

      /*
       * No valid session.
       */
      window.currentUser =
        null;

      setAuthButtonState(false);

      const orderHistory =
        document.getElementById(
          "orderHistoryList"
        );

      if (orderHistory) {
        orderHistory.innerHTML = `
          <p class="no-orders">
            Please log in to view your orders.
          </p>
        `;
      }

      return false;

    } catch (error) {
      console.error(
        "Could not restore login session:",
        error
      );

      /*
       * If /me cannot be reached, don't leave a broken
       * Logout button on screen.
       */
      window.currentUser =
        null;

      setAuthButtonState(false);

      return false;
    }
  }


  async function logoutUser() {
    console.log(
      "LOGOUT BUTTON CLICKED"
    );

    const loginButton =
      getPrimaryLoginButton();

    if (!loginButton) {
      console.error(
        "Primary login button not found during logout."
      );

      return;
    }

    /*
     * Prevent double-clicking while logout is running.
     */
    if (
      loginButton.dataset.logoutLoading ===
      "true"
    ) {
      console.log(
        "Logout already in progress."
      );

      return;
    }

    loginButton.dataset.logoutLoading =
      "true";

    loginButton.disabled =
      true;

    loginButton.textContent =
      "Logging out...";

    loginButton.style.cursor =
      "wait";

    try {
      const response =
        await apiFetch(
          `${API_BASE_URL}/logout`,
          {
            method: "POST",
            credentials: "include",
            headers: {
              Accept:
                "application/json"
            }
          }
        );

      let data = {};

      try {
        data =
          await response.json();
      } catch (error) {
        console.warn(
          "Logout response was not JSON."
        );
      }

      console.log(
        "LOGOUT STATUS:",
        response.status
      );

      console.log(
        "LOGOUT RESPONSE:",
        data
      );

      /*
       * Server must confirm logout.
       */
      if (
        !response.ok ||
        data.success !== true
      ) {
        console.error(
          "Server rejected logout."
        );

        /*
         * Keep user logged in because the server did not
         * confirm the logout.
         */
        loginButton.dataset.logoutLoading =
          "false";

        loginButton.disabled =
          false;

        setAuthButtonState(
          Boolean(window.currentUser)
        );

        showToast(
          data.message ||
          "Logout failed.",
          "error"
        );

        return false;
      }

      /*
       * ====================================================
       * LOGOUT SUCCESS
       * ====================================================
       */

      window.currentUser =
        null;

      /*
       * Immediately change THE SAME button to Login.
       */
      setAuthButtonState(false);

      /*
       * Clear order-history display.
       */
      const orderHistory =
        document.getElementById(
          "orderHistoryList"
        );

      if (orderHistory) {
        orderHistory.innerHTML = `
          <p class="no-orders">
            Please log in to view your orders.
          </p>
        `;
      }

      showToast(
        "Logged out successfully.",
        "success"
      );

      console.log(
        "LOGOUT COMPLETE"
      );

      return true;

    } catch (error) {
      console.error(
        "LOGOUT ERROR:",
        error
      );

      /*
       * Network error:
       * restore button to its previous state.
       */
      setAuthButtonState(
        Boolean(window.currentUser)
      );

      showToast(
        "Unable to logout. Please try again.",
        "error"
      );

      return false;

    } finally {
      const currentButton =
        getPrimaryLoginButton();

      if (currentButton) {
        currentButton.dataset.logoutLoading =
          "false";

        currentButton.disabled =
          false;

        currentButton.style.cursor =
          "pointer";
      }

      /*
       * Final state always follows currentUser.
       */
      setAuthButtonState(
        Boolean(window.currentUser)
      );
    }
  }


  function setupLoginToggle() {
    /*
     * Find the single primary login button.
     */
    const loginButton =
      getPrimaryLoginButton();

    const loginPopup =
      document.querySelector(
        ".login-popup"
      ) ||
      document.getElementById(
        "loginPopup"
      );

    const loginSubmitButton =
      document.querySelector(
        ".login-bt"
      );

    const signupButton =
      document.querySelector(
        ".signup-btn"
      );

    const closeLoginButton =
      document.querySelector(
        ".close-login"
      );

    const loginForm =
      document.getElementById(
        "loginForm"
      );

    const signupForm =
      document.getElementById(
        "signupForm"
      );

    const backLoginButton =
      document.querySelector(
        ".back-login-btn"
      );

    const createAccountButton =
      document.querySelector(
        ".create-account-btn"
      );

    const usernameInput =
      document.getElementById(
        "username"
      );

    const passwordInput =
      document.getElementById(
        "password"
      );

    if (!loginButton) {
      console.error(
        "Login button not found."
      );

      return;
    }

    let popupVisible =
      false;


    function openLoginPopup() {
      if (!loginPopup) {
        console.error(
          "Login popup not found."
        );

        showToast(
          "Login popup could not be opened.",
          "error"
        );

        return;
      }

      popupVisible =
        true;

      /*
       * Login popup must always be above the mobile menu.
       */
      loginPopup.style.display =
        "flex";

      loginPopup.style.zIndex =
        "99999";

      loginPopup.setAttribute(
        "aria-hidden",
        "false"
      );

      /*
         * Forgot-password must never persist across a close/reopen —
         * always reset back to the login form when the popup opens.
         */
      const forgotPasswordFormEl =
        document.getElementById("forgotPasswordForm");

      if (
        forgotPasswordFormEl &&
        forgotPasswordFormEl.style.display !== "none"
      ) {
        forgotPasswordFormEl.style.display =
          "none";

        if (loginForm) {
          loginForm.style.display =
            "block";
        }

        if (signupForm) {
          signupForm.style.display =
            "none";
        }
      }

      /*
       * Make sure login form is visible when opening.
       */
      if (
        loginForm &&
        signupForm
      ) {
        /*
         * Don't force a user's current form selection
         * unnecessarily, but if both are hidden, show login.
         */
        if (
          loginForm.style.display === "none" &&
          signupForm.style.display === "none"
        ) {
          loginForm.style.display =
            "block";
        }
      }
    }

    function closeLoginPopup() {
      if (!loginPopup) {
        return;
      }

      popupVisible =
        false;

      loginPopup.style.display =
        "none";

      loginPopup.setAttribute(
        "aria-hidden",
        "true"
      );
    }


    /*
     * ======================================================
     * ONE AND ONLY ONE LOGIN BUTTON CLICK HANDLER
     * ======================================================
     *
     * This listener stays attached to the same physical
     * button even when that button is moved into the mobile
     * menu.
     */
    if (
      loginButton.dataset.authClickBound !==
      "true"
    ) {
      loginButton.dataset.authClickBound =
        "true";

      loginButton.addEventListener(
        "click",
        async function (event) {
          event.preventDefault();

          /*
           * Stop other menu handlers from accidentally
           * opening/closing things.
           */
          event.stopPropagation();

          /*
           * Check the current authentication state at the
           * exact moment the button is clicked.
           */
          const loggedIn =
            Boolean(window.currentUser);

          console.log(
            "AUTH BUTTON CLICK:",
            loggedIn
              ? "LOGOUT"
              : "LOGIN"
          );

          if (loggedIn) {
            await logoutUser();
          } else {
            openLoginPopup();
          }
        }
      );
    }


    // =====================================================
    // SIGNUP -> LOGIN
    // =====================================================

    signupButton?.addEventListener(
      "click",
      function (event) {
        event.preventDefault();

        if (loginForm) {
          loginForm.style.display =
            "none";
        }

        if (signupForm) {
          signupForm.style.display =
            "block";
        }
      }
    );


    // =====================================================
    // LOGIN -> SIGNUP BACK
    // =====================================================

    backLoginButton?.addEventListener(
      "click",
      function (event) {
        event.preventDefault();

        if (signupForm) {
          signupForm.style.display =
            "none";
        }

        if (loginForm) {
          loginForm.style.display =
            "block";
        }
      }
    );


    // =====================================================
    // CREATE ACCOUNT
    // =====================================================

    createAccountButton?.addEventListener(
      "click",
      async function () {
        const name =
          document
            .getElementById(
              "signupName"
            )
            ?.value
            ?.trim() || "";

        const email =
          document
            .getElementById(
              "signupEmail"
            )
            ?.value
            ?.trim() || "";

        const phone =
          document
            .getElementById(
              "signupPhone"
            )
            ?.value
            ?.trim() || "";

        const password =
          document
            .getElementById(
              "signupPassword"
            )
            ?.value || "";

        const confirmPassword =
          document
            .getElementById(
              "signupConfirmPassword"
            )
            ?.value || "";

        if (
          !name ||
          !email ||
          !password
        ) {
          showToast(
            "Please fill in your name, email and password.",
            "error"
          );

          return;
        }

        if (
          password.length < 8
        ) {
          showToast(
            "Password must be at least 8 characters.",
            "error"
          );

          return;
        }

        if (
          password !==
          confirmPassword
        ) {
          showToast(
            "Passwords do not match.",
            "error"
          );

          return;
        }

        createAccountButton.disabled =
          true;

        createAccountButton.textContent =
          "Creating account...";

        try {
          const response =
            await apiFetch(
              `${API_BASE_URL}/signup`,
              {
                method: "POST",

                credentials:
                  "include",

                headers: {
                  "Content-Type":
                    "application/json",

                  Accept:
                    "application/json"
                },

                body:
                  JSON.stringify({
                    name:
                      name,

                    email:
                      email,

                    phone:
                      phone,

                    password:
                      password
                  })
              }
            );

          const data =
            await response.json();

          console.log(
            "Signup response:",
            data
          );

          if (
            !response.ok ||
            !data.success
          ) {
            showToast(
              data.message ||
              "Unable to create account.",
              "error"
            );

            return;
          }

          showToast(
            "Account created successfully! Please log in.",
            "success"
          );

          const signupNameInput =
            document.getElementById(
              "signupName"
            );

          const signupEmailInput =
            document.getElementById(
              "signupEmail"
            );

          const signupPhoneInput =
            document.getElementById(
              "signupPhone"
            );

          const signupPasswordInput =
            document.getElementById(
              "signupPassword"
            );

          const signupConfirmInput =
            document.getElementById(
              "signupConfirmPassword"
            );

          if (signupNameInput) {
            signupNameInput.value =
              "";
          }

          if (signupEmailInput) {
            signupEmailInput.value =
              "";
          }

          if (signupPhoneInput) {
            signupPhoneInput.value =
              "";
          }

          if (signupPasswordInput) {
            signupPasswordInput.value =
              "";
          }

          if (signupConfirmInput) {
            signupConfirmInput.value =
              "";
          }

          if (signupForm) {
            signupForm.style.display =
              "none";
          }

          if (loginForm) {
            loginForm.style.display =
              "block";
          }

          const loginEmailInput =
            document.getElementById(
              "username"
            );

          if (loginEmailInput) {
            loginEmailInput.value =
              email;
          }

        } catch (error) {
          console.error(
            "Signup request failed:",
            error
          );

          showToast(
            "Unable to connect to the server.",
            "error"
          );

        } finally {
          createAccountButton.disabled =
            false;

          createAccountButton.textContent =
            "Create Account";
        }
      }
    );
    // =====================================================
    // FORGOTTEN PASSWORD
    // =====================================================

    const forgotPasswordButton =
      document.querySelector(
        ".forgot-password-btn"
      );

    const forgotPasswordForm =
      document.getElementById(
        "forgotPasswordForm"
      );

    const sendResetButton =
      document.querySelector(
        ".send-reset-btn"
      );

    const backLoginFromForgotButton =
      document.querySelector(
        ".back-login-from-forgot-btn"
      );

    const forgotPasswordEmail =
      document.getElementById(
        "forgotPasswordEmail"
      );

    forgotPasswordButton?.addEventListener(
      "click",
      function (event) {
        event.preventDefault();

        if (loginForm) {
          loginForm.style.display = "none";
        }

        if (signupForm) {
          signupForm.style.display = "none";
        }

        if (forgotPasswordForm) {
          forgotPasswordForm.style.display =
            "block";
        }
      }
    );

    backLoginFromForgotButton?.addEventListener(
      "click",
      function (event) {
        event.preventDefault();

        if (forgotPasswordForm) {
          forgotPasswordForm.style.display =
            "none";
        }

        if (loginForm) {
          loginForm.style.display =
            "block";
        }
      }
    );

    sendResetButton?.addEventListener(
      "click",
      async function () {

        const email =
          forgotPasswordEmail?.value
            ?.trim()
            .toLowerCase() || "";

        if (!email) {
          showToast(
            "Please enter your email address.",
            "error"
          );

          return;
        }

        sendResetButton.disabled = true;

        sendResetButton.textContent =
          "Sending...";

        try {

          const response =
            await apiFetch(
              `${API_BASE_URL}/forgot-password`,
              {
                method: "POST",

                headers: {
                  "Content-Type":
                    "application/json",

                  Accept:
                    "application/json"
                },

                body:
                  JSON.stringify({
                    email
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
              "Unable to process request.",
              "error"
            );

            return;
          }

          showToast(
            data.message,
            "success"
          );


        } catch (error) {

          console.error(
            "Forgot password request failed:",
            error
          );

          showToast(
            "Unable to connect to the server.",
            "error"
          );

        } finally {

          sendResetButton.disabled =
            false;

          sendResetButton.textContent =
            "Send reset link";
        }
      }
    );


    // =====================================================
    // CLOSE LOGIN POPUP
    // =====================================================

    closeLoginButton?.addEventListener(
      "click",
      function (event) {
        event.preventDefault();

        closeLoginPopup();
      }
    );


    // =====================================================
    // CLICK OUTSIDE LOGIN POPUP
    // =====================================================

    window.addEventListener(
      "click",
      function (event) {
        if (!popupVisible) {
          return;
        }

        if (
          loginPopup &&
          !loginPopup.contains(
            event.target
          ) &&
          !loginButton.contains(
            event.target
          )
        ) {
          closeLoginPopup();
        }
      }
    );


    // =====================================================
    // LOGIN
    // =====================================================

    if (
      loginSubmitButton &&
      loginSubmitButton.dataset.bound !==
      "true"
    ) {
      loginSubmitButton.dataset.bound =
        "true";

      loginSubmitButton.addEventListener(
        "click",
        async function (event) {
          event.preventDefault();

          const email =
            usernameInput?.value?.trim() ||
            "";

          const password =
            passwordInput?.value ||
            "";

          if (
            !email ||
            !password
          ) {
            showToast(
              "Please enter your email and password.",
              "error"
            );

            return;
          }

          loginSubmitButton.disabled =
            true;

          loginSubmitButton.textContent =
            "Logging in...";

          try {
            const response =
              await apiFetch(
                `${API_BASE_URL}/login`,
                {
                  method: "POST",

                  credentials:
                    "include",

                  headers: {
                    "Content-Type":
                      "application/json",

                    Accept:
                      "application/json"
                  },

                  body:
                    JSON.stringify({
                      email:
                        email,

                      password:
                        password
                    })
                }
              );

            const data =
              await response.json();

            console.log(
              "Login response:",
              data
            );

            if (
              !response.ok ||
              !data.success ||
              !data.user
            ) {
              showToast(
                data.message ||
                "Login failed.",
                "error"
              );

              if (data.requiresVerification) {
                showResendVerificationLink(email);
              }

              return;
            }

            console.log(
              "Login successful:",
              data.user
            );

            /*
             * Set current user FIRST.
             */
            window.currentUser =
              data.user;

            /*
             * Then update the SAME authentication
             * button to Logout.
             */
            setAuthButtonState(true);

            showToast(
              `Welcome back, ${escapeHTML(
                data.user.name || ""
              )}!`,
              "success"
            );

            /*
             * Close popup.
             */
            closeLoginPopup();

            /*
             * Load orders.
             */
            await renderOrderHistory();

          } catch (error) {
            console.error(
              "Login request failed:",
              error
            );

            showToast(
              "Unable to connect to the server.",
              "error"
            );

          } finally {
            loginSubmitButton.disabled =
              false;

            loginSubmitButton.textContent =
              "Login";
          }
        }
      );
    }
  }


  // =========================================================
  // MOBILE LOGIN BUTTON
  // =========================================================

  function setupMobileLoginMenu() {
    const mobileMenu =
      document.getElementById(
        "mobileMenu"
      );

    const loginButton =
      getPrimaryLoginButton();

    if (
      !mobileMenu ||
      !loginButton
    ) {
      console.warn(
        "Mobile login menu elements not found."
      );

      return;
    }

    /*
     * Save the original desktop parent.
     */
    const desktopParent =
      loginButton.parentElement;

    if (!desktopParent) {
      return;
    }

    const originalNextSibling =
      loginButton.nextElementSibling;


    function updateLoginLocation() {
      const isMobile =
        window.innerWidth <= 700;

      /*
       * IMPORTANT:
       * We MOVE the SAME button.
       * We NEVER clone it.
       */
      if (isMobile) {
        if (
          !mobileMenu.contains(
            loginButton
          )
        ) {
          mobileMenu.appendChild(
            loginButton
          );
        }

        loginButton.classList.add(
          "mobile-menu-login"
        );

      } else {
        if (
          !desktopParent.contains(
            loginButton
          )
        ) {
          if (
            originalNextSibling &&
            desktopParent.contains(
              originalNextSibling
            )
          ) {
            desktopParent.insertBefore(
              loginButton,
              originalNextSibling
            );
          } else {
            desktopParent.appendChild(
              loginButton
            );
          }
        }

        loginButton.classList.remove(
          "mobile-menu-login"
        );
      }

      /*
       * Hide ALL legacy logout buttons.
       */
      $$(".logout-btn").forEach(
        function (button) {
          button.style.display =
            "none";

          button.disabled =
            true;

          button.setAttribute(
            "aria-hidden",
            "true"
          );
        }
      );

      /*
       * Make sure accidental duplicate .login-btn
       * elements stay hidden.
       */
      getPrimaryLoginButton();

      /*
       * Reapply current authentication state.
       */
      setAuthButtonState(
        Boolean(window.currentUser)
      );
    }


    updateLoginLocation();

    /*
     * Avoid registering resize repeatedly.
     */
    if (
      window.__hiroAuthResizeBound !==
      true
    ) {
      window.__hiroAuthResizeBound =
        true;

      window.addEventListener(
        "resize",
        updateLoginLocation
      );
    }
  }


  // =========================================================
  // MOBILE NAVIGATION
  // =========================================================

  function setupMobileNavigation() {
    setupMobileLoginMenu();

    const mobileMenuButton =
      document.getElementById(
        "mobileMenuBtn"
      ) ||
      document.querySelector(
        ".mobile-menu-btn"
      );

    const mobileMenu =
      document.getElementById(
        "mobileMenu"
      );

    /*
     * First possible navigation system:
     * .nav-wrapper / .mobile-menu-btn
     */
    const navWrapper =
      document.querySelector(
        ".nav-wrapper"
      );

    const navMenuButton =
      document.querySelector(
        ".mobile-menu-btn"
      );

    if (
      navWrapper &&
      navMenuButton &&
      navMenuButton.dataset.navBound !==
      "true"
    ) {
      navMenuButton.dataset.navBound =
        "true";

      navMenuButton.addEventListener(
        "click",
        function (event) {
          /*
           * Don't allow this click to interfere with
           * the authentication button.
           */
          event.stopPropagation();

          const isOpen =
            navWrapper.classList.toggle(
              "mobile-open"
            );

          navMenuButton.classList.toggle(
            "active",
            isOpen
          );

          navMenuButton.textContent =
            isOpen
              ? "×"
              : "☰";

          navMenuButton.setAttribute(
            "aria-label",
            isOpen
              ? "Close menu"
              : "Open menu"
          );
        }
      );

      navWrapper
        .querySelectorAll(
          ".pill-link"
        )
        .forEach(function (link) {
          link.addEventListener(
            "click",
            function () {
              navWrapper.classList.remove(
                "mobile-open"
              );

              navMenuButton.classList.remove(
                "active"
              );

              navMenuButton.textContent =
                "☰";

              navMenuButton.setAttribute(
                "aria-label",
                "Open menu"
              );
            }
          );
        });
    }


    /*
     * Second possible navigation system:
     * #mobileMenuBtn / #mobileMenu
     */
    if (
      mobileMenuButton &&
      mobileMenu &&
      mobileMenuButton.dataset.menuBound !==
      "true"
    ) {
      mobileMenuButton.dataset.menuBound =
        "true";

      mobileMenuButton.addEventListener(
        "click",
        function (event) {
          event.stopPropagation();

          mobileMenu.classList.toggle(
            "mobile-menu-open"
          );

          const isOpen =
            mobileMenu.classList.contains(
              "mobile-menu-open"
            );

          mobileMenuButton.textContent =
            isOpen
              ? "×"
              : "☰";
        }
      );

      mobileMenu
        .querySelectorAll("a")
        .forEach(function (link) {
          link.addEventListener(
            "click",
            function () {
              mobileMenu.classList.remove(
                "mobile-menu-open"
              );

              mobileMenuButton.textContent =
                "☰";
            }
          );
        });
    }
  }


  // =========================================================
  // CHECKOUT
  // =========================================================

  function openCheckout() {
    if (
      window.hiroPaymentsEnabled === false
    ) {
      showToast(
        "Payments are temporarily unavailable. Please try again later.",
        "warning"
      );

      return;
    }
    if (!window.currentUser) {
      showToast(
        "Please log in before proceeding to payment.",
        "warning"
      );

      const loginButton =
        getPrimaryLoginButton();

      if (loginButton) {
        loginButton.click();
      }

      return;
    }

    const modal =
      document.getElementById(
        "checkoutModal"
      );

    const summary =
      modal?.querySelector(".checkout-summary");

    const total =
      cart.reduce(function (sum, item) {
        return (
          sum +
          Number(item.price || 0) *
          Number(item.qty || 0)
        );
      }, 0);

    if (summary) {
      summary.innerHTML = `
        <h3>
          Total:
          ${formatCurrency(total)}
        </h3>

        <p>
          ${totalCartQty()} item(s)
        </p>
      `;
    }

    if (modal) {
      modal.style.display =
        "flex";
    }
  }


  function closeCheckout() {
    const modal =
      document.getElementById(
        "checkoutModal"
      );

    if (modal) {
      modal.style.display =
        "none";
    }
  }


  function showOrderConfirmation(order) {
    const modal = document.getElementById("orderConfirmationModal");
    if (!modal || !order) return;
    const orderId = String(order.orderId || "").trim();
    const itemStatuses = Array.isArray(order.items)
      ? order.items.map(item => String(item.fulfillmentStatus || "Pending"))
      : [];
    let deliveryStatus = "Processing";
    if (itemStatuses.length && itemStatuses.every(status => status === "Completed")) deliveryStatus = "Completed ✓";
    else if (itemStatuses.some(status => status === "Failed")) deliveryStatus = "Needs Attention";
    else if (itemStatuses.length && itemStatuses.every(status => status === "Pending")) deliveryStatus = "Pending";
    const orderIdElement = document.getElementById("confirmedOrderId");
    const deliveryElement = document.getElementById("confirmedDeliveryStatus");
    const trackButton = document.getElementById("trackConfirmedOrderBtn");
    if (orderIdElement) orderIdElement.textContent = orderId || "—";
    if (deliveryElement) deliveryElement.textContent = deliveryStatus;
    if (trackButton) trackButton.href = orderId ? `orders.html?order=${encodeURIComponent(orderId)}` : "orders.html";
    modal.style.display = "flex";
  }

  function closeOrderConfirmation() {
    const modal = document.getElementById("orderConfirmationModal");
    if (modal) modal.style.display = "none";
  }

  /* ---------------------------------------------------------
      COMPLAINT CHAT
   --------------------------------------------------------- */

  let complaintOrderId = null;
  let activeComplaintId = null;

  async function findOrCreateComplaint(orderId, initialMessage) {
    const response = await apiFetch(`${API_BASE_URL}/complaints`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, message: initialMessage })
    });

    const data = await response.json();
    return data;
  }

  async function loadChatThread(complaintId, showLoadingState = true) {
    const thread = document.getElementById("chatThread");

    if (showLoadingState) {
      thread.innerHTML = `<p class="chat-loading">Loading conversation...</p>`;
    }

    try {
      const response = await apiFetch(`${API_BASE_URL}/complaints/${complaintId}/messages`, {
        credentials: "include"
      });
      const data = await response.json();

      if (!data.success || !data.messages.length) {
        thread.innerHTML = `<p class="chat-loading">No messages yet.</p>`;
        return;
      }

      thread.innerHTML = data.messages.map(function (msg) {
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

  async function openComplaintModal(orderId) {
    complaintOrderId = orderId;
    activeComplaintId = null;

    const modal = document.getElementById("complaintModal");
    const ref = modal.querySelector(".complaint-order-ref");
    if (ref) ref.textContent = `Order: ${complaintOrderId}`;
    modal.style.display = "flex";

    const thread = document.getElementById("chatThread");
    thread.innerHTML = `<p class="chat-loading">Loading conversation...</p>`;

    try {
      const response = await apiFetch(`${API_BASE_URL}/complaints/by-order/${encodeURIComponent(orderId)}`, {
        credentials: "include"
      });
      const data = await response.json();

      if (data.success && data.complaint) {
        activeComplaintId = data.complaint.id;
        loadChatThread(activeComplaintId, false);
      } else {
        thread.innerHTML = `<p class="chat-loading">Send a message to start this conversation.</p>`;
      }
    } catch (error) {
      thread.innerHTML = `<p class="chat-loading">Send a message to start this conversation.</p>`;
    }
  }

  document.addEventListener("click", function (event) {
    const reportBtn = event.target.closest("[data-report-order]");
    if (reportBtn) {
      openComplaintModal(reportBtn.dataset.reportOrder);
      return;
    }

    if (event.target.closest(".close-complaint")) {
      document.getElementById("complaintModal").style.display = "none";
      return;
    }
  });

  document.getElementById("sendChatBtn")
    ?.addEventListener("click", async function () {
      const input = document.getElementById("chatMessageInput");
      const message = input.value.trim();

      if (message.length < 2) {
        showToast("Type a message first.", "error");
        return;
      }

      try {
        if (!activeComplaintId) {
          const data = await findOrCreateComplaint(complaintOrderId, message);

          if (!data.success) {
            showToast(data.message || "Could not send message.", "error");
            return;
          }

          activeComplaintId = data.complaintId;
          input.value = "";
          loadChatThread(activeComplaintId, false);
          return;
        }

        const response = await apiFetch(`${API_BASE_URL}/complaints/${activeComplaintId}/messages`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message })
        });

        const data = await response.json();

        if (!data.success) {
          showToast(data.message || "Could not send message.", "error");
          return;
        }

        input.value = "";
        loadChatThread(activeComplaintId, false);

      } catch (error) {
        showToast("Network error submitting report.", "error");
      }
    });



  // =========================================================
  // PAYSTACK
  // =========================================================

  let checkoutInProgress = false;

  async function payWithPaystack() {
    if (checkoutInProgress) {
      showToast(
        "Checkout is already being prepared.",
        "warning"
      );
      return;
    }

    if (!window.currentUser) {
      showToast(
        "Please log in before making a payment.",
        "warning"
      );
      return;
    }

    const emailInput =
      document.getElementById("checkoutEmail");

    const phoneInput =
      document.getElementById("checkoutPhone");

    const email =
      emailInput?.value?.trim() || "";

    const phone =
      phoneInput?.value?.trim() || "";

    if (!email) {
      showToast(
        "Please enter your email.",
        "error"
      );
      return;
    }

    if (!cart.length) {
      showToast(
        "Your cart is empty.",
        "error"
      );
      return;
    }

    if (
      typeof PaystackPop ===
      "undefined"
    ) {
      showToast(
        "Payment system failed to load. Please refresh.",
        "error"
      );
      return;
    }

    checkoutInProgress = true;

    try {
      /*
       * STEP 1:
       * Create the order BEFORE Paystack.
       *
       * The server calculates the real prices
       * from the products table.
       */
      const checkoutResponse =
        await apiFetch(
          `${API_BASE_URL}/api/checkout/create`,
          {
            method: "POST",

            credentials: "include",

            headers: {
              "Content-Type":
                "application/json",

              Accept:
                "application/json"
            },

            body: JSON.stringify({
              email,
              phone,

              items: cart.map(
                function (item) {
                  return {
                    offerId:
                      item.id,

                    categoryId:
                      item.categoryId,

                    qty:
                      item.qty,

                    playerId:
                      item.playerId,

                    serverId:
                      item.serverId
                  };
                }
              )
            })
          }
        );

      const checkoutData =
        await checkoutResponse.json();

      if (
        !checkoutResponse.ok ||
        !checkoutData.success ||
        !checkoutData.order
      ) {
        throw new Error(
          checkoutData.message ||
          "Unable to prepare checkout."
        );
      }

      const pendingOrder =
        checkoutData.order;

      const accessCode =
        String(
          checkoutData.accessCode ||
          ""
        ).trim();

      if (!accessCode) {
        throw new Error(
          "Payment initialization is unavailable."
        );
      }

      console.log(
        "Pending order created:",
        pendingOrder.orderId
      );

      /*
       * STEP 2:
       * The server already initialized Paystack with
       * the exact HIRO-PAY reference stored in SQLite.
       * The browser can only resume that transaction;
       * it can no longer invent a standalone T... reference.
       */
      const paystack =
        new PaystackPop();

      paystack.resumeTransaction(
        accessCode,
        {
          onSuccess:
            async function (transaction) {

              console.log(
                "Paystack payment successful."
              );

              showToast(
                "Payment received. Verifying...",
                "success"
              );

              try {
                const response =
                  await apiFetch(
                    `${API_BASE_URL}/verify-payment`,
                    {
                      method: "POST",

                      credentials:
                        "include",

                      headers: {
                        "Content-Type":
                          "application/json",

                        Accept:
                          "application/json"
                      },

                      body:
                        JSON.stringify({
                          reference:
                            pendingOrder.reference
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
                    "Payment received. Your order is being processed. Do not pay again.",
                    "warning"
                  );

                  return;
                }

                showToast(
                  "Payment Verified ✅",
                  "success"
                );

                await renderOrderHistory();

                closeCheckout();
                showOrderConfirmation(data.order);

                cart = [];

                saveCart();

                renderCart();

              } catch (error) {

                console.error(
                  "Verification request failed:",
                  error
                );

                showToast(
                  "Payment received. Your order is being confirmed. Do not pay again.",
                  "warning"
                );
              } finally {
                checkoutInProgress =
                  false;
              }
            },

          onCancel:
            function () {

              console.log(
                "Paystack payment cancelled."
              );

              checkoutInProgress =
                false;

              showToast(
                "Payment cancelled.",
                "warning"
              );
            },

          onError:
            function (error) {

              console.error(
                "Paystack popup error:",
                error
              );

              checkoutInProgress =
                false;

              showToast(
                "Unable to load payment. Please try again.",
                "error"
              );
            }
        }
      );

    } catch (error) {

      checkoutInProgress = false;

      console.error(
        "Checkout preparation failed:",
        error
      );

      showToast(
        error.message ||
        "Unable to start checkout.",
        "error"
      );
    }
  }

  // =========================================================
  // ORDER HISTORY
  // =========================================================

  async function renderOrderHistory() {
    const container =
      document.getElementById("orderHistoryList");

    if (!container) {
      return;
    }

    if (!window.currentUser) {
      container.innerHTML = `
            <p class="no-orders">
                Please log in to view your orders.
            </p>
        `;

      return;
    }

    container.innerHTML = `
        <p class="no-orders">
            Loading order history...
        </p>
    `;

    try {
      const response = await apiFetch(
        `${API_BASE_URL}/orders`,
        {
          method: "GET",
          credentials: "include",
          headers: {
            Accept: "application/json"
          }
        }
      );

      if (!response.ok) {
        throw new Error(
          "Failed to load orders."
        );
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(
          data.message ||
          "Unable to load orders."
        );
      }

      const orders = data.orders || [];

      if (!orders.length) {
        container.innerHTML = `
                <p class="no-orders">
                    No orders yet.
                </p>
            `;

        return;
      }

      container.innerHTML = orders
        .map(function (order) {

          const date = new Date(
            order.createdAt
          ).toLocaleString();

          const itemsHTML =
            (order.items || [])
              .map(function (item) {
                return `
                                <div class="order-item">

                                    <strong>
                                        ${escapeHTML(
                  item.title
                )}
                                    </strong>

                                    <span>
                                        ${Number(
                  item.qty || 0
                )}
                                        ×
                                        ${formatCurrency(
                  item.price
                )}
                                    </span>

                                    <small>
                                        Player ID:
                                        ${escapeHTML(
                  item.playerId || ""
                )}
                                    </small>

                            <small>
                                        Server ID:
                                        ${escapeHTML(
                  item.serverId || ""
                )}
                                    </small>

                                    <small class="item-fulfillment-status">
                                        ${escapeHTML(
                  item.fulfillmentStatus || "Pending"
                )}
                                    </small>

                                </div>
                            `;
              })
              .join("");

          return `
                    <div
                        class="order-card"
                        role="button"
                        tabindex="0"
                        aria-expanded="false"
                    >

                        <!-- COMPACT HEADER -->
                        <div class="order-header">

                            <strong>
                                ${escapeHTML(
            order.orderId
          )}
                            </strong>

                            <span class="order-status">
                                ${escapeHTML(
            order.status
          )}
                            </span>

                        </div>

                        <!-- FULL ORDER DETAILS -->
                        <div class="order-details">

                            <div class="order-date">
                                ${escapeHTML(date)}
                            </div>

                            <div class="order-items">
                                ${itemsHTML}
                            </div>

                  <div class="order-footer">

                                <strong>
                                    Total:
                                    ${formatCurrency(
            order.amount ??
            order.total
          )}
                                </strong>

                                <small>
                                    Reference:
                                    ${escapeHTML(
            order.reference
          )}
                                </small>

                         ${["Failed", "Cancelled"].includes(order.status)
              ? `<button type="button" class="btn-report-problem" data-report-order="${escapeHTML(order.orderId)}">Report a Problem</button>`
              : ""
            }

                            </div>

                        </div>

                    </div>
                `;
        })
        .join("");

      /* ---------------------------------------------------------
         ORDER CARD CLICK / KEYBOARD HANDLING
      --------------------------------------------------------- */

      container
        .querySelectorAll(".order-card")
        .forEach(function (card) {

          function toggleOrder() {
            const isExpanded =
              card.classList.contains(
                "expanded"
              );

            card.classList.toggle(
              "expanded"
            );

            card.setAttribute(
              "aria-expanded",
              String(!isExpanded)
            );
          }

          card.addEventListener(
            "click",
            toggleOrder
          );

          card.addEventListener(
            "keydown",
            function (event) {

              if (
                event.key === "Enter" ||
                event.key === " "
              ) {
                event.preventDefault();
                toggleOrder();
              }

            }
          );
        });

    } catch (error) {

      console.error(
        "Could not load SQLite order history:",
        error
      );

      container.innerHTML = `
            <p class="no-orders">
                Unable to load order history.
                Please try again.
            </p>
        `;
    }
  }


  // =========================================================
  // MAIN CART BUTTON
  // =========================================================

  function setupMainCartButton() {
    const cartButton =
      document.querySelector(
        ".cart-btn-main"
      );

    if (!cartButton) {
      return;
    }

    if (
      cartButton.dataset.bound ===
      "true"
    ) {
      return;
    }

    cartButton.dataset.bound =
      "true";

    cartButton.addEventListener(
      "click",
      function () {
        if (selectedPackage) {
          addToCart(
            selectedPackage.id,
            selectedQty
          );

          return;
        }

        const cartSection =
          document.querySelector(
            "#cart"
          );

        if (cartSection) {
          cartSection.scrollIntoView({
            behavior:
              "smooth"
          });
        }
      }
    );
  }


  // =========================================================
  // HERO SLIDER
  // =========================================================

  function setupHeroSlider() {
    const slides =
      document.querySelectorAll(
        ".hero-slide"
      );

    const dots =
      document.querySelectorAll(
        ".hero-dot"
      );

    let currentSlide =
      0;

    if (!slides.length) {
      return;
    }

    function showSlide(index) {
      slides.forEach(
        function (slide, slideIndex) {
          slide.classList.toggle(
            "active",
            slideIndex === index
          );
        }
      );

      dots.forEach(
        function (dot, dotIndex) {
          dot.classList.toggle(
            "active",
            dotIndex === index
          );
        }
      );

      currentSlide =
        index;
    }

    dots.forEach(
      function (dot, index) {
        dot.addEventListener(
          "click",
          function () {
            showSlide(index);
          }
        );
      }
    );

    setInterval(
      function () {
        currentSlide =
          (
            currentSlide + 1
          ) %
          slides.length;

        showSlide(
          currentSlide
        );
      },
      5000
    );
  }


  // =========================================================
  // STORAGE SYNC
  // =========================================================

  window.addEventListener(
    "storage",
    function (event) {
      if (
        event.key ===
        STORAGE_KEY
      ) {
        loadCart();

        renderCart();
      }
    }
  );


  // =========================================================
  // INITIALIZATION
  // =========================================================

  async function init() {
    /*
     * Cart first.
     */
    loadCart();

    renderCart();

    setupCartListeners();

    setupPlayerVerify();

    /*
     * Authentication button setup BEFORE session restore.
     */
    getPrimaryLoginButton();

    setAuthButtonState(false);

    /*
     * Bind Login/Logout once.
     */
    setupLoginToggle();

    /*
     * Restore actual server session.
     *
     * If logged in:
     *     window.currentUser = user
     *     button = Logout
     *
     * If logged out:
     *     window.currentUser = null
     *     button = Login
     */
    await restoreLoginSession();

    /*
     * Move the SAME button into mobile menu if needed.
     */
    setupMobileNavigation();

    /*
     * Reapply state after moving button.
     */
    setAuthButtonState(
      Boolean(window.currentUser)
    );

    /*
     * Product configuration.
     * Paystack public key is only returned after the server
     * creates a pending order for the current checkout.
     */
    await loadFzrProducts();

    /*
     * Checkout close button.
     */
    document.addEventListener(
      "click",
      function (event) {
        if (
          event.target.closest(
            ".close-checkout"
          )
        ) {
          closeCheckout();
        }
      }
    );

    /*
     * Pay button.
     */
    const payButton =
      document.getElementById(
        "payNowBtn"
      );

    if (
      payButton &&
      payButton.dataset.bound !==
      "true"
    ) {
      payButton.dataset.bound =
        "true";

      payButton.addEventListener(
        "click",
        payWithPaystack
      );
    }
  }

  function updateDiamondsHeading(region) {
    const heading = document.getElementById("diamondsHeading");
    const subtext = document.getElementById("diamondsSubtext");

    if (region === "ph") {
      if (heading) heading.textContent = "Mobile Legends Philippines Diamond Packages";
      if (subtext) subtext.textContent = "Choose your package and get your diamonds delivered fast.";
    } else {
      if (heading) heading.textContent = "Mobile Legends Global Diamond Packages";
      if (subtext) subtext.textContent = "Choose your package and get your diamonds delivered fast.";
    }
  }

  document.querySelector('[data-region="global"]')
    ?.addEventListener("click", function () {
      document.getElementById("region-select")?.classList.add("hidden");
      document.getElementById("diamonds")?.classList.add("visible");
      updateDiamondsHeading("global");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

  document.querySelector('[data-region="ph"]')
    ?.addEventListener("click", function () {
      document.getElementById("region-select")?.classList.add("hidden");
      document.getElementById("diamonds")?.classList.add("visible");
      updateDiamondsHeading("ph");
      loadFzrProducts("mobile_legends_philippines");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

  document.getElementById("backToRegions")
    ?.addEventListener("click", function () {
      document.getElementById("diamonds")?.classList.remove("visible");
      document.getElementById("region-select")?.classList.remove("hidden");
      updateDiamondsHeading("global");
      loadFzrProducts("mobile_legends_global");
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

  // =========================================================
  // DOM READY
  // =========================================================

  document.addEventListener(
    "DOMContentLoaded",
    function () {
      /*
       * These are safe to call here.
       */
      setupMainCartButton();

      setupHeroSlider();

      loadPublicStoreSettings();

      init();
    }
  );



  document.getElementById("continueShoppingBtn")?.addEventListener("click", function () {
    closeOrderConfirmation();
    document.getElementById("diamonds")?.scrollIntoView({ behavior: "smooth" });
  });

  document.getElementById("orderConfirmationModal")?.addEventListener("click", function (event) {
    if (event.target.id === "orderConfirmationModal") closeOrderConfirmation();
  });
})();
// Visibility controls do not change values, autocomplete or authentication handlers.
document.addEventListener("click", function (event) {
  const button = event.target.closest("[data-password-toggle]");
  if (!button) return;
  const input = document.getElementById(button.dataset.passwordToggle);
  if (!input) return;
  const visible = input.type === "password";
  input.type = visible ? "text" : "password";
  button.setAttribute("aria-pressed", String(visible));
  button.setAttribute("aria-label", `${visible ? "Hide" : "Show"} ${input.placeholder.toLowerCase()}`);
  button.querySelector(".sr-only").textContent = visible ? "Hide password" : "Show password";
});
