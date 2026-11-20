# Hiro Store

Hiro Store is a digital-goods storefront for game top-ups and related products. Customers can create accounts, browse products, validate player details, pay through Paystack, and track orders.

## Stack

- **Frontend:** HTML, CSS and browser JavaScript
- **Backend:** Node.js and Express
- **Database:** SQLite with better-sqlite3
- **Authentication:** express-session and bcrypt
- **Payments:** Paystack
- **Supplier fulfillment:** FZR Cards API

## Project structure

```text
hiro-store/
├── server.js                 # Application composition root and startup
├── hiro-finance.js            # Paystack fee and supplier-cost accounting
├── src/
│   ├── database.js            # SQLite connection, schema and store defaults
│   ├── services/
│   │   └── fzr.js             # Player validation, top-ups and supplier polling
│   └── routes/
│       ├── auth.js            # Signup, login, profile and password recovery
│       ├── support.js         # Complaints and support conversations
│       ├── store.js           # Public store, checkout and payment verification
│       ├── orders.js          # Customer order history and order endpoints
│       ├── reconciliation.js  # Unmatched Paystack payment recovery
│       ├── admin.js           # Admin route-module composer
│       ├── admin-settings.js  # Store settings and system status
│       ├── admin-fulfillment.js
│       ├── admin-analytics.js
│       └── admin-management.js
└── public/
    ├── css/
    │   └── pages/             # Page-specific stylesheets
    ├── img/                   # Store images and assets
    ├── index.html             # Customer storefront
    ├── admin.html             # Admin dashboard
    └── ...
```

## Run locally

1. Install dependencies with `npm install`.
2. Configure the required environment variables in your local `.env` file.
3. Start the application with `npm start`.
4. Run the JavaScript syntax checks with `npm test`.

Do not commit `.env`, database files, API keys, or session secrets.

## Important payment and fulfillment behaviour

- Paystack webhook signatures and payment amounts are verified server-side.
- Orders are only marked paid after a verified payment.
- Supplier fulfillment is handled separately from payment verification.
- Unmatched successful payments can be reviewed and recovered by an administrator.
- Keep the payment and fulfillment flows covered by behavioural tests before deploying structural changes to production.
