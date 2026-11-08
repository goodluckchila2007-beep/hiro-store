# Hiro Store 2.0 — Renovation Working Copy

This is a separate implementation workspace based on the supplied Hiro Store V1 source. It does not connect to or modify the live VPS. Existing V1 files are retained as the baseline; the new Next.js customer storefront is in `storefront-next/` and the Express/SQLite backend remains at the project root.

## Current architecture

- **Backend:** existing Node.js + Express application (`server.js`), SQLite (`better-sqlite3`), Paystack, FZR.
- **Customer storefront:** new Next.js App Router application in `storefront-next/`, intended to run on port `3001` during local development.
- **Admin:** existing admin console is being extended in place so the existing order and support workflows remain intact.
- **Currency / launch market:** NGN / Nigeria at launch.
- **Supplier / payment gateway:** FZR and Paystack are retained.

## Run locally

1. Copy `.env.example` to `.env` and supply test credentials. Never commit `.env`.
2. Install backend dependencies with `npm ci`.
3. Start the Express API with `npm start` (default port `3000`).
4. In `storefront-next/`, copy `.env.example` to `.env.local`, install dependencies, then run `npm run dev` (port `3001`).
5. Configure the Express `FRONTEND_ORIGIN` to the local Next.js origin for browser requests.

The current environment did not complete Next.js dependency installation, so a Next.js production build has not yet been verified. Express startup and SQLite schema migrations were smoke-tested with external provider/middleware modules stubbed; a full HTTP integration run with the real dependencies is still required.

## Implemented in this working milestone

- Shared metadata and exact FZR player-field contracts for the 10 approved launch categories.
- Dynamic checkout accepts category-specific `fields`, validates required fields and persists the exact field object per order item.
- Existing legacy `player_id` / `server_id` rows and requests remain supported.
- FZR status mapping distinguishes known pending, completed and failure/refund states; unknown values become `Review Required`.
- Raw FZR status, status history and failure reason are stored for order-item audit.
- Supplier price refresh now covers all 10 launch categories and imports newly seen FZR offers as unavailable until an admin sets a NGN price and activates them. Existing retail prices and availability are not overwritten by supplier sync.
- Customer-facing Next.js storefront starter with a custom WebGL GlassFold hero (plus reduced-motion and CSS fallbacks), responsive game/region catalogue, per-offer restriction labels, a multi-item cart, Paystack checkout hand-off, account sign-in, order view, profile editing, saved game accounts and wishlist.
- Customer profile supports name and phone edits; saved game accounts, wishlist, order history, coupon history and Hiro Coins wallet surfaces are connected to backend APIs.
- Coupon campaigns support percentage/fixed discounts, date windows, minimum spend, total/per-customer limits and category restrictions.
- Hiro Coins ledger, configurable earning/redemption rules, redemption reservations, checkout discounting, completion-based earning and refund/cancellation reversals. The programme defaults to disabled until an admin configures its rates.
- Admin console now supports all 10 catalogue categories and has a Promotions & Rewards workspace for coupon creation and Hiro Coins settings.

## Important rollout notes

- Do not point the new storefront at production until the backend and Next.js app have been installed, built and tested in staging.
- Do not enable Hiro Coins until the business owner configures the earning rate, naira value and redemption cap after reviewing margins.
- Newly imported supplier offers start unavailable with a zero NGN retail price. An admin must set the selling price and deliberately activate each offer.
- The new storefront uses `NEXT_PUBLIC_HIRO_API_BASE`; the API must allow its origin via `FRONTEND_ORIGIN`.
- The uploaded V1 package did not include a clean SQLite database backup or a complete database migration directory. Existing V1 schema setup remains in `server.js`; production data must be backed up and tested before any deployment migration.

## Tests

Run `npm test` for the unit tests covering FZR category fields, supplier status mapping, offer validation, rewards calculations and additive SQLite account/rewards schema. The suite currently contains 18 passing tests, including a simulated 165-offer import across the 10 approved categories.


## Further implementation notes

- See [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md) for what is implemented, verified and still unverified.
- See [`docs/DEPLOYMENT_PLAN.md`](docs/DEPLOYMENT_PLAN.md) for the staging, backup, regression and rollback sequence.

## Windows installation

See [`INSTALL-WINDOWS.md`](INSTALL-WINDOWS.md) for step-by-step local setup of the shared backend, customer storefront and admin dashboard.

## Admin design requirements

See [`docs/ADMIN_DESIGN_REQUIREMENTS.md`](docs/ADMIN_DESIGN_REQUIREMENTS.md). The admin uses a professional blue-primary / restrained-red-accent direction; the customer storefront retains its own separate visual identity.
