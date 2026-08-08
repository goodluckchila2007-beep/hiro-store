(function () {
  // Config
  const STORAGE_KEY = 'hiro_cart_v1';
  const CART_MAX_QTY = 10;
  const ORDER_HISTORY_KEY = 'hiro_order_history_v1';

  // Example packages (id, title, price in NGN)
  const packages = [
    { id: 'weekly', title: 'Weekly Pass', price: 150 },
    { id: '5', title: '5 Diamonds', price: 50 },
    { id: '11', title: '10 + 1 Diamonds', price: 95 },
    { id: '14', title: '14 Diamonds', price: 130 },
    { id: '22', title: '20 + 2 Diamonds', price: 180 },
    { id: '51', title: '51 + 5 Diamonds', price: 420 },
    { id: '102', title: '102 + 10 Diamonds', price: 820 },
    { id: '156', title: '156 + 16 Diamonds', price: 1200 },
    { id: '234', title: '234 + 23 Diamonds', price: 1800 },
    { id: '504', title: '504 + 66 Diamonds', price: 3600 },
    { id: '625', title: '625 + 81 Diamonds', price: 4500 },
    { id: '1007', title: '1007 + 156 Diamonds', price: 7000 },
    { id: '1860', title: '1860 + 335 Diamonds', price: 12000 },
    { id: '3099', title: '3099 + 589 Diamonds', price: 20000 },
    { id: '4649', title: '4649 + 883 Diamonds', price: 30000 },
  ];

  // Utilities
  const $ = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const formatCurrency = n => '₦' + n.toLocaleString();

  // Cart (array of {id, title, price, qty})
  let cart = [];

  function loadCart() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      cart = raw ? JSON.parse(raw) : [];
    } catch (e) {
      cart = [];
    }
  }

  function saveCart() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cart));
  }

  function saveOrderHistory(reference, payment) {
    try {
      const raw = localStorage.getItem(ORDER_HISTORY_KEY);
      const orders = raw ? JSON.parse(raw) : [];

      const order = {
        orderId: "HIRO-" + Date.now(),
        reference: reference,
        date: new Date().toISOString(),
        status: "Paid",
        total: cart.reduce(
          (sum, item) => sum + (item.price * item.qty),
          0
        ),
        items: cart.map(item => ({
          title: item.title,
          price: item.price,
          qty: item.qty,
          playerId: item.playerId,
          serverId: item.serverId
        })),
        payment: payment || null
      };

      orders.unshift(order);

      localStorage.setItem(
        ORDER_HISTORY_KEY,
        JSON.stringify(orders)
      );

      console.log("Order saved:", order);

    } catch (error) {
      console.error("Could not save order history:", error);
    }
  }

  function totalCartQty() {
    return cart.reduce((s, it) => s + it.qty, 0);
  }

  function findCartItem(cartId) {
    return cart.find(item => item.cartId === cartId);
  }

  function addToCart(pkgId, qty = 1) {
    const playerId = document.querySelector("#playerId").value.trim();
    const serverId = document.querySelector("#serverId").value.trim();

    if (!playerId || !serverId) {
      showToast(
        "Please enter your Player ID and Server ID.",
        "error"
      );
      return;
    }
    const pkg = packages.find(p => p.id === pkgId);
    if (!pkg) return;

    const currentTotal = totalCartQty();
    if (currentTotal + qty > CART_MAX_QTY) {
      showToast(
        `Cart limit reached. Maximum ${CART_MAX_QTY} items allowed.`,
        "warning"
      );
      return;
    }

    cart.push({
      cartId: Date.now().toString(),
      id: pkg.id,
      title: pkg.title,
      price: pkg.price,
      qty,
      playerId,
      serverId
    });

    saveCart();
    renderCart();
    flashCartButton();
    selectedPackage = null;
    document.querySelector(".selected-box").style.display = "none";
    updateCartCountUI();
    document.querySelectorAll(".diamond-grid .card")
      .forEach(card => card.classList.remove("selected"));
  }

  function removeFromCart(pkgId) {
    cart = cart.filter(i => i.cartId !== pkgId);
    saveCart();
    renderCart();
  }

  function changeQty(pkgId, newQty) {
    newQty = Math.max(1, Math.floor(newQty));
    const item = findCartItem(pkgId);
    if (!item) return;

    // enforce global cap
    const currentOtherQty = totalCartQty() - item.qty;
    if (currentOtherQty + newQty > CART_MAX_QTY) {
      alert(`Cannot set quantity. Total cart items cannot exceed ${CART_MAX_QTY}.`);
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
    const cartContainer = document.querySelector('#cart .cart-items') || document.querySelector('.cart-items');
    if (!cartContainer) return;

    cartContainer.innerHTML = '';

    if (cart.length === 0) {
      cartContainer.innerHTML = '<p>Your cart is empty.</p>';
      updateCartCountUI();
      return;
    }

    const list = document.createElement('div');
    list.style.display = 'flex';
    list.style.flexDirection = 'column';
    list.style.gap = '12px';

    cart.forEach(item => {
      const row = document.createElement('div');
      row.style.display = 'flex';
      row.style.justifyContent = 'space-between';
      row.style.alignItems = 'center';
      row.style.background = 'rgba(0,0,0,0.2)';
      row.style.padding = '10px';
      row.style.borderRadius = '8px';

      row.innerHTML = `
       <div>
        <strong style="display:block;color:#fff">${escapeHTML(item.title)}</strong>

        <small style="display:block;color:#ddd">
          👤 Player ID: ${escapeHTML(item.playerId)}
        </small>

        <small style="display:block;color:#ddd">
          🌐 Server ID: ${escapeHTML(item.serverId)}
        </small>

        <small style="display:block;color:#ddd">
          ${formatCurrency(item.price)} each
    </small>
     </div>
        <div style="display:flex;align-items:center;gap:8px">
          <button class="decrease" data-id="${item.cartId}" title="Decrease">−</button>
          <input class="cart-qty" data-id="${item.cartId}" type="number" min="1" value="${item.qty}" style="width:58px;padding:6px;border-radius:6px;">
          <button class="increase" data-id="${item.cartId}" title="Increase">+</button>
          <button class="remove" data-id="${item.cartId}" style="margin-left:8px;background:#ff5252;color:#fff;padding:6px 10px;border-radius:6px">Remove</button>
        </div>
      `;
      list.appendChild(row);
    });

    // summary + checkout area
    const summary = document.createElement('div');
    summary.style.marginTop = '12px';
    summary.style.paddingTop = '12px';
    summary.style.borderTop = '1px solid rgba(255,255,255,0.06)';

    const totalAmt = cart.reduce((s, it) => s + it.price * it.qty, 0);
    summary.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center">
        <strong style="color:#fff">Total (${totalCartQty()} items)</strong>
        <strong style="color:#ffb86b">${formatCurrency(totalAmt)}</strong>
      </div>
      <div style="margin-top:10px;display:flex;gap:8px;justify-content:center">
        <button id="clearCartBtn" style="padding:10px 16px;border-radius:8px;background:#777;color:#fff">Clear</button>
        <button id="checkoutBtn" style="padding:10px 16px;border-radius:8px;background:linear-gradient(to right,#ff9800,#ff5722);color:#fff">Proceed to Secure Payment</button>
      </div>
    `;
    cartContainer.appendChild(list);
    cartContainer.appendChild(summary);

    updateCartCountUI();
  }

  function updateCartCountUI() {
    const qty = totalCartQty();
    const badge = document.querySelector("#cartCount");
    if (badge) {
      badge.textContent = qty;
    }
    const cartBtnMain = document.querySelector(".cart-btn-main");
    if (cartBtnMain) {
      if (selectedPackage) {
        cartBtnMain.textContent = "➕ Add Selected Package";
      }
      else {
        cartBtnMain.textContent = `🛒 View Cart (${qty})`;
      }
    }
  }
  let selectedPackage = null;
  let selectedQty = 1;

  function setupCardselection() {
    const cards = $$('.diamond-grid .card');
    const box = $('.selected-box');
    const titleEl = $('#selectedTitle');
    const priceEl = $('#selectedPrice');
    const qtyEl = $('#qtyValue');

    cards.forEach((card, index) => {
      card.addEventListener('click', () => {
        cards.forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        selectedPackage = packages[index];
        selectedQty = 1;

        titleEl.textContent = selectedPackage.title;
        priceEl.textContent = formatCurrency(selectedPackage.price * selectedQty);
        qtyEl.textContent = selectedQty;
        box.style.display = 'flex';
        updateCartCountUI();
      });
    });

    $('#qtyPlus').addEventListener('click', () => {
      if (!selectedPackage) return;
      if (selectedQty >= CART_MAX_QTY) return;
      selectedQty++;
      qtyEl.textContent = selectedQty;
      priceEl.textContent = formatCurrency(selectedPackage.price * selectedQty);
    });

    $('#qtyMinus').addEventListener('click', () => {
      if (!selectedPackage) return;
      if (selectedQty <= 1) return;
      selectedQty--;
      qtyEl.textContent = selectedQty;
      priceEl.textContent = formatCurrency(selectedPackage.price * selectedQty);
    });
  }

  function setupCartListeners() {
    const cartContainer = document.querySelector('#cart .cart-items') || document.querySelector('.cart-items');
    if (!cartContainer) return;

    cartContainer.addEventListener('click', e => {
      const rem = e.target.closest('.remove');
      if (rem) {
        removeFromCart(rem.dataset.id);
        return;
      }
      const inc = e.target.closest('.increase');
      if (inc) {
        const id = inc.dataset.id;
        const item = findCartItem(id);
        if (!item) return;
        changeQty(id, item.qty + 1);
        return;
      }
      const dec = e.target.closest('.decrease');
      if (dec) {
        const id = dec.dataset.id;
        const item = findCartItem(id);
        if (!item) return;
        changeQty(id, Math.max(1, item.qty - 1));
        return;
      }
    });

    cartContainer.addEventListener('input', e => {
      if (e.target.matches('.cart-qty')) {
        const id = e.target.dataset.id;
        const val = parseInt(e.target.value || '1', 10);
        changeQty(id, Math.max(1, val));
      }
    });

    cartContainer.addEventListener('click', e => {
      if (e.target.id === 'clearCartBtn') {
        if (confirm('Clear cart?')) clearCart();
      }
      if (e.target.id === 'checkoutBtn') {
        openCheckout();
      }
    });
  }

  function setupPlayerVerify() {
    const verifyBtn = document.querySelector('.verify-btn');
    if (!verifyBtn) return;
    verifyBtn.addEventListener('click', () => {
      const inputs = $$('.id-input');
      const playerId = inputs[0]?.value?.trim();
      const serverId = inputs[1]?.value?.trim();
      const out = $('#playerName');
      if (!playerId || !serverId) {
        showToast("Please enter your Player ID and Server ID.", "error");
        return;
      }
      const fakeName = `Player${playerId.slice(-4) || playerId}`;
      if (out) out.textContent = `${fakeName} (S${serverId})`;
      const live = document.querySelector('.player-result');
      if (live) live.setAttribute('aria-live', 'polite');
    });
  }

  function setupLoginToggle() {
    const loginBtn = document.querySelector('.login-btn');
    const loginPopup = document.querySelector('.login-popup') || $('#loginPopup');
    if (!loginBtn || !loginPopup) return;
    let visible = false;
    loginBtn.addEventListener('click', () => {
      visible = !visible;
      loginPopup.style.display = visible ? 'block' : 'none';
      loginPopup.setAttribute('aria-hidden', visible ? 'false' : 'true');
    });

    window.addEventListener('click', e => {
      if (!visible) return;
      if (!loginPopup.contains(e.target) && !loginBtn.contains(e.target)) {
        visible = false;
        loginPopup.style.display = 'none';
        loginPopup.setAttribute('aria-hidden', 'true');
      }
    });
  }

  function flashCartButton() {
    const cartBtnMain = document.querySelector('.cart-btn-main');
    if (!cartBtnMain) return;
    cartBtnMain.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.05)' }, { transform: 'scale(1)' }], { duration: 300 });
  }

  // Helpers
  function escapeHTML(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }

  function showToast(message, type = "success") {

    const container = document.getElementById("toastContainer");

    const toast = document.createElement("div");

    toast.className = `toast ${type}`;

    toast.innerHTML = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("show");
    }, 10);

    setTimeout(() => {

      toast.classList.remove("show");

      setTimeout(() => {
        toast.remove();
      }, 300);

    }, 3000);

  }

  async function renderOrderHistory() {

    const container = document.getElementById("orderHistoryList");

    if (!container) return;

    container.innerHTML = `
    <p class="no-orders">Loading order history...</p>
  `;

    try {

      const response = await fetch(
        "http://localhost:3000/orders"
      );

      if (!response.ok) {
        throw new Error("Failed to load orders.");
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(
          data.message || "Unable to load orders."
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

      container.innerHTML = orders.map(order => {

        const date = new Date(
          order.createdAt
        ).toLocaleString();

        const itemsHTML = (order.items || [])
          .map(item => `
          <div class="order-item">

            <strong>
              ${escapeHTML(item.title)}
            </strong>

            <span>
              ${item.qty} × ${formatCurrency(item.price)}
            </span>

            <small>
              Player ID:
              ${escapeHTML(item.playerId || "")}
            </small>

            <small>
              Server ID:
              ${escapeHTML(item.serverId || "")}
            </small>

          </div>
        `)
          .join("");

        return `
        <div class="order-card">

          <div class="order-header">

            <strong>
              ${escapeHTML(order.orderId)}
            </strong>

            <span class="order-status">
              ${escapeHTML(order.status)}
            </span>

          </div>

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
          order.amount / 100
        )}
            </strong>

            <small>
              Reference:
              ${escapeHTML(order.reference)}
            </small>

          </div>

        </div>
      `;

      }).join("");

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

  function init() {
    loadCart();
    renderCart();
    renderOrderHistory();
    setupCardselection();
    setupCartListeners();
    setupPlayerVerify();
    setupLoginToggle();

    document.addEventListener("click", function (e) {
      if (e.target.closest(".close-checkout")) {
        closeCheckout();
      }
    });
    document
      .getElementById("payNowBtn")
      ?.addEventListener("click", payWithPaystack);
  }

  document.querySelector(".cart-btn-main")?.addEventListener("click", () => {

    if (selectedPackage) {
      addToCart(selectedPackage.id, selectedQty);
    } else {
      document.querySelector("#cart").scrollIntoView({
        behavior: "smooth"
      });
    }

  });

  function openCheckout() {

    const modal = document.getElementById("checkoutModal");

    const summary = document.querySelector(".checkout-summary");

    const total = cart.reduce(
      (sum, item) => sum + item.price * item.qty,
      0
    );

    summary.innerHTML = `
        <h3>Total: ${formatCurrency(total)}</h3>
        <p>${totalCartQty()} item(s)</p>
    `;

    modal.style.display = "flex";
  }

  function closeCheckout() {

    document.getElementById("checkoutModal").style.display = "none";

  }

  function payWithPaystack() {

    const emailInput = document.getElementById("checkoutEmail");
    const phoneInput = document.getElementById("checkoutPhone");

    const email = emailInput?.value.trim();
    const phone = phoneInput?.value.trim();

    if (!email) {
      showToast("Please enter your email.", "error");
      return;
    }

    if (!cart.length) {
      showToast("Your cart is empty.", "error");
      return;
    }

    const total = cart.reduce(
      (sum, item) => sum + (item.price * item.qty),
      0
    );

    if (total <= 0) {
      showToast("Invalid payment amount.", "error");
      return;
    }

    if (typeof PaystackPop === "undefined") {
      console.error("PaystackPop is not loaded.");
      showToast("Payment system failed to load. Please refresh.", "error");
      return;
    }

    const paystack = new PaystackPop();

    paystack.newTransaction({

      key: "pk_test_775b4137da255c47dda90f62239ab5fe2d030610",

      email: email,

      amount: Math.round(total * 100),

      currency: "NGN",

      metadata: {
        phone: phone,
        player_id: cart[0]?.playerId || "",
        server_id: cart[0]?.serverId || ""
      },

      onSuccess: async function (transaction) {

        console.log("Paystack payment successful.");
        console.log("Reference:", transaction.reference);

        showToast(
          "Payment received. Verifying...",
          "success"
        );

        try {

          const response = await fetch(
            "http://localhost:3000/verify-payment",
            {
              method: "POST",

              headers: {
                "Content-Type": "application/json"
              },

              body: JSON.stringify({
                reference: transaction.reference,
                items: cart.map(item => ({
                  title: item.title,
                  price: item.price,
                  qty: item.qty,
                  playerId: item.playerId,
                  serverId: item.serverId
                }))
              })
            }
          );

          const data = await response.json();

          console.log("Verification response:", data);

          if (!response.ok || !data.success) {

            showToast(
              "Payment could not be verified.",
              "error"
            );

            return;
          }

          showToast(
            "Payment Verified ✅",
            "success"
          );

          console.log("Verified payment:", data.payment);

          saveOrderHistory(
            transaction.reference,
            data.payment
          );

          closeCheckout();

        } catch (error) {

          console.error(
            "Verification request failed:",
            error
          );

          showToast(
            "Payment completed, but verification failed. Contact support.",
            "error"
          );
        }
      },

      onCancel: function () {

        console.log("Paystack payment cancelled.");

        showToast(
          "Payment cancelled.",
          "warning"
        );
      }

    });



  }

  window.addEventListener('storage', e => {
    if (e.key === STORAGE_KEY) {
      loadCart();
      renderCart();
    }
  });

  // Run
  document.addEventListener('DOMContentLoaded', init);
})();