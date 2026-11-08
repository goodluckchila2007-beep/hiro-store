# Hiro Store 2.0 — Staging and Cutover Plan

## 1. Keep production untouched while preparing staging

- Create a full SQLite backup using SQLite's online backup API or a clean stopped-service copy of the database plus its WAL state.
- Verify the backup by restoring it into a separate staging database and checking user, order, order-item, product, support-conversation and support-message counts.
- Clone the current VPS application into a separate staging directory; do not replace `/var/www/hiro-store` yet.
- Install backend dependencies from the root lockfile and Next.js dependencies from `storefront-next/package.json` in a network-enabled build environment.
- Configure test-only Paystack credentials and the existing FZR API key in the staging environment. Never copy production secrets into a build artifact.

## 2. Build and route the two applications

- Express remains the backend and continues to own authentication, sessions, SQLite, Paystack, FZR, order lifecycle and support routes.
- Run the Next.js customer storefront on port `3001` during staging.
- Keep Express on its existing API port (default `3000` in this working copy).
- Configure `NEXT_PUBLIC_HIRO_API_BASE` to the same public origin or reverse-proxy path used by the storefront. Configure `FRONTEND_ORIGIN` to the storefront origin when cross-origin requests are used.
- Preserve the existing admin entry point and Express static support/policy pages during the first staged cutover.
- Configure the reverse proxy so the customer `/` and Next.js routes go to Next, while `/api`, `/csrf-token`, `/login`, `/signup`, `/logout`, `/verify-payment`, and existing static account/support pages continue to reach Express as required.

## 3. Apply migrations only to a restored staging database

- Start the Express application against the restored staging DB and inspect startup logs.
- Confirm existing users, orders, order items, products and support records are unchanged in count and content.
- Confirm the new saved-game-account, wishlist, coupon, coin-reservation and coin-transaction tables are created.
- Confirm new product metadata columns and order reward/status columns are added without replacing existing values.

## 4. Catalogue and pricing setup

- Sign in to the staging admin and run **Sync FZR catalogue**.
- Confirm the selected 10 categories and expected offer counts: 24 Blood Strike, 7 Genshin, 7 Honkai: Star Rail, 6 Marvel Rivals, 42 MLBB Global, 17 MLBB PH, 23 MLBB ID, 20 MLBB MY, 10 Lords Mobile and 9 CODM India (165 total).
- Review offer names, supplier USD costs, category/offer restrictions and field requirements.
- Set NGN selling prices using the approved margin strategy; newly imported offers are intentionally unavailable until priced and activated.
- Confirm MLBB Global offer-level restrictions and the CODM India / Activision-not-Garena warning.

## 5. Staging regression tests

- Customer sign-up, email verification, sign-in, logout, profile update and password recovery.
- MLBB Player ID/Zone ID validation for each enabled MLBB region; checkout must block if validation is absent or no longer matches the entered IDs.
- Genshin/HSR server selectors; CODM `user_id`; other categories' exact FZR fields.
- One offer, multiple offers and quantity greater than one. Confirm each purchased unit creates one separate order-item row.
- Paystack success, failed initialization, duplicate webhook, verification retry, wrong amount/currency/reference and delayed webhook.
- FZR success, processing, refund, timeout, unknown status, polling retry and manual review. Confirm no duplicate FZR submission after an ambiguous timeout.
- Coupon percentage/fixed discounts, category restrictions, date limits, usage caps, reservation, cancellation and refund reversal.
- Hiro Coins disabled by default; after rates are configured, test earn after all units complete, redeem caps, coupon stacking policy and refund reversal.
- Saved game accounts, wishlist, customer order history and support conversations.
- Admin category pricing, availability, FZR sync, coupon campaigns, Hiro Coins settings, order detail/status history and support inbox search.
- Mobile and desktop layouts, keyboard navigation, reduced-motion mode and accessibility checks.

## 6. Controlled cutover and rollback

- Only after staging sign-off, create another verified production backup.
- Deploy the built Next.js app and additive backend files alongside the existing V1 deployment.
- Change the reverse proxy in a controlled window; do not overwrite the production SQLite database.
- Keep the old V1 frontend bundle and proxy configuration available for immediate rollback.
- Monitor Paystack verification, FZR submissions, pending/ambiguous orders, refunds, support inbox and error logs after cutover.
- If payment or fulfilment behaviour regresses, route traffic back to V1 while retaining the database backup and investigating the staged build.

**No production deployment is performed by this working-copy package.**
