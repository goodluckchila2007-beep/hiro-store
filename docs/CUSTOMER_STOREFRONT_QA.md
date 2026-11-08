# Hiro Store 2.0 — Customer storefront verification handoff

This is the current customer-side working copy. The existing Express/SQLite backend remains the system of record for accounts, products, order creation, Paystack verification, FZR fulfilment and support.

## Verified in this environment

- Backend and existing JavaScript syntax checks pass.
- All 8 storefront TypeScript/TSX source files transpile without syntax diagnostics.
- 12 dependency-independent tests pass.
- The customer UI contains all 10 configured game/region categories and renders the category-specific fields supplied by the shared catalogue.
- Checkout submits offer IDs, category IDs, quantities and account fields; the backend reloads prices and availability from SQLite rather than trusting browser prices.
- The backend preserves the one-order-item-per-unit fulfilment approach and category-specific account fields.
- Help & Support links to the existing Express support centre using the configured API base URL.

## Still required before calling the customer storefront complete

1. Install the root and `storefront-next` dependencies in a network-enabled environment.
2. Run the complete SQLite-backed test suite and resolve any failures.
3. Run `npm run lint` and `npm run build` in `storefront-next`.
4. Start the backend against a restored staging database and run the Next.js storefront against it.
5. Verify account creation, email verification, login/logout, saved game accounts, wishlist, coupons and order history.
6. Verify all 10 categories against live staging catalogue data; never invent prices or availability.
7. Verify MLBB account validation, all other game-specific fields, multi-item carts and quantity greater than one.
8. Use Paystack test credentials only to verify success, cancellation and delayed verification; test FZR fulfilment only in staging.
9. Check desktop/mobile layout, keyboard operation and accessibility.

## Safety boundary

No production site, production database, live Paystack payment or live FZR order was changed or tested. Do not deploy this working copy until the staging checklist and backup/rollback plan are completed.

## Next phase

Only after the customer storefront passes the staging checks, continue with the admin interface and its role/security, catalogue, order, FZR sync, support, promotions and rewards workflows. Keep the admin implementation separate from customer-facing navigation and styling.
