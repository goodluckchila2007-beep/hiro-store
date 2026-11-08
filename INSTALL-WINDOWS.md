# Hiro Store 2.0 — Windows installation (local setup)

This package contains both interfaces and one shared backend:

- Customer storefront: Next.js on `http://localhost:3001`
- Admin dashboard: existing Express-served admin page at `http://localhost:3000/admin.html`
- Shared API, sessions and SQLite database: Express on port `3000`

You do **not** install two separate databases. Run the backend once, then run the customer storefront in a second terminal. The admin is served by the backend.

## Before you start

1. Install **Node.js 22 LTS** for Windows from the official Node.js website. npm is included.
2. Extract this ZIP to a simple folder, for example `C:\Projects\HIRO-STORE-2`.
3. Open PowerShell in that extracted folder (the folder containing `package.json` and `server.js`).

Check the tools:

```powershell
node -v
npm -v
```

## 1. Configure the backend

```powershell
Copy-Item .env.example .env
```

Open `.env` in Notepad or VS Code and set local development values. At minimum:

```env
NODE_ENV=development
PORT=3000
FRONTEND_ORIGIN=http://localhost:3001
SESSION_SECRET=replace-this-with-a-long-random-secret
PAYSTACK_PUBLIC_KEY=pk_test_your_test_public_key
PAYSTACK_SECRET_KEY=sk_test_your_test_secret_key
FZR_API_KEY=your_FZR_key_if_you_are_ready_to_test_catalogue_sync
FZR_EXCHANGE_RATE=1400
```

Use Paystack **test** keys for local testing. Keep `.env` private; never send it in screenshots or upload it publicly. Do not paste API secrets into chat. SMTP can remain blank for basic local UI work, but email verification and email delivery cannot be fully tested until SMTP is configured.

Install backend packages:

```powershell
npm ci
```

If `npm ci` reports that the lockfile and package file are out of sync, stop and report the error rather than deleting the lockfile or switching package managers blindly.

## 2. Start the backend and admin

In the first PowerShell window, from the project root:

```powershell
npm start
```

Keep this window open. When the server starts, open:

- Admin: `http://localhost:3000/admin.html`
- Existing backend health/API routes are served from port `3000`.

Sign in with the existing authorised admin account. This package intentionally does not create a public admin-registration route. If you do not have the current admin login, do not edit the database manually; ask for the approved admin-account recovery procedure.

## 3. Install and start the customer storefront

Open a **second** PowerShell window and move into the storefront folder:

```powershell
cd C:\Projects\HIRO-STORE-2\storefront-next
Copy-Item .env.example .env.local
npm install
npm run dev
```

The `.env.local` example points the storefront to the local Express API at `http://localhost:3000`. Keep that value for this local setup.

Open the customer storefront:

- Storefront: `http://localhost:3001`

Both PowerShell windows must remain open while you use the local applications.

## 4. What to verify locally

1. Open the storefront and confirm the ten game/region categories render.
2. Open the admin in the other browser tab and sign in.
3. Check that catalogue sync and product pricing are available in admin. Do not sync FZR until a valid key is configured and you intend to make a supplier API request.
4. Imported offers with no configured retail price should remain unavailable to customers.
5. Use Paystack test credentials only. Do not place real-money test orders or use a live Paystack key in local development.
6. Verify order and fulfilment behaviour in a separate staging database before connecting this version to production.

## 5. Stop the applications

In each PowerShell window, press `Ctrl+C`. The backend and storefront stop independently.

## Important production warning

These instructions are for a local development copy only. They do not deploy the site publicly. Before production deployment, the project still needs a verified Next.js production build, full backend integration tests, a tested backup/restore of the existing SQLite database, staging payment/fulfilment checks and a reviewed reverse-proxy configuration. Do not overwrite the live application or production database with this working copy.
