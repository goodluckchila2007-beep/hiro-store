require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const Database = require("better-sqlite3");
const bcrypt = require("bcrypt");
const session = require("express-session");

const app = express();
const PORT = 3000;

app.use(cors({
    origin: true,
    credentials: true
}));

app.use(express.json());

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,

    cookie: {
        httpOnly: true,
        secure: false,
        sameSite: "lax",
        maxAge: 1000 * 60 * 60 * 24 * 7
    }
}));

/* =========================================================
   PAYSTACK
========================================================= */

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

if (!PAYSTACK_SECRET_KEY) {
    console.error("ERROR: PAYSTACK_SECRET_KEY is missing from .env");
    process.exit(1);
}

/* =========================================================
   SQLITE
========================================================= */

const db = new Database("hiro-store.db");

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");


/* =========================================================
   CREATE ORDERS TABLE
========================================================= */

db.exec(`
    CREATE TABLE IF NOT EXISTS orders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        order_id TEXT UNIQUE NOT NULL,

        reference TEXT UNIQUE NOT NULL,

        email TEXT,

        phone TEXT,

        /*
           Original/general amount field.
           Stored in Paystack kobo for compatibility.
        */
        amount INTEGER NOT NULL DEFAULT 0,

        /*
           Customer's actual product total.
           Stored in NGN naira.
        */
        order_total INTEGER NOT NULL DEFAULT 0,

        /*
           Exact amount Paystack charged.
           Stored in kobo.
        */
        amount_charged INTEGER NOT NULL DEFAULT 0,

        currency TEXT DEFAULT 'NGN',

        status TEXT NOT NULL DEFAULT 'Paid',

        paid_at TEXT,

        created_at TEXT NOT NULL
    )
`);


/* =========================================================
   ADD NEW COLUMNS TO OLD DATABASES
========================================================= */

try {
    db.exec(`
        ALTER TABLE orders
        ADD COLUMN order_total INTEGER NOT NULL DEFAULT 0
    `);
} catch (error) {
    if (!error.message.includes("duplicate column name")) {
        throw error;
    }
}


try {
    db.exec(`
        ALTER TABLE orders
        ADD COLUMN amount_charged INTEGER NOT NULL DEFAULT 0
    `);
} catch (error) {
    if (!error.message.includes("duplicate column name")) {
        throw error;
    }
}

/* =========================================================
   ADD USER ID TO OLD ORDERS DATABASES
========================================================= */

try {

    db.exec(`
        ALTER TABLE orders
        ADD COLUMN user_id INTEGER
    `);

} catch (error) {

    if (!error.message.includes("duplicate column name")) {
        throw error;
    }

}

/* =========================================================
   CREATE ORDER ITEMS TABLE
========================================================= */

db.exec(`
    CREATE TABLE IF NOT EXISTS order_items (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        order_id TEXT NOT NULL,

        title TEXT NOT NULL,

        price INTEGER NOT NULL,

        quantity INTEGER NOT NULL,

        player_id TEXT,

        server_id TEXT,

        FOREIGN KEY (order_id)
            REFERENCES orders(order_id)
            ON DELETE CASCADE
    )
`);


console.log("SQLite database ready.");

/* =========================================================
   USERS — CUSTOMER ACCOUNTS
========================================================= */

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,

        name TEXT NOT NULL,

        email TEXT UNIQUE NOT NULL,

        phone TEXT,

        password_hash TEXT NOT NULL,

        role TEXT NOT NULL DEFAULT 'customer',

        created_at TEXT NOT NULL
    )
`);

console.log("Users table ready.");



/* =========================================================
   CUSTOMER COMPLAINTS
========================================================= */

db.exec(`
    CREATE TABLE IF NOT EXISTS complaints (

        id INTEGER PRIMARY KEY AUTOINCREMENT,

        user_id INTEGER NOT NULL,

        order_id TEXT NOT NULL,

        message TEXT NOT NULL,

        status TEXT NOT NULL DEFAULT 'Open',

        admin_response TEXT,

        refund_status TEXT NOT NULL DEFAULT 'Not Requested',

        created_at TEXT NOT NULL,

        updated_at TEXT NOT NULL,

        FOREIGN KEY (user_id)
            REFERENCES users(id)
            ON DELETE CASCADE,

        FOREIGN KEY (order_id)
            REFERENCES orders(order_id)
            ON DELETE CASCADE
    )
