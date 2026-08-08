# Hiro Store

A full-stack digital goods e-commerce platform built for selling game top-ups and digital products.

## 🚀 Overview

Hiro Store is a web-based digital store that allows customers to:

- Create an account
- Log in securely
- Browse digital products
- Enter and verify game player information
- Make payments through Paystack
- View their order history
- Track order information

The backend uses Node.js and Express, with SQLite for persistent data storage.

## ✨ Features

### Customer Accounts
- Customer registration
- Secure password hashing with bcrypt
- Customer login
- Session-based authentication
- Logout
- Current-user authentication checks

### Payments
- Paystack payment verification
- Payment reference verification
- Payment amount tracking
- Transaction status handling
- Duplicate payment protection

### Orders
- Automatic order creation after successful payment verification
- Order items stored separately
- Player ID and server ID storage
- Order history
- Order status management
- Order totals and payment amounts

### Game Top-Up Integration

The platform is designed to integrate with third-party game top-up APIs for automated fulfillment.

The intended flow is:

1. Customer selects a product
2. Customer enters game account information
3. Player information is validated
4. Customer completes payment
5. Payment is verified
6. The top-up provider receives the order
7. The customer receives the purchased digital product

## 🛠️ Tech Stack

### Frontend
- HTML
- CSS
- JavaScript

### Backend
- Node.js
- Express.js

### Database
- SQLite
- better-sqlite3

### Authentication
- express-session
- bcrypt

### Payments
- Paystack API

### HTTP/API
- Axios

## 📁 Project Structure

```text
hiro-store/
│
├── admin/
│   ├── admin.css
│   ├── admin.js
│   └── index.html
│
├── img/
│   └── Store images and assets
│
├── server/
│   └── server.js
│
├── app.js
├── index.html
├── style.css
├── .gitignore
└── README.md