# Hiro Store 2.0 — Implementation Status

**Working-copy status:** first implementation milestone completed; staging verification and production cutover are not complete.

## Completed in the working copy

### Backend and FZR
- Added a single approved catalogue definition for the 10 selected FZR categories and their exact required field keys.
- Removed the old assumption that every FZR order needs `player_id` plus `server_id`.
- Checkout now accepts category-specific `fields`, stores the exact object on each order item, and reuses it for fulfilment retries and status polling.
- Preserved legacy V1 player/server fields for existing MLBB order records.
- Preserved MLBB account validation and added it to the new storefront checkout. The player/server pair must still match a successful validation before MLBB checkout.
- Preserved the one-row-per-unit fulfilment design: a quantity of three creates three order-item rows with quantity one.
- Added supplier status, failure reason and status-history persistence. Unknown FZR statuses are marked `Review Required` instead of being silently treated as ordinary processing.
- FZR price sync covers all 10 approved categories. New supplier offers are imported as unavailable with a zero NGN selling price. Existing admin selling prices and availability are not overwritten by supplier refresh.
- Added an explicit admin FZR catalogue sync action. The sync reports category-level failures and retains the last known catalogue and supplier prices when FZR is unavailable.
- Added per-offer MLBB Global restriction text using displayed offer denomination/name matching rather than guessed offer IDs.

### Customer storefront and account
- Added a separate Next.js App Router storefront source tree in `storefront-next/`.
- Added a responsive dark Hiro Store identity, animated hero, custom WebGL GlassFold-style shader component, CSS fallback panels, and reduced-motion handling.
- Added all 10 selected game/region cards with visible restrictions, search, offer cards and a multi-item cart.
- Added category-specific checkout fields, saved game account selection, MLBB validation, Paystack access-code hand-off and order verification.
- Guest carts and player fields are held in session storage while the customer signs in.
- Added customer account sections for overview, orders, profile editing, saved game accounts, wishlist, Hiro Coins, coupons and support access.
- Added backend endpoints for saved game accounts and wishlist items.
- Added a CSRF-aware frontend API client for mutating requests.

### Coupons and Hiro Coins
- Added coupon campaigns with fixed or percentage discounts, start/end dates, minimum spend, maximum discount, total/per-customer usage limits and category restrictions.
- Coupon reservations are associated with pending orders, committed after successful payment and released on cancellation/expiry/refund.
- Added a Hiro Coins transaction ledger, checkout reservations, configurable earning and redemption, completion-based earning and refund/cancellation reversals.
- Coin earning rate, naira value, redemption cap and coupon stacking are admin-configurable. The programme defaults to disabled; no conversion rate has been invented.
- Added customer rewards wallet APIs and admin campaign/settings controls.

### Admin and support
- Expanded admin product management to the 10 approved categories.
- Added supplier region/restriction notes to product administration.
- Improved the catalogue pricing workspace with per-category offer counts, active/priced and unpriced/unavailable summaries, offer-ID search, status filters, estimated supplier cost, estimated profit and margin beside each selling-price editor.
- Admin API now rejects activation when an offer has no positive NGN selling price, and validates whole-number prices within a safe upper bound.
- Added Promotions & Rewards admin workspace.
- Added FZR catalogue sync control.
- Added search and status filters to the existing support inbox without replacing its conversation/message system or changing its data model.
- Applied a blue/red admin accent direction while keeping it separate from the customer storefront identity.

## Verification completed (latest working-copy check)

- `node --check server.js` and syntax checks for the supplied public, library and test JavaScript files passed.
- TypeScript transpilation syntax checks passed for all 8 storefront `.ts` / `.tsx` source files. This is a syntax check, not a full type-check or Next.js production build.
- 12 dependency-independent tests passed, covering the 10-category catalogue, category-specific account fields, unknown-category rejection, supplier status handling, MLBB Global restrictions, checkout reward calculations and local payment-fee bounds.
- The full `npm test` command is currently blocked in this environment: 3 SQLite-backed test files cannot load `better-sqlite3` because the native dependency is not installed. Do not describe the full suite as passing until it is rerun with dependencies installed.
- Express startup and SQLite schema smoke test completed in the earlier working-copy pass with external provider modules stubbed.

## Not yet verified — do not treat as production-ready

- A real `next build` has not run. Installing Next.js dependencies timed out in this environment, so the storefront still needs dependency installation and a full build in a network-enabled environment.
- The full Express HTTP runtime has not been tested with the actual dependency set in this environment; the startup smoke test used stubs for network/provider and middleware modules.
- No live FZR API request was made. The 165 offers are imported by the runtime sync action using the configured FZR API key; the working copy does not contain a fabricated price list.
- No Paystack sandbox payment or real webhook was run. Use test credentials and a staging callback URL before rollout.
- The supplied project did not include a clean current SQLite database backup. Additive migrations have been smoke-tested against a V1-shaped test database, not the production database.
- Support conversation tables are queried by the existing V1 code but their `CREATE TABLE` statements were not present in the supplied source bundle. They were intentionally not recreated or altered because the live chat system is known to work.
- The original V1 domain/VPS reverse-proxy configuration has not been changed. A staging route for Next.js on port 3001 and the Express API must be prepared before cutover.
- Hiro Coins remains disabled until the owner chooses earning and redemption values after reviewing contribution margins.
- Newly imported FZR offers remain unavailable until an admin sets the NGN retail price and activates them.

## Production safety

No live website, VPS, production database, Paystack account, or FZR account was changed by this working-copy implementation. The original supplied V1 files remain the baseline in this project package. Do not deploy over the live project without a verified database backup, staging regression run and explicit production cutover approval.