`);

console.log("Complaints table ready.");




/* =========================================================
   REPAIR OLD ORDERS
=========================================================

   Older orders may have:

       order_total = 0
       amount_charged = 0

   We repair them using:

       order_total = sum of purchased item prices × quantity

       amount_charged = old amount field

   The old `amount` field contains Paystack kobo.
========================================================= */

function repairOldOrders() {

    const oldOrders = db.prepare(`
        SELECT
            order_id,
            amount,
            order_total,
            amount_charged
        FROM orders
        WHERE
            order_total = 0
            OR amount_charged = 0
    `).all();


    const getItems = db.prepare(`
        SELECT
            price,
            quantity
        FROM order_items
        WHERE order_id = ?
    `);


    const updateOrder = db.prepare(`
        UPDATE orders
        SET
            order_total = ?,
            amount_charged = ?
        WHERE order_id = ?
    `);


    for (const order of oldOrders) {

        const items = getItems.all(order.order_id);


        const calculatedOrderTotal =
            items.reduce((sum, item) => {

                const price =
                    Number(item.price || 0);

                const quantity =
                    Number(item.quantity || 1);

                return sum + (price * quantity);

            }, 0);


        const existingCharged =
            Number(
                order.amount_charged ||
                order.amount ||
                0
            );


        updateOrder.run(
            calculatedOrderTotal,
            existingCharged,
            order.order_id
        );


        console.log(
            `Repaired order ${order.order_id}:`,
            `Order Total = ₦${calculatedOrderTotal.toLocaleString()}`,
            `Amount Charged = ₦${(existingCharged / 100).toLocaleString()}`
        );
    }
}


repairOldOrders();

/* =========================================================
   CUSTOMER SIGN UP
========================================================= */

app.post("/signup", async (req, res) => {

    try {

        const {
            name,
            email,
            phone,
            password
        } = req.body;


        /* =====================================================
           VALIDATE INPUT
        ===================================================== */

        const cleanName =
            String(name || "").trim();

        const cleanEmail =
            String(email || "").trim().toLowerCase();

        const cleanPhone =
            String(phone || "").trim();

        const cleanPassword =
            String(password || "");


        if (!cleanName) {

            return res.status(400).json({
                success: false,
                message: "Name is required."
            });

        }


        if (!cleanEmail) {

            return res.status(400).json({
                success: false,
                message: "Email is required."
            });

        }


        if (!cleanEmail.includes("@")) {

            return res.status(400).json({
                success: false,
                message: "Please enter a valid email address."
            });

        }


        if (cleanPassword.length < 8) {

            return res.status(400).json({
                success: false,
                message:
                    "Password must be at least 8 characters."
            });

        }


        /* =====================================================
           CHECK EXISTING ACCOUNT
        ===================================================== */

        const existingUser =
            db.prepare(`
                SELECT id
                FROM users
                WHERE email = ?
            `).get(cleanEmail);


        if (existingUser) {

            return res.status(409).json({
                success: false,
                message:
                    "An account with this email already exists."
            });

        }


        /* =====================================================
           HASH PASSWORD
        ===================================================== */

        const passwordHash =
            await bcrypt.hash(
                cleanPassword,
                12
            );


        /* =====================================================
           CREATE USER
        ===================================================== */

        const createdAt =
            new Date().toISOString();


        const result =
            db.prepare(`
                INSERT INTO users (
                    name,
                    email,
                    phone,
                    password_hash,
                    role,
                    created_at
                )
                VALUES (
                    @name,
                    @email,
                    @phone,
                    @password_hash,
                    @role,
                    @created_at
                )
            `).run({

                name:
                    cleanName,

                email:
                    cleanEmail,

                phone:
                    cleanPhone,

                password_hash:
                    passwordHash,

                role:
                    "customer",

                created_at:
                    createdAt

            });


        console.log(
            `New customer account created: ${cleanEmail}`
        );


        /* =====================================================
           RETURN SAFE USER DATA
           
           NEVER send password_hash back to browser.
        ===================================================== */

        return res.status(201).json({

            success: true,

            message:
                "Account created successfully.",

            user: {

                id:
                    result.lastInsertRowid,

                name:
                    cleanName,

                email:
                    cleanEmail,

                phone:
                    cleanPhone,

                role:
                    "customer",

                createdAt:
                    createdAt

            }

        });


    } catch (error) {

        console.error(
            "Signup error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to create account."

        });

    }

});

/* =========================================================
   CUSTOMER LOGIN
========================================================= */

app.post("/login", async (req, res) => {

    try {

        const {
            email,
            password
        } = req.body;


        const cleanEmail =
            String(email || "")
                .trim()
                .toLowerCase();

        const cleanPassword =
            String(password || "");


        /* =====================================================
           VALIDATE INPUT
        ===================================================== */

        if (!cleanEmail || !cleanPassword) {

            return res.status(400).json({
                success: false,
                message: "Email and password are required."
            });

        }


        /* =====================================================
           FIND USER
        ===================================================== */

        const user =
            db.prepare(`
                SELECT
                    id,
                    name,
                    email,
                    phone,
                    password_hash,
                    role,
                    created_at
                FROM users
                WHERE email = ?
            `).get(cleanEmail);


        /* =====================================================
           DON'T REVEAL WHETHER EMAIL EXISTS
        ===================================================== */

        if (!user) {

            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });

        }


        /* =====================================================
           CHECK PASSWORD
        ===================================================== */

        const passwordCorrect =
            await bcrypt.compare(
                cleanPassword,
                user.password_hash
            );


        if (!passwordCorrect) {

            return res.status(401).json({
                success: false,
                message: "Invalid email or password."
            });

        }


        /* =====================================================
           SUCCESS
           
           IMPORTANT:
           password_hash is NEVER returned.
        ===================================================== */

        /* =====================================================
    CREATE LOGIN SESSION
 ===================================================== */

        req.session.userId = user.id;
        req.session.userRole = user.role;


        /* =====================================================
           SAVE SESSION
        ===================================================== */

        req.session.save((sessionError) => {

            if (sessionError) {

                console.error(
                    "Could not save login session:",
                    sessionError
                );

                return res.status(500).json({

                    success: false,

                    message:
                        "Unable to create login session."

                });
            }


            console.log(
                `Customer logged in: ${user.email}`
            );


            return res.json({

                success: true,

                message:
                    "Login successful.",

                user: {

                    id:
                        user.id,

                    name:
                        user.name,

                    email:
                        user.email,

                    phone:
                        user.phone,

                    role:
                        user.role,

                    createdAt:
                        user.created_at

                }

            });

        });


    } catch (error) {

        console.error(
            "Login error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to log in."

        });

    }

});

/* =========================================================
   GET CURRENT CUSTOMER
========================================================= */

app.get("/me", requireLogin, (req, res) => {

    try {

        if (!req.session.userId) {

            return res.status(401).json({

                success: false,

                authenticated: false,

                message:
                    "Not logged in."

            });

        }


        const user =
            db.prepare(`
                SELECT
                    id,
                    name,
                    email,
                    phone,
                    role,
                    created_at
                FROM users
                WHERE id = ?
            `).get(
                req.session.userId
            );


        if (!user) {

            req.session.destroy(() => { });

            return res.status(401).json({

                success: false,

                authenticated: false,

                message:
                    "Account no longer exists."

            });

        }


        return res.json({

            success: true,

            authenticated: true,

            user: {

                id:
                    user.id,

                name:
                    user.name,

                email:
                    user.email,

                phone:
                    user.phone,

                role:
                    user.role,

                createdAt:
                    user.created_at

            }

        });


    } catch (error) {

        console.error(
            "Could not get current user:",
            error
        );

        return res.status(500).json({

            success: false,

            message:
                "Unable to check login status."

        });

    }

});

/* =========================================================
   CUSTOMER LOGOUT
========================================================= */

app.post("/logout", (req, res) => {

    req.session.destroy((error) => {

        if (error) {

            console.error(
                "Logout error:",
                error
            );

            return res.status(500).json({

                success: false,

                message:
                    "Unable to log out."

            });

        }


        res.clearCookie("connect.sid");


        return res.json({

            success: true,

            message:
                "Logged out successfully."

        });

    });

});

/* =========================================================
   REQUIRE CUSTOMER LOGIN
========================================================= */

function requireLogin(req, res, next) {

    if (!req.session.userId) {

        return res.status(401).json({

            success: false,

            message:
                "You must be logged in to access this."

        });

    }

    next();
}

/* =========================================================
   CUSTOMER SUBMIT COMPLAINT
========================================================= */

app.post("/complaints", requireLogin, (req, res) => {

    try {

        const {
            orderId,
            message
        } = req.body;


        /* =====================================================
           VALIDATE INPUT
        ===================================================== */

        const cleanOrderId =
            String(orderId || "").trim();

        const cleanMessage =
            String(message || "").trim();


        if (!cleanOrderId) {

            return res.status(400).json({

                success: false,

                message:
                    "Order ID is required."

            });

        }


        if (!cleanMessage) {

            return res.status(400).json({

                success: false,

                message:
                    "Please describe your complaint."

            });

        }


        if (cleanMessage.length < 10) {

            return res.status(400).json({

                success: false,

                message:
                    "Please provide more details about the problem."

            });

        }


        /* =====================================================
           FIND ORDER
        ===================================================== */

        const order =
            db.prepare(`
                SELECT
                    order_id,
                    user_id,
                    status
                FROM orders
                WHERE order_id = ?
            `).get(cleanOrderId);


        if (!order) {

            return res.status(404).json({

                success: false,

                message:
                    "Order not found."

            });

        }


        /* =====================================================
           MAKE SURE ORDER BELONGS TO CUSTOMER
        ===================================================== */

        if (
            Number(order.user_id) !==
            Number(req.session.userId)
        ) {

            return res.status(403).json({

                success: false,

                message:
                    "You can only complain about your own orders."

            });

        }


        /* =====================================================
           ONLY FAILED/CANCELLED ORDERS CAN BE REPORTED
        ===================================================== */

        const allowedStatuses = [
            "Failed",
            "Cancelled"
        ];


        if (
            !allowedStatuses.includes(order.status)
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "A complaint can only be submitted for a failed or cancelled order."

            });

        }


        /* =====================================================
           PREVENT DUPLICATE OPEN COMPLAINTS
        ===================================================== */

        const existingComplaint =
            db.prepare(`
                SELECT
                    id
                FROM complaints
                WHERE
                    user_id = ?
                    AND order_id = ?
                    AND status = 'Open'
            `).get(
                req.session.userId,
                cleanOrderId
            );


        if (existingComplaint) {

            return res.status(409).json({

                success: false,

                message:
                    "You already have an open complaint for this order."

            });

        }


        /* =====================================================
           CREATE COMPLAINT
        ===================================================== */

        const now =
            new Date().toISOString();


        const result =
            db.prepare(`
                INSERT INTO complaints (

                    user_id,

                    order_id,

                    message,

                    status,

                    admin_response,

                    refund_status,

                    created_at,

                    updated_at

                )

                VALUES (

                    @user_id,

                    @order_id,

                    @message,

                    @status,

                    @admin_response,

                    @refund_status,

                    @created_at,

                    @updated_at

                )
            `).run({

                user_id:
                    req.session.userId,

                order_id:
                    cleanOrderId,

                message:
                    cleanMessage,

                status:
                    "Open",

                admin_response:
                    null,

                refund_status:
                    "Not Requested",

                created_at:
                    now,

                updated_at:
                    now

            });


        console.log(
            `Complaint created: #${result.lastInsertRowid} for ${cleanOrderId}`
        );


        return res.status(201).json({

            success: true,

            message:
                "Complaint submitted successfully.",

            complaint: {

                id:
                    result.lastInsertRowid,

                orderId:
                    cleanOrderId,

                message:
                    cleanMessage,

                status:
                    "Open",

                refundStatus:
                    "Not Requested",

                createdAt:
                    now

            }

        });


    } catch (error) {

        console.error(
            "Complaint submission error:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to submit complaint."

        });

    }

});

