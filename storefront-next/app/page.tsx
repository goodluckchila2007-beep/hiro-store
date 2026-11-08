'use client';

import Image from 'next/image';
import Link from 'next/link';
import Script from 'next/script';
import { GlassFold } from '@/components/ui/glass-fold';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { launchCategories, type GameCategory } from '@/lib/catalogue';
import { API_BASE, apiFetch } from '@/lib/api-client';

type Product = {
  id: number; categoryId: string; offerId: string; title: string;
  retailPriceNgn: number; available: number; supplierPriceUsd?: number; supplierNote?: string; regionRestriction?: string;
};
type CartLine = { key: string; category: GameCategory; product: Product; qty: number };
declare global { interface Window { PaystackPop?: new () => { resumeTransaction: (accessCode: string, callbacks: { onSuccess: (result: any) => void; onCancel: () => void }) => void } } }

const API = API_BASE;
const money = (amount: number) => new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(amount);

export default function HomePage() {
  const [categories, setCategories] = useState<GameCategory[]>(launchCategories);
  const [activeCategory, setActiveCategory] = useState('mobile_legends_global');
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [query, setQuery] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartFields, setCartFields] = useState<Record<string, Record<string, string>>>({});
  const [cartOpen, setCartOpen] = useState(false);
  const [cartLoaded, setCartLoaded] = useState(false);
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notice, setNotice] = useState('');
  const [globalNotice, setGlobalNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [paystackReady, setPaystackReady] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [supportOpen, setSupportOpen] = useState(false);
  const [supportIssue, setSupportIssue] = useState('');
  const [supportOrderId, setSupportOrderId] = useState('');
  const [supportOrders, setSupportOrders] = useState<{ orderId: string }[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportConversationId, setSupportConversationId] = useState<number | null>(null);
  const [supportMessages, setSupportMessages] = useState<{ sender_role: string; sender_name: string; message: string; created_at: string }[]>([]);
  const [supportDraft, setSupportDraft] = useState('');
  const [supportSending, setSupportSending] = useState(false);
  const [supportStatus, setSupportStatus] = useState('Open');

  const [coinBalance, setCoinBalance] = useState(0);
  const [coinsEnabled, setCoinsEnabled] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [coinsToRedeem, setCoinsToRedeem] = useState(0);
  const [wishlistItems, setWishlistItems] = useState<{ id: number; categoryId: string; offerId: string }[]>([]);
  const [savedGameAccounts, setSavedGameAccounts] = useState<{ id: number; categoryId: string; label: string; fields: Record<string, string> }[]>([]);
  const [playerValidation, setPlayerValidation] = useState<Record<string, { state: 'checking' | 'verified' | 'invalid' | 'error'; playerId: string; serverId: string; message: string }>>({});

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem('hiro-store-cart-v2');
      const savedFields = sessionStorage.getItem('hiro-store-cart-fields-v2');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) setCart(parsed.filter(line => line?.key && line?.product?.offerId && line?.category?.id));
      }
      if (savedFields) {
        const parsedFields = JSON.parse(savedFields);
        if (parsedFields && typeof parsedFields === 'object' && !Array.isArray(parsedFields)) setCartFields(parsedFields);
      }
      const params = new URLSearchParams(window.location.search);
      if (params.get('checkout') === '1') setCartOpen(true);
      if (params.get('support') === '1') setSupportOpen(true);
      if (params.has('checkout') || params.has('support')) {
        params.delete('checkout');
        params.delete('support');
        const query = params.toString();
        window.history.replaceState({}, '', window.location.pathname + (query ? `?${query}` : ''));
      }
    } catch { /* Ignore an invalid local cart and start with an empty bag. */ }
    setCartLoaded(true);
  }, []);

  useEffect(() => {
    if (cartLoaded) {
      sessionStorage.setItem('hiro-store-cart-v2', JSON.stringify(cart));
      sessionStorage.setItem('hiro-store-cart-fields-v2', JSON.stringify(cartFields));
    }
  }, [cart, cartFields, cartLoaded]);

  useEffect(() => {
    fetch(`${API}/api/catalogue/categories`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (Array.isArray(data?.categories) && data.categories.length) setCategories(data.categories); })
      .catch(() => undefined);
    fetch(`${API}/me`, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(data => { setAuthenticated(Boolean(data?.authenticated)); if (data?.user?.email) setEmail(data.user.email); if (data?.user?.phone) setPhone(data.user.phone); if (data?.authenticated) { if (new URLSearchParams(window.location.search).get('support') === '1') openSupport(); fetch(`${API}/api/account/rewards`, { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(wallet => { setCoinBalance(Number(wallet?.coins?.balance || 0)); setCoinsEnabled(Boolean(wallet?.coins?.enabled)); }).catch(() => undefined); apiFetch('/api/account/wishlist', { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(saved => { if (Array.isArray(saved?.items)) setWishlistItems(saved.items); }).catch(() => undefined); fetch(`${API}/api/account/game-accounts`, { credentials: 'include' }).then(r => r.ok ? r.json() : null).then(saved => { if (Array.isArray(saved?.accounts)) setSavedGameAccounts(saved.accounts); }).catch(() => undefined); } })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!supportOpen || !authenticated) return;
    let cancelled = false;
    setSupportLoading(true);
    Promise.all([
      refreshSupportConversation(),
      supportOrders.length ? Promise.resolve() : fetch(`${API}/orders`, { credentials: 'include', headers: { Accept: 'application/json' } }).then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!cancelled && response.ok && Array.isArray(data.orders)) setSupportOrders(data.orders.slice(0, 8).map((order: any) => ({ orderId: String(order.orderId || '') })).filter((order: { orderId: string }) => order.orderId));
      })
    ]).catch(error => {
      if (!cancelled) setGlobalNotice(error instanceof Error ? error.message : 'Unable to load support.');
    }).finally(() => {
      if (!cancelled) setSupportLoading(false);
    });
    return () => { cancelled = true; };
  }, [supportOpen, authenticated]);

  useEffect(() => {
    let cancelled = false;
    setLoadingProducts(true);
    fetch(`${API}/api/products?category=${encodeURIComponent(activeCategory)}`, { credentials: 'include' })
      .then(async response => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || 'Could not load offers.');
        return data;
      })
      .then(data => { if (!cancelled) setProducts(Array.isArray(data.products) ? data.products : []); })
      .catch(() => { if (!cancelled) setProducts([]); })
      .finally(() => { if (!cancelled) setLoadingProducts(false); });
    return () => { cancelled = true; };
  }, [activeCategory]);

  const visibleCategories = useMemo(() => categories.filter(category =>
    `${category.game} ${category.name} ${category.region}`.toLowerCase().includes(query.toLowerCase())
  ), [categories, query]);
  const active = categories.find(category => category.id === activeCategory) || launchCategories[4];

  function openCheckout(product: Product) {
    const key = `${active.id}:${product.offerId}`;
    setCart(current => {
      const existing = current.find(line => line.key === key);
      if (existing) return current.map(line => line.key === key ? { ...line, qty: Math.min(20, line.qty + 1) } : line);
      return [...current, { key, category: active, product, qty: 1 }];
    });
    setCartOpen(true);
    setCouponCode('');
    setCoinsToRedeem(0);
    setNotice('');
  }

  async function toggleWishlist(product: Product) {
    if (!authenticated) { window.location.href = '/account'; return; }
    const existing = wishlistItems.find(item => item.categoryId === active.id && item.offerId === product.offerId);
    if (existing) {
      const response = await apiFetch(`/api/account/wishlist/${existing.id}`, { method: 'DELETE', credentials: 'include' });
      if (response.ok) setWishlistItems(items => items.filter(item => item.id !== existing.id));
      return;
    }
    const response = await apiFetch('/api/account/wishlist', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ categoryId: active.id, offerId: product.offerId }) });
    if (response.ok) {
      const saved = await apiFetch('/api/account/wishlist', { credentials: 'include' }).then(r => r.json()).catch(() => null);
      if (Array.isArray(saved?.items)) setWishlistItems(saved.items);
    }
  }

  function applySavedGameAccount(lineKey: string, accountId: string) {
    const account = savedGameAccounts.find(item => String(item.id) === accountId);
    setCartFields(values => ({ ...values, [lineKey]: account ? { ...account.fields } : {} }));
    setPlayerValidation(values => { const next = { ...values }; delete next[lineKey]; return next; });
  }

  function updateCartField(lineKey: string, fieldKey: string, value: string) {
    setCartFields(values => ({ ...values, [lineKey]: { ...(values[lineKey] || {}), [fieldKey]: value } }));
    setPlayerValidation(values => { const next = { ...values }; delete next[lineKey]; return next; });
  }

  async function verifyPlayer(line: CartLine) {
    const fields = cartFields[line.key] || {};
    const playerId = String(fields.player_id || '').trim();
    const serverId = String(fields.server_id || '').trim();
    if (!playerId || !serverId) { setNotice('Enter the MLBB Player ID and Zone / Server ID before verification.'); return; }
    setPlayerValidation(values => ({ ...values, [line.key]: { state: 'checking', playerId, serverId, message: 'Checking your game account…' } }));
    try {
      const response = await apiFetch('/api/validate-player', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: playerId, zone_id: serverId }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) throw new Error(data.error || 'Unable to verify player right now.');
      if (!data.valid) {
        setPlayerValidation(values => ({ ...values, [line.key]: { state: 'invalid', playerId, serverId, message: 'Account not found. Check the Player ID and Zone / Server ID.' } }));
        return;
      }
      setPlayerValidation(values => ({ ...values, [line.key]: { state: 'verified', playerId, serverId, message: `Verified: ${data.player_name || 'Account verified'}${data.region ? ` · ${data.region}` : ''}` } }));
    } catch (error) {
      setPlayerValidation(values => ({ ...values, [line.key]: { state: 'error', playerId, serverId, message: error instanceof Error ? error.message : 'Validation service unavailable.' } }));
    }
  }

  function changeCartQuantity(key: string, qty: number) {
    setCart(lines => lines.map(line => line.key === key ? { ...line, qty: Math.max(1, Math.min(20, qty || 1)) } : line));
  }

  function removeCartLine(key: string) {
    setCart(lines => lines.filter(line => line.key !== key));
    setCartFields(fields => { const next = { ...fields }; delete next[key]; return next; });
  }

  async function checkout(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!cart.length || busy) return;
    const unverifiedMlbb = cart.find(line => line.category.id.startsWith('mobile_legends_') && (() => { const fields = cartFields[line.key] || {}; const verified = playerValidation[line.key]; return !verified || verified.state !== 'verified' || verified.playerId !== String(fields.player_id || '').trim() || verified.serverId !== String(fields.server_id || '').trim(); })());
    if (unverifiedMlbb) { setNotice(`Verify the Player ID and Server ID for ${unverifiedMlbb.category.name} before checkout.`); return; }
    if (!authenticated) { sessionStorage.setItem('hiro-store-cart-v2', JSON.stringify(cart)); window.location.href = '/account?next=checkout'; return; }
    if (!paystackReady || !window.PaystackPop) { setNotice('Secure payment is still loading. Please wait a moment and try again.'); return; }
    setNotice('');
    setBusy(true);
    let paymentOpened = false;
    try {
      const response = await apiFetch('/api/checkout/create', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email, phone, couponCode, coinsToRedeem, items: cart.map(line => ({ offerId: line.product.offerId, categoryId: line.category.id, qty: line.qty, fields: cartFields[line.key] || {} })) })
      });
      const data = await response.json();
      if (!response.ok || !data.success || !data.order?.reference || !data.accessCode) throw new Error(data.message || 'Unable to prepare checkout.');
      setNotice(`Order total confirmed: ${money(Number(data.order.orderTotal || 0))}. Opening secure payment…`);
      if (!window.PaystackPop) throw new Error('Payment window is still loading. Please try again.');
      const paystack = new window.PaystackPop();
      paystack.resumeTransaction(data.accessCode, {
        onSuccess: async () => {
          try {
            setNotice('Payment received. Verifying your order…');
            const verify = await apiFetch('/verify-payment', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ reference: data.order.reference }) });
            const result = await verify.json().catch(() => ({}));
            setGlobalNotice(!verify.ok || !result.success ? 'Payment received. Your order is processing. Check your account order history; do not pay again.' : 'Payment verified. Your order is now being processed.');
            setCart([]); setCartFields({}); setCartOpen(false); setCouponCode(''); setCoinsToRedeem(0);
          } catch {
            setGlobalNotice('Payment received. Check your account order history; do not pay again while verification completes.');
          } finally { setBusy(false); }
        },
        onCancel: () => { setNotice('Payment was cancelled. Your pending order remains available in your order history.'); setBusy(false); }
      });
      paymentOpened = true;
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Checkout could not be started.');
    } finally { if (!paymentOpened) setBusy(false); }
  }


  const supportOrderIssues = ['Order not received', 'Payment problem', 'Wrong Player ID / Server', 'Refund or failed order'];

  async function refreshSupportConversation() {
    const response = await fetch(`${API}/api/support/conversation`, { credentials: 'include', headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) throw new Error(data.message || 'Unable to load your support conversation.');
    setSupportConversationId(data.conversation?.id ? Number(data.conversation.id) : null);
    setSupportStatus(data.conversation?.status || 'Open');
    setSupportMessages(Array.isArray(data.messages) ? data.messages : []);
  }

  function openSupport() {
    setSupportOpen(true);
  }

  async function sendSupportMessage() {
    if (!authenticated || supportSending) return;
    const draft = supportDraft.trim();
    if (!draft && !supportMessages.length && !supportIssue) return;
    let message = draft;
    if (!supportMessages.length) {
      const orderId = supportOrderIssues.includes(supportIssue) ? supportOrderId.trim() : '';
      message = `Topic: ${supportIssue || 'General enquiry'}${orderId ? `\nOrder ID: ${orderId}` : ''}\n\n${draft || 'Please help me with this issue.'}`;
    }
    setSupportSending(true);
    try {
      const response = await fetch(`${API}/api/support/conversation`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ message, orderId: supportOrderId.trim() || null })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.success) throw new Error(data.message || 'Message could not be sent.');
      setSupportDraft('');
      setSupportIssue('');
      await refreshSupportConversation();
    } catch (error) {
      setGlobalNotice(error instanceof Error ? error.message : 'Message could not be sent.');
    } finally {
      setSupportSending(false);
    }
  }

  return <>
    <Script src="https://js.paystack.co/v2/inline.js" strategy="afterInteractive" onReady={() => setPaystackReady(true)} />
    <Script src="https://widget.trustpilot.com/bootstrap/v5/tp.widget.bootstrap.min.js" strategy="afterInteractive" />
    <div className="site-shell">
      <header className="topbar">
        <Link className="brand" href="/" aria-label="Hiro Store home"><span className="brand-mark">H</span><span>hiro<span className="brand-light">store</span><small>YOUR GAME. YOUR WORLD.</small></span></Link>
        <nav className="main-nav"><a href="#games">Games</a><a href="#regions">Regions</a><a href="#why-hiro">Why Hiro</a></nav>
        <div className="top-actions"><span className="currency-pill">₦ NGN</span><button className="cart-link" onClick={() => setCartOpen(true)}>Bag <b>{cart.reduce((sum, line) => sum + line.qty, 0)}</b></button><Link className="account-link" href="/account"><span className="account-icon">◉</span><span>{authenticated ? 'My account' : 'Sign in'}</span></Link></div>
      </header>

      <main>
        {globalNotice && <div className="site-notice" role="status">{globalNotice}<button onClick={() => setGlobalNotice('')}>Dismiss</button></div>}
        <section className="hero">
          <div className="hero-noise" />
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-dot" /> THE NEXT LEVEL OF GAME TOP-UPS</div>
            <h1>Your game.<br /><em>Your world.</em><br />Your store.</h1>
            <p>Power up in a few clicks. Discover game credits, passes and digital essentials with a smoother way to shop.</p>
            <div className="hero-ctas"><a className="primary-btn" href="#games">Explore games <span>↗</span></a><Link className="quiet-btn" href="/account">Your Hiro account <span>→</span></Link></div>
            <div className="hero-proof"><span><b>✦</b> Secure Paystack checkout</span><span><b>◷</b> Order tracking</span><span><b>◎</b> Digital delivery</span></div>
          </div>
          <div className="hero-art" aria-label="Abstract animated glass artwork">
            <GlassFold className="hero-glass-fold" color1="#142448" color2="#6e66b9" color3="#91e1e5" speed={0.42} scale={1.15} noise={0.055} />
            <div className="orbit orbit-one" /><div className="orbit orbit-two" />
            <div className="glass-panel glass-back"><span>LEVEL UP</span><b>+ XP</b></div>
            <div className="glass-panel glass-main"><div className="glass-shine" /><span className="glass-label">HIRO / 002</span><strong>PLAY<br /><i>WITHOUT</i><br />LIMITS.</strong><div className="glass-bottom"><span>GAME ON</span><span>↗</span></div></div>
            <div className="glass-panel glass-front"><span>POWER UP</span><b>✦</b></div>
            <div className="hero-orb" />
          </div>
          <div className="hero-index"><span>01</span><i /> <span>THE STORE REIMAGINED</span></div>
        </section>

        <section className="ticker" aria-label="Hiro Store benefits"><div>INSTANT CHECKOUT <b>✦</b> REGIONAL GAME OPTIONS <b>✦</b> SECURE PAYMENTS <b>✦</b> REWARDS ON THE WAY <b>✦</b> INSTANT CHECKOUT <b>✦</b> REGIONAL GAME OPTIONS <b>✦</b> SECURE PAYMENTS <b>✦</b></div></section>

        <section className="section games-section" id="games">
          <div className="section-heading"><div><div className="section-kicker">THE LINE-UP / 01</div><h2>Choose your <em>game.</em></h2><p>Find your title, pick the correct region and get back in the action.</p></div><div className="game-search"><span>⌕</span><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Search games or regions" aria-label="Search games or regions" /></div></div>
          <div className="category-grid">
            {visibleCategories.map((category, index) => <button key={category.id} className={`category-card ${activeCategory === category.id ? 'is-active' : ''}`} onClick={() => setActiveCategory(category.id)}>
              <span className="card-number">0{index + 1}</span><span className={`game-symbol symbol-${category.id.split('_')[0]}`}>{category.game === 'Mobile Legends' ? 'ML' : category.game === 'Call of Duty: Mobile' ? 'COD' : category.game === 'Genshin Impact' ? 'GI' : category.game === 'Honkai: Star Rail' ? 'HSR' : category.game === 'Marvel Rivals' ? 'MR' : category.game === 'Blood Strike' ? 'BS' : 'LM'}</span>
              <span className="category-name">{category.name}</span><span className="region-chip">{category.region}</span><span className="category-arrow">↗</span>
              <span className="category-restriction">{category.restriction}</span>
            </button>)}
          </div>
          {visibleCategories.length === 0 && <div className="empty-state">No games match that search. Try another title or region.</div>}
        </section>

        <section className="section offers-section">
          <div className="section-heading compact"><div><div className="section-kicker">SELECTED REGION / 02</div><h2>{active.name}<span className="region-chip heading-chip">{active.region}</span></h2><p className="restriction-note">{active.restriction}</p></div><div className="offer-caption">PRICES DISPLAYED IN<br /><b>NIGERIAN NAIRA (₦)</b></div></div>
          <div className="offers-grid">
            {loadingProducts && <div className="empty-state">Loading available offers…</div>}
            {!loadingProducts && products.filter(product => product.available && Number(product.retailPriceNgn) > 0).map(product => <article className="offer-card" key={`${product.categoryId}-${product.offerId}`}>
              <div className="offer-card-top"><span className="offer-tag">{active.region} REGION</span><span className="offer-spark">✦</span></div><h3>{product.title}</h3><p className="offer-restriction">{product.regionRestriction || product.supplierNote || active.restriction}</p><div className="offer-price">{money(Number(product.retailPriceNgn))}</div><div className="offer-actions"><button className="wishlist-btn" aria-label="Save to wishlist" aria-pressed={wishlistItems.some(item => item.categoryId === active.id && item.offerId === product.offerId)} onClick={() => toggleWishlist(product)}>{wishlistItems.some(item => item.categoryId === active.id && item.offerId === product.offerId) ? '♥' : '♡'}</button><button className="buy-btn" onClick={() => openCheckout(product)}>Add to bag <span>↗</span></button></div>
            </article>)}
            {!loadingProducts && products.filter(product => product.available && Number(product.retailPriceNgn) > 0).length === 0 && <div className="empty-state wide">Offers for this region will appear here as they are activated and priced. Choose another region above to explore.</div>}
          </div>
        </section>

        <section className="region-feature" id="regions"><div className="region-feature-copy"><div className="section-kicker">NO GUESSWORK / 03</div><h2>Right region.<br /><em>Right top-up.</em></h2><p>Some games have separate regional products. Hiro makes the region clear before you pay, so you can choose the version that matches your game account.</p><a href="#games" className="text-link">Browse all regional options <span>↗</span></a></div><div className="region-art"><Image src="/img/mlbb-banner.jpeg" alt="Mobile Legends game artwork" fill sizes="(max-width: 800px) 100vw, 50vw" /></div></section>

        <section className="section why-section" id="why-hiro"><div className="section-kicker">THE HIRO DIFFERENCE / 04</div><h2>Made for the<br /><em>way you play.</em></h2><div className="benefit-grid"><article><span>01 /</span><b>Clear game regions</b><p>Regional restrictions are visible before checkout. No hidden surprises.</p></article><article><span>02 /</span><b>Secure payments</b><p>Checkout is handled through Paystack, with your order linked to its payment reference.</p></article><article><span>03 /</span><b>Track every order</b><p>Follow payment and delivery progress from your customer account.</p></article><article><span>04 /</span><b>Rewards are coming</b><p>Hiro Coins, member perks and coupons are part of the new account experience.</p></article></div></section>
      </main>

      <section className="hiro-trustpilot-section" aria-label="Hiro Store customer reviews">
      <div className="section-kicker">PLAYER FEEDBACK / TRUSTPILOT</div>
      <h2>Real experiences.<br /><em>Honest reviews.</em></h2>
      <p>See what customers say about shopping with Hiro Store.</p>
      <div className="trustpilot-widget" data-locale="en-US" data-template-id="56278e9abfbbba0bdcd568bc" data-businessunit-id="6a90102a375fbf31a1fd8243" data-style-height="52px" data-style-width="100%" data-token="4f1634c9-aa20-4d2d-b292-791c7e42b217">
        <a href="https://www.trustpilot.com/review/hirostore.site" target="_blank" rel="noopener noreferrer">Trustpilot</a>
      </div>
    </section>
    <footer className="footer"><Link className="brand footer-brand" href="/"><span className="brand-mark">H</span><span>hiro<span className="brand-light">store</span><small>YOUR GAME. YOUR WORLD.</small></span></Link><span>© {new Date().getFullYear()} Hiro Store. Built for players.</span><div><Link href="/account">Account</Link><a href="/privacy-policy.html">Privacy</a><a href="/terms.html">Terms</a></div></footer>
    </div>

    <button
      type="button"
      className="hiro-floating-support"
      onClick={openSupport}
      aria-label="Open Hiro Store Support"
    >
      <span className="hiro-support-icon" aria-hidden="true">☏</span>
      <span>Chat with Support</span>
    </button>

    {supportOpen && <div className="hiro-support-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setSupportOpen(false); }}>
      <section className="hiro-support-panel" role="dialog" aria-modal="true" aria-labelledby="hiro-support-title">
        <button type="button" className="hiro-support-close" onClick={() => setSupportOpen(false)} aria-label="Close support">×</button>
        <p className="hiro-support-kicker">HIRO STORE CUSTOMER CARE</p>
        <h2 id="hiro-support-title">Support chat</h2>
        {!authenticated ? <div className="hiro-support-note">Please <a href="/account">sign in to your Hiro account</a> to start a support conversation and keep your messages together.</div> : <>
          <div className="hiro-support-chat-status"><span className={supportStatus === 'Open' ? 'is-open' : ''}>{supportStatus}</span>{supportConversationId ? ` · Conversation #${supportConversationId}` : ' · New conversation'}</div>
          <div className="hiro-support-chat-messages" aria-live="polite">
            {supportLoading ? <p>Loading your conversation…</p> : supportMessages.length ? supportMessages.map((message, index) => <article className={`hiro-support-message ${message.sender_role === 'customer' ? 'mine' : 'theirs'}`} key={`${message.created_at}-${index}`}><strong>{message.sender_role === 'customer' ? 'You' : 'Hiro Store Support'}</strong><p>{message.message}</p><time>{new Date(message.created_at).toLocaleString()}</time></article>) : <p className="hiro-support-empty">No messages yet. Choose a topic and send us a message to start.</p>}
          </div>
          {!supportMessages.length && <div className="hiro-support-choices">
            {[
              ['Order not received', '📦', "My top-up hasn't arrived"],
              ['Payment problem', '💳', 'Payment failed or I was charged'],
              ['Wrong Player ID / Server', '🎮', 'I entered incorrect game details'],
              ['Refund or failed order', '↩', 'I need help with a failed transaction'],
              ['Something else', '💬', 'A general question']
            ].map(([issue, icon, description]) => <button type="button" key={issue} className={`hiro-support-choice ${supportIssue === issue ? 'selected' : ''}`} onClick={() => setSupportIssue(issue)}><span>{icon}</span><span><strong>{issue}</strong><small>{description}</small></span><span className="hiro-support-check">{supportIssue === issue ? '✓' : ''}</span></button>)}
          </div>}
          {!supportMessages.length && supportOrderIssues.includes(supportIssue) && <div className="hiro-support-order">
            <label htmlFor="hiro-support-order">Order ID <span>(optional)</span></label>
            {supportOrders.length > 0 && <select aria-label="Select a recent order" value={supportOrderId} onChange={event => setSupportOrderId(event.target.value)}><option value="">Select a recent order</option>{supportOrders.map(order => <option key={order.orderId} value={order.orderId}>{order.orderId}</option>)}</select>}
            <input id="hiro-support-order" value={supportOrderId} onChange={event => setSupportOrderId(event.target.value)} placeholder="Enter an order ID" maxLength={80} />
          </div>}
          <textarea className="hiro-support-chat-input" value={supportDraft} onChange={event => setSupportDraft(event.target.value)} placeholder="Write your message…" rows={3} maxLength={3000} />
          <button type="button" className="hiro-support-submit" disabled={supportSending || (!supportDraft.trim() && (supportMessages.length > 0 || !supportIssue))} onClick={sendSupportMessage}>{supportSending ? 'Sending…' : 'Send message ↗'}</button>
          {supportStatus === 'Resolved' && <p className="hiro-support-note">This conversation is resolved. Send a new message to open a new conversation.</p>}
        </>}
      </section>
    </div>}

    {cartOpen && <div className="modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setCartOpen(false); }}><section className="checkout-modal cart-modal" role="dialog" aria-modal="true" aria-labelledby="checkout-title"><button className="modal-close" onClick={() => setCartOpen(false)} aria-label="Close">×</button><div className="section-kicker">YOUR BAG / SECURE CHECKOUT</div><h2 id="checkout-title">Ready when you are.</h2>
      {cart.length === 0 ? <div className="empty-state">Your bag is empty. Choose a game offer to get started.</div> : <form onSubmit={checkout}>
      {cart.map(line => <div className="cart-line" key={line.key}><div className="cart-line-heading"><div><b>{line.product.title}</b><small>{line.category.name} · {line.category.restriction}</small><small className="cart-restriction">{line.product.regionRestriction || line.product.supplierNote || line.category.restriction}</small></div><button type="button" onClick={() => removeCartLine(line.key)}>Remove</button></div>
        {savedGameAccounts.some(account => account.categoryId === line.category.id) && <label className="form-field saved-account-select">Use a saved game account<select defaultValue="" onChange={event => applySavedGameAccount(line.key, event.target.value)}><option value="">Enter details manually</option>{savedGameAccounts.filter(account => account.categoryId === line.category.id).map(account => <option key={account.id} value={account.id}>{account.label}</option>)}</select></label>}
        {line.category.fields.map(field => <label className="form-field" key={`${line.key}-${field.key}`}>{field.label}{field.required && <i>*</i>}{field.type === 'select' ? <select required={field.required} value={cartFields[line.key]?.[field.key] || ''} onChange={event => updateCartField(line.key, field.key, event.target.value)}><option value="">Choose {field.label}</option>{field.options?.map(option => <option key={option} value={option}>{option}</option>)}</select> : <input required={field.required} value={cartFields[line.key]?.[field.key] || ''} onChange={event => updateCartField(line.key, field.key, event.target.value)} placeholder={`Enter ${field.label}`} />}</label>)}
        {line.category.id.startsWith('mobile_legends_') && <div className="player-validation"><button type="button" className="verify-player-btn" disabled={playerValidation[line.key]?.state === 'checking'} onClick={() => verifyPlayer(line)}>{playerValidation[line.key]?.state === 'checking' ? 'Verifying account…' : playerValidation[line.key]?.state === 'verified' ? 'Verify again' : 'Verify MLBB account'}</button>{playerValidation[line.key] && <p className={`validation-message ${playerValidation[line.key].state}`}>{playerValidation[line.key].message}</p>}</div>}
        <div className="cart-line-bottom"><label className="form-field">Quantity<input type="number" min="1" max="20" value={line.qty} onChange={event => changeCartQuantity(line.key, Number(event.target.value))} /></label><b>{money(Number(line.product.retailPriceNgn) * line.qty)}</b></div>
      </div>)}
      <label className="form-field">Email<input required type="email" value={email} onChange={event => setEmail(event.target.value)} placeholder="you@example.com" /></label><label className="form-field">Phone number<input value={phone} onChange={event => setPhone(event.target.value)} placeholder="Optional" /></label>
      <label className="form-field">Coupon code (optional)<input value={couponCode} onChange={event => setCouponCode(event.target.value.toUpperCase())} placeholder="Enter coupon code" /></label>
      {coinsEnabled && coinBalance > 0 && <label className="form-field">Hiro Coins to redeem (available: {coinBalance.toLocaleString('en-NG')})<input type="number" min="0" max={coinBalance} value={coinsToRedeem || ''} onChange={event => setCoinsToRedeem(Math.max(0, Math.min(coinBalance, Number(event.target.value) || 0)))} placeholder="0" /></label>}
      <div className="checkout-total"><span>Estimated total before discounts</span><b>{money(cart.reduce((sum, line) => sum + Number(line.product.retailPriceNgn) * line.qty, 0))}</b></div>
      {notice && <p className="form-notice" role="status">{notice}</p>}<button className="primary-btn checkout-submit" disabled={busy || !paystackReady}>{busy ? 'Preparing payment…' : paystackReady ? 'Continue to Paystack' : 'Loading secure checkout…'} <span>↗</span></button><small className="checkout-disclaimer">Hiro confirms product prices, coupon eligibility and coin balance on the server. Each purchased unit becomes its own fulfilment item.</small>
    </form>}</section></div>}
  </>;
}
