'use client';

import Link from 'next/link';
import { launchCategories } from '@/lib/catalogue';
import { API_BASE, apiFetch } from '@/lib/api-client';
import { FormEvent, useEffect, useState } from 'react';

const API = API_BASE;
type User = { id: number; name: string; email: string; phone?: string; avatar?: string; createdAt?: string };
type Order = { orderId: string; status: string; orderTotal: number; subtotalNgn?: number; discountNgn?: number; couponCode?: string | null; coinsRedeemed?: number; coinsEarned?: number; createdAt: string; items: { title: string; price: number; qty: number; fulfillmentStatus: string; categoryId?: string; playerFields?: Record<string, string> }[] };
type SavedAccount = { id: number; categoryId: string; label: string; fields: Record<string, string>; updatedAt: string };
type WishlistItem = { id: number; categoryId: string; offerId: string; title: string; retailPriceNgn: number; available: number };
type Wallet = { coins: { balance: number; enabled: boolean; transactions: { amount: number; kind: string; description: string; createdAt: string }[] }; coupons: { active: { code: string; discountType: string; discountValue: number; minOrderNgn: number; endsAt?: string }[]; history: { code: string; discountNgn: number; status: string; createdAt: string }[] } };

export default function AccountPage() {
  const [user, setUser] = useState<User | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [savedAccounts, setSavedAccounts] = useState<SavedAccount[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [newAccount, setNewAccount] = useState({ categoryId: 'mobile_legends_global', label: '', fields: {} as Record<string, string> });
  const [profileEdit, setProfileEdit] = useState(false);
  const [mode, setMode] = useState<'login' | 'signup' | 'forgot'>('login');
  const [tab, setTab] = useState('Overview');
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  async function loadAccount() {
    const response = await fetch(`${API}/me`, { credentials: 'include' });
    if (!response.ok) { setUser(null); return; }
    const data = await response.json();
    setUser(data.user || null);
    if (data.user) setForm(current => ({ ...current, name: data.user.name || '', email: data.user.email || '', phone: data.user.phone || '' }));
    const orderResponse = await fetch(`${API}/orders`, { credentials: 'include' });
    if (orderResponse.ok) { const orderData = await orderResponse.json(); setOrders(Array.isArray(orderData.orders) ? orderData.orders : []); }
    const walletResponse = await fetch(`${API}/api/account/rewards`, { credentials: 'include' });
    if (walletResponse.ok) setWallet(await walletResponse.json());
    const accountResponse = await apiFetch('/api/account/game-accounts', { credentials: 'include' });
    if (accountResponse.ok) { const accountData = await accountResponse.json(); setSavedAccounts(Array.isArray(accountData.accounts) ? accountData.accounts : []); }
    const wishlistResponse = await fetch(`${API}/api/account/wishlist`, { credentials: 'include' });
    if (wishlistResponse.ok) { const wishlistData = await wishlistResponse.json(); setWishlist(Array.isArray(wishlistData.items) ? wishlistData.items : []); }
  }

  useEffect(() => { loadAccount().catch(() => undefined); }, []);

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setNotice('');
    try {
      const response = await apiFetch(`/${mode === 'login' ? 'login' : 'signup'}`, {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(form)
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Unable to continue.');
      setNotice(data.message || 'Success.');
      if (mode === 'login') { await loadAccount(); if (new URLSearchParams(window.location.search).get('next') === 'checkout') window.location.href = '/?checkout=1'; }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Unable to continue.'); }
    finally { setBusy(false); }
  }


  async function submitForgotPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice('');
    try {
      const response = await apiFetch('/forgot-password', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ email: form.email })
      });
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.message || 'Unable to request a reset link.');
      setNotice(data.message || 'If an account exists with that email, a reset link has been sent.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Unable to request a reset link.');
    } finally {
      setBusy(false);
    }
  }

  async function saveGameAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice('');
    const response = await apiFetch('/api/account/game-accounts', { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newAccount) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) { setNotice(data.message || 'Could not save game account.'); return; }
    setNewAccount({ categoryId: 'mobile_legends_global', label: '', fields: {} });
    await loadAccount(); setNotice('Game account saved.');
  }

  async function deleteGameAccount(id: number) {
    const response = await apiFetch(`/api/account/game-accounts/${id}`, { method: 'DELETE', credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (response.ok && data.success) setSavedAccounts(accounts => accounts.filter(account => account.id !== id));
    else setNotice(data.message || 'Could not delete saved account.');
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await apiFetch('/me', { method: 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: form.name, phone: form.phone }) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.success) { setNotice(data.message || 'Could not update profile.'); return; }
    setUser(data.user); setProfileEdit(false); setNotice('Profile updated.');
  }

  async function logout() {
    await apiFetch('/logout', { method: 'POST', credentials: 'include' });
    setUser(null); setOrders([]); setNotice('You have been signed out.');
  }

  const tabs = ['Overview', 'My orders', 'Game accounts', 'Wishlist', 'Hiro Coins', 'My coupons', 'Profile', 'Help & support'];
  if (!user) return <main className="account-auth-page"><Link className="brand" href="/"><span className="brand-mark">H</span><span>hiro<span className="brand-light">store</span><small>YOUR GAME. YOUR WORLD.</small></span></Link><section className="auth-card"><div className="section-kicker">YOUR PLAYER HQ</div><h1>{mode === 'login' ? 'Welcome back.' : mode === 'signup' ? 'Join the Hiro world.' : 'Reset your password.'}</h1><p>{mode === 'forgot' ? 'Enter your account email and we will send you a secure password reset link.' : 'Sign in to manage orders, game accounts and rewards.'}</p><form onSubmit={mode === 'forgot' ? submitForgotPassword : submitAuth}>{mode === 'signup' && <label className="form-field">Full name<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>}<label className="form-field">Email<input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>{mode === 'signup' && <label className="form-field">Phone<input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} /></label>}{mode !== 'forgot' && <label className="form-field">Password<input type="password" minLength={8} required value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>}{mode === 'login' && <button type="button" className="auth-switch" style={{margin:'4px 0 18px'}} onClick={() => { setMode('forgot'); setNotice(''); }}>Forgot password?</button>}{notice && <p className="form-notice" role="status">{notice}</p>}<button className="primary-btn checkout-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'} <span>↗</span></button></form>{mode === 'forgot' ? <button className="auth-switch" onClick={() => { setMode('login'); setNotice(''); }}>← Back to sign in</button> : <button className="auth-switch" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setNotice(''); }}>{mode === 'login' ? 'New to Hiro? Create an account' : 'Already have an account? Sign in'}</button>}<Link className="back-link" href="/">← Back to store</Link></section></main>;

  return <main className="account-page"><header className="account-header"><Link className="brand" href="/"><span className="brand-mark">H</span><span>hiro<span className="brand-light">store</span><small>YOUR GAME. YOUR WORLD.</small></span></Link><Link className="quiet-btn" href="/">Continue shopping ↗</Link></header><div className="account-layout"><aside className="account-sidebar"><div className="account-user"><div className="avatar-circle">{user.name?.slice(0, 1).toUpperCase() || 'H'}</div><div><b>{user.name}</b><small>{user.email}</small></div></div><nav>{tabs.map(item => <button key={item} className={tab === item ? 'active' : ''} onClick={() => setTab(item)}>{item}<span>→</span></button>)}</nav><button className="logout-btn" onClick={logout}>Sign out ↗</button></aside><section className="account-content"><div className="section-kicker">HIRO PLAYER HQ / ACCOUNT</div><h1>{tab === 'Overview' ? `Good to see you, ${user.name.split(' ')[0]}.` : tab}</h1>{tab === 'Overview' && <><p className="account-lead">Your orders, game details and member benefits in one place.</p><div className="account-stat-grid"><article><small>ORDERS PLACED</small><b>{orders.length}</b><span>All-time orders</span></article><article><small>HIRO COINS</small><b>{wallet?.coins?.balance?.toLocaleString('en-NG') ?? '0'}</b><span>{wallet?.coins?.enabled ? 'Available rewards balance' : 'Rewards awaiting activation'}</span></article><article><small>ACCOUNT STATUS</small><b className="status-good">Active</b><span>Member since {user.createdAt ? new Date(user.createdAt).toLocaleDateString() : '—'}</span></article></div><div className="account-panel"><div className="panel-heading"><h2>Recent orders</h2><button onClick={() => setTab('My orders')}>View all ↗</button></div>{orders.slice(0, 4).length ? orders.slice(0, 4).map(order => <div className="order-row" key={order.orderId}><div><b>{order.orderId}</b><small>{new Date(order.createdAt).toLocaleString()}</small></div><div><b>₦{Number(order.orderTotal).toLocaleString('en-NG')}</b><small>{order.status}{order.discountNgn ? ` · Saved ₦${Number(order.discountNgn).toLocaleString('en-NG')}` : ''}</small></div></div>) : <p className="muted">Your orders will appear here after your first purchase.</p>}</div></>}
    {tab === 'My orders' && <div className="account-panel">{orders.length ? orders.map(order => <article className="account-order-card" key={order.orderId}><div className="order-row"><div><b>{order.orderId}</b><small>{new Date(order.createdAt).toLocaleString()}</small></div><div><b>₦{Number(order.orderTotal).toLocaleString('en-NG')}</b><small>{order.status}</small></div></div>{order.items.map((item, index) => <div className="account-order-item" key={`${order.orderId}-${index}`}><div><b>{item.title}</b><small>{launchCategories.find(category => category.id === item.categoryId)?.name || item.categoryId || 'Digital item'} · Qty {item.qty}</small>{item.playerFields && <small>{Object.entries(item.playerFields).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value}`).join(' · ')}</small>}</div><span>{item.fulfillmentStatus}</span></div>)}{(order.discountNgn || order.coinsRedeemed || order.coinsEarned) ? <div className="order-reward-summary">{order.couponCode && <span>Coupon: {order.couponCode}</span>}{order.discountNgn ? <span>Discount: ₦{Number(order.discountNgn).toLocaleString('en-NG')}</span> : null}{order.coinsRedeemed ? <span>Coins used: {order.coinsRedeemed}</span> : null}{order.coinsEarned ? <span>Coins earned: {order.coinsEarned}</span> : null}</div> : null}</article>) : <p className="muted">No orders yet. <Link href="/">Explore the store.</Link></p>}</div>}
    {tab === 'Profile' && <div className="account-panel profile-details"><div className="panel-heading"><h2>Personal information</h2><button onClick={() => setProfileEdit(value => !value)}>{profileEdit ? 'Cancel' : 'Edit profile'}</button></div>{profileEdit ? <form onSubmit={saveProfile}><label className="form-field">Full name<input required value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label><label className="form-field">Email<input disabled value={user.email} /></label><label className="form-field">Phone number<input value={form.phone} onChange={event => setForm({ ...form, phone: event.target.value })} /></label><button className="primary-btn">Save profile</button></form> : <><div><small>FULL NAME</small><b>{user.name}</b></div><div><small>EMAIL ADDRESS</small><b>{user.email}</b></div><div><small>PHONE NUMBER</small><b>{user.phone || 'Not added yet'}</b></div></>}</div>}
    {tab === 'Game accounts' && <div className="account-panel"><h2>Saved game accounts</h2><p className="muted">Keep player IDs and region details ready for your next top-up. These details are private to your account.</p>{savedAccounts.map(account => <div className="saved-account-row" key={account.id}><div><b>{account.label}</b><small>{launchCategories.find(category => category.id === account.categoryId)?.name || account.categoryId}</small><small>{Object.entries(account.fields).map(([key, value]) => `${key.replaceAll('_', ' ')}: ${value}`).join(' · ')}</small></div><button onClick={() => deleteGameAccount(account.id)}>Remove</button></div>)}<form className="saved-account-form" onSubmit={saveGameAccount}><h3>Add a game account</h3><label className="form-field">Game / region<select value={newAccount.categoryId} onChange={event => setNewAccount({ categoryId: event.target.value, label: newAccount.label, fields: {} })}>{launchCategories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label className="form-field">Account nickname<input required value={newAccount.label} onChange={event => setNewAccount({ ...newAccount, label: event.target.value })} placeholder="e.g. Main account" /></label>{launchCategories.find(category => category.id === newAccount.categoryId)?.fields.map(field => <label className="form-field" key={field.key}>{field.label}{field.type === 'select' ? <select required={field.required} value={newAccount.fields[field.key] || ''} onChange={event => setNewAccount({ ...newAccount, fields: { ...newAccount.fields, [field.key]: event.target.value } })}><option value="">Choose {field.label}</option>{field.options?.map(option => <option key={option}>{option}</option>)}</select> : <input required={field.required} value={newAccount.fields[field.key] || ''} onChange={event => setNewAccount({ ...newAccount, fields: { ...newAccount.fields, [field.key]: event.target.value } })} />}</label>)}<button className="primary-btn">Save game account ↗</button></form></div>}
    {tab === 'Wishlist' && <div className="account-panel"><h2>Your saved offers</h2>{wishlist.length ? wishlist.map(item => <div className="order-row" key={item.id}><div><b>{item.title || item.offerId}</b><small>{launchCategories.find(category => category.id === item.categoryId)?.name || item.categoryId}</small></div><div><b>{item.retailPriceNgn > 0 ? `₦${item.retailPriceNgn.toLocaleString('en-NG')}` : 'Not priced'}</b><button className="wishlist-remove" onClick={async () => { const response = await apiFetch(`/api/account/wishlist/${item.id}`, { method: 'DELETE', credentials: 'include' }); if (response.ok) setWishlist(items => items.filter(saved => saved.id !== item.id)); }}>Remove</button></div></div>) : <p className="muted">Save offers from the storefront and they will appear here.</p>}<Link className="text-link" href="/">Explore offers ↗</Link></div>}
    {tab === 'Hiro Coins' && <div className="account-panel"><h2>Your rewards wallet</h2><div className="coin-balance"><small>AVAILABLE HIRO COINS</small><b>{wallet?.coins?.balance?.toLocaleString('en-NG') ?? '0'}</b><span>{wallet?.coins?.enabled ? 'Your coins can be used at checkout when redemption is configured.' : 'Hiro Coins are not active yet. Your balance and history will appear here.'}</span></div><h3>Coin activity</h3>{wallet?.coins?.transactions?.length ? wallet.coins.transactions.map((transaction, index) => <div className="order-row" key={`${transaction.createdAt}-${index}`}><div><b>{transaction.description}</b><small>{new Date(transaction.createdAt).toLocaleString()}</small></div><strong className={transaction.amount > 0 ? 'coin-positive' : 'coin-negative'}>{transaction.amount > 0 ? '+' : ''}{transaction.amount}</strong></div>) : <p className="muted">No coin transactions yet.</p>}</div>}
    {tab === 'My coupons' && <div className="account-panel"><h2>Available coupons</h2>{wallet?.coupons?.active?.length ? wallet.coupons.active.map(coupon => <div className="order-row" key={coupon.code}><div><b>{coupon.code}</b><small>{coupon.discountType === 'percent' ? `${coupon.discountValue}% off` : `₦${coupon.discountValue.toLocaleString('en-NG')} off`} · Minimum spend ₦{coupon.minOrderNgn.toLocaleString('en-NG')}</small></div><span>{coupon.endsAt ? `Ends ${new Date(coupon.endsAt).toLocaleDateString()}` : 'No expiry shown'}</span></div>) : <p className="muted">No active coupons at the moment.</p>}<h3>Coupon history</h3>{wallet?.coupons?.history?.length ? wallet.coupons.history.map((coupon, index) => <div className="order-row" key={`${coupon.code}-${index}`}><div><b>{coupon.code}</b><small>₦{coupon.discountNgn.toLocaleString('en-NG')} discount</small></div><span>{coupon.status}</span></div>) : <p className="muted">Your redeemed coupons will appear here.</p>}</div>}
    {tab === 'Help & support' && <div className="account-panel"><h2>Need a hand?</h2><p className="muted">Your existing Hiro support conversations remain available through the support system.</p><a className="text-link" href={`${API}/profile.html`}>Open existing support centre ↗</a></div>}
    </section></div></main>;
}