/* =========================================================
   GET CUSTOMER COMPLAINTS
========================================================= */

app.get("/complaints", requireLogin, (req, res) => {

    try {

        const complaints =
            db.prepare(`
                SELECT
                    id,
                    order_id,
                    message,
                    status,
                    admin_response,
                    refund_status,
                    created_at,
                    updated_at
                FROM complaints
                WHERE user_id = ?
                ORDER BY created_at DESC
            `).all(
                req.session.userId
            );


        return res.json({

            success: true,

            complaints: complaints.map(complaint => ({

                id:
                    complaint.id,

                orderId:
                    complaint.order_id,

                message:
                    complaint.message,

                status:
                    complaint.status,

                adminResponse:
                    complaint.admin_response,

                refundStatus:
                    complaint.refund_status,

                createdAt:
                    complaint.created_at,

                updatedAt:
                    complaint.updated_at

            }))

        });


    } catch (error) {

        console.error(
            "Could not load customer complaints:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to load complaints."

        });

    }

});

/* =========================================================
   HOME
========================================================= */

app.get("/", (req, res) => {

    res.json({
        success: true,
        message: "Hiro Store payment server is running."
    });

});


/* =========================================================
   VERIFY PAYMENT
========================================================= */

app.post("/verify-payment", async (req, res) => {

    const {
        reference,
        items = []
    } = req.body;


    if (!reference) {

        return res.status(400).json({
            success: false,
            message: "No payment reference supplied."
        });

    }


    try {

        /* =====================================================
           ASK PAYSTACK TO VERIFY PAYMENT
        ===================================================== */

        const response = await axios.get(

            `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,

            {
                headers: {
                    Authorization:
                        `Bearer ${PAYSTACK_SECRET_KEY}`
                }
            }

        );


        const payment =
            response.data.data;


        /* =====================================================
           PAYMENT MUST BE SUCCESSFUL
        ===================================================== */

        if (payment.status !== "success") {

            return res.status(400).json({

                success: false,

                message:
                    "Payment was not successful.",

                payment

            });

        }

        /* =====================================================
          GET LOGGED-IN USER
===================================================== */

        const userId =
            req.session.userId || null;

        /* =====================================================
           PAYSTACK AMOUNT
        =====================================================

           Paystack gives amount in KOBO.

           Example:

               121828 kobo
               = ₦1,218.28

        ===================================================== */

        const amountChargedKobo =
            Number(payment.amount || 0);


        /* =====================================================
           CALCULATE PRODUCT ORDER TOTAL
        =====================================================

           Example:

               1200 × 1
               = ₦1,200

        ===================================================== */

        const cleanItems =
            Array.isArray(items)
                ? items
                : [];


        const orderTotal =
            cleanItems.reduce(
                (sum, item) => {

                    const price =
                        Number(item.price || 0);

                    const quantity =
                        Number(item.qty || 1);

                    return sum +
                        (price * quantity);

                },
                0
            );


        /* =====================================================
           CUSTOMER INFORMATION
        ===================================================== */

        const email =
            payment.customer?.email || "";


        const phone =
            payment.metadata?.phone ||
            payment.customer?.phone ||
            "";


        const currency =
            payment.currency ||
            "NGN";


        const paidAt =
            payment.paid_at ||
            payment.transaction_date ||
            new Date().toISOString();


        const createdAt =
            new Date().toISOString();


        /* =====================================================
           CHECK FOR DUPLICATE PAYMENT
        ===================================================== */

        const existingOrder =
            db.prepare(`
                SELECT *
                FROM orders
                WHERE reference = ?
            `).get(reference);


        if (existingOrder) {

            const existingItems =
                db.prepare(`
                    SELECT *
                    FROM order_items
                    WHERE order_id = ?
                    ORDER BY id ASC
                `).all(
                    existingOrder.order_id
                );


            return res.json({

                success: true,

                message:
                    "Payment already verified.",

                payment,

                order: {

                    orderId:
                        existingOrder.order_id,

                    reference:
                        existingOrder.reference,

                    status:
                        existingOrder.status,

                    orderTotal:
                        existingOrder.order_total,

                    amountCharged:
                        existingOrder.amount_charged / 100,

                    items:
                        existingItems.map(item => ({

                            title:
                                item.title,

                            price:
                                item.price,

                            qty:
                                item.quantity,

                            playerId:
                                item.player_id,

                            serverId:
                                item.server_id

                        }))

                }

            });

        }


        /* =====================================================
           CREATE ORDER ID
        ===================================================== */

        const orderId =
            "HIRO-" + Date.now();


        /* =====================================================
           SAVE ORDER + ITEMS
        ===================================================== */

        const saveOrder =
            db.transaction(() => {


                /* =================================================
                   SAVE MAIN ORDER
                ================================================= */

                db.prepare(`
                    INSERT INTO orders (
                        order_id,

                        reference,

                        user_id,

                        email,

                        phone,

                        amount,

                        order_total,

                        amount_charged,

                        currency,

                        status,

                        paid_at,

                        created_at
                    )
                    VALUES (
                        @order_id,

                        @reference,

                        @user_id,

                        @email,

                        @phone,

                        @amount,

                        @order_total,

                        @amount_charged,

                        @currency,

                        @status,

                        @paid_at,

                        @created_at
                    )
                `).run({

                    order_id:
                        orderId,

                    reference:
                        reference,

                    user_id:
                        userId,

                    email:
                        email,

                    phone:
                        phone,

                    /*
                       Keep old amount field compatible.
                       It stores Paystack kobo.
                    */
                    amount:
                        amountChargedKobo,

                    /*
                       Product total in NGN.
                    */
                    order_total:
                        orderTotal,

                    /*
                       Exact Paystack charge in kobo.
                    */
                    amount_charged:
                        amountChargedKobo,

                    currency:
                        currency,

                    status:
                        "Paid",

                    paid_at:
                        paidAt,

                    created_at:
                        createdAt

                });


                /* =================================================
                   SAVE EVERY PURCHASED ITEM
                ================================================= */

                const insertItem =
                    db.prepare(`

                        INSERT INTO order_items (

                            order_id,

                            title,

                            price,

                            quantity,

                            player_id,

                            server_id

                        )

                        VALUES (

                            @order_id,

                            @title,

                            @price,

                            @quantity,

                            @player_id,

                            @server_id

                        )

                    `);


                for (const item of cleanItems) {

                    insertItem.run({

                        order_id:
                            orderId,

                        title:
                            String(
                                item.title ||
                                "Unknown Package"
                            ),

                        price:
                            Number(
                                item.price ||
                                0
                            ),

                        quantity:
                            Number(
                                item.qty ||
                                1
                            ),

                        player_id:
                            String(
                                item.playerId ||
                                ""
                            ),

                        server_id:
                            String(
                                item.serverId ||
                                ""
                            )

                    });

                }

            });


        saveOrder();


        console.log(
            "Order saved to SQLite:",
            orderId
        );


        console.log(
            "Order Total:",
            `₦${orderTotal.toLocaleString()}`
        );


        console.log(
            "Amount Charged:",
            `₦${(amountChargedKobo / 100).toLocaleString(
                undefined,
                {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2
                }
            )}`
        );


        /* =====================================================
           RETURN SUCCESS
        ===================================================== */

        return res.json({

            success: true,

            message:
                "Payment verified successfully.",

            payment,

            order: {

                orderId:
                    orderId,

                reference:
                    reference,

                status:
                    "Paid",

                orderTotal:
                    orderTotal,

                amountCharged:
                    amountChargedKobo / 100,

                items:
                    cleanItems

            }

        });


    } catch (error) {

        console.error(
            "Paystack verification error:",
            error.response?.data ||
            error.message
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to verify payment."

        });

    }

});


/* =========================================================
   GET ORDER HISTORY
========================================================= */

app.get("/orders", (req, res) => {

    try {

        const currentUser =
            db.prepare(`
        SELECT email
        FROM users
        WHERE id = ?
    `).get(req.session.userId);


        if (!currentUser) {

            return res.status(401).json({

                success: false,

                message:
                    "User account not found."

            });

        }


        const orders =
            db.prepare(`
        SELECT
            *
        FROM orders
        WHERE user_id = ?
        ORDER BY created_at DESC
        `)
                .all(
                    req.session.userId
                );

        const getItems =
            db.prepare(`

                SELECT

                    id,

                    title,

                    price,

                    quantity,

                    player_id,

                    server_id

                FROM order_items

                WHERE order_id = ?

                ORDER BY id ASC

            `);


        const result =
            orders.map(order => {

                const items =
                    getItems.all(
                        order.order_id
                    );


                /*
                   If old order data somehow still has
                   zero order_total, calculate it from items.
                */

                let orderTotal =
                    Number(
                        order.order_total || 0
                    );


                if (
                    orderTotal === 0 &&
                    items.length
                ) {

                    orderTotal =
                        items.reduce(
                            (sum, item) =>
                                sum +
                                (
                                    Number(
                                        item.price || 0
                                    ) *
                                    Number(
                                        item.quantity || 1
                                    )
                                ),
                            0
                        );

                }


                const amountChargedKobo =
                    Number(
                        order.amount_charged ||
                        order.amount ||
                        0
                    );


                return {

                    orderId:
                        order.order_id,

                    reference:
                        order.reference,

                    email:
                        order.email,

                    phone:
                        order.phone,

                    /*
                       Keep amount for compatibility.
                       This is now returned in NGN.
                    */
                    amount:
                        amountChargedKobo / 100,

                    orderTotal:
                        orderTotal,

                    amountCharged:
                        amountChargedKobo / 100,

                    currency:
                        order.currency,

                    status:
                        order.status,

                    paidAt:
                        order.paid_at,

                    createdAt:
                        order.created_at,

                    items:
                        items.map(item => ({

                            title:
                                item.title,

                            price:
                                item.price,

                            qty:
                                item.quantity,

                            playerId:
                                item.player_id,

                            serverId:
                                item.server_id

                        }))

                };

            });


        return res.json({

            success: true,

            orders:
                result

        });


    } catch (error) {

        console.error(
            "Could not load orders:",
            error
        );


        return res.status(500).json({

            success: false,

            message:
                "Unable to load order history."

        });

    }

});


/* =========================================================
   UPDATE ORDER STATUS
========================================================= */

app.patch(
    "/orders/:orderId/status",
    (req, res) => {

        try {

            const {
                orderId
            } = req.params;


            const {
                status
            } = req.body;


            const allowedStatuses = [
                "Paid",
                "Processing",
                "Completed",
                "Cancelled"
            ];


            if (
                !allowedStatuses.includes(status)
            ) {

                return res.status(400).json({

                    success: false,

                    message:
                        "Invalid order status."

                });

            }


            const existingOrder =
                db.prepare(`
                    SELECT *
                    FROM orders
                    WHERE order_id = ?
                `).get(orderId);


            if (!existingOrder) {

                return res.status(404).json({

                    success: false,

                    message:
                        "Order not found."

                });

            }


            db.prepare(`
                UPDATE orders
                SET status = ?
                WHERE order_id = ?
            `).run(
                status,
                orderId
            );


            const updatedOrder =
                db.prepare(`
                    SELECT *
                    FROM orders
                    WHERE order_id = ?
                `).get(orderId);


            console.log(
                `Order ${orderId} marked ${status}.`
            );


            return res.json({

                success: true,

                message:
                    `Order marked ${status}.`,

                order: {

                    orderId:
                        updatedOrder.order_id,

                    status:
                        updatedOrder.status

                }

            });


        } catch (error) {

            console.error(
                "Could not update order status:",
                error
            );


            return res.status(500).json({

                success: false,

                message:
                    "Unable to update order status."

            });

        }

    }
);


/* =========================================================
   START SERVER
========================================================= */

app.listen(
    PORT,
    () => {

        console.log(
            `Server running on http://localhost:${PORT}`
        );

    }
);
