"use strict";

/** Register the auth HTTP endpoints. Dependencies are supplied by the server composition root. */
module.exports = function registerAuthRoutes(context) {
    const {
        path,
        express,
        cors,
        axios,
        Database,
        bcrypt,
        session,
        helmet,
        rateLimit,
        SqliteStore,
        crypto,
        nodemailer,
        smtpStatus,
        app,
        PORT,
        FZR_EXCHANGE_RATE,
        FRONTEND_ORIGIN,
        isProduction,
        logger,
        sessionDb,
        CSRF_EXEMPT,
        authLimiter,
        passwordResetLimiter,
        paymentLimiter,
        apiLimiter,
        mailTransporter,
        sendAdminNotification,
        PAYSTACK_SECRET_KEY,
        db,
        orderItemColumns,
        addOrderItemColumn,
        getSetting,
        setSetting,
        repairOldOrders,
        FZR_MLBB_PRODUCTS,
        FZR_PH_PRODUCTS,
        productsTableInfo,
        existingProductColumns,
        finalProductColumns,
        now,
        upsertFzrProduct,
        syncFzrProducts,
        FZR_API_URL,
        finance,
        mapFzrStatusToFulfillmentStatus,
        fzrFailureDetails,
        createFzrTopup,
        getFzrOrderStatus,
        fzrPollState,
        fzrCheckerRunning,
        FZR_POLL_BASE_DELAY,
        FZR_POLL_MAX_DELAY,
        FZR_POLL_MAX_FAILURES,
        checkPendingFzrOrders,
        escapeHtmlForEmail,
        sendFulfillmentFailureAlert,
        requireLogin,
        requireAdmin,
        computeOrderDisplayStatus,
        expireOldPendingOrders
    } = context;

    /* =========================================================
       CUSTOMER SIGN UP
    ========================================================= */
    
    app.post("/signup", authLimiter, async (req, res) => {
        try {
            const { name, email, phone, password } = req.body;
            const cleanName = String(name || "").trim();
            const cleanEmail = String(email || "").trim().toLowerCase();
            const cleanPhone = String(phone || "").trim();
            const cleanPassword = String(password || "");
    
            if (!cleanName) return res.status(400).json({ success: false, message: "Name is required." });
            if (!cleanEmail) return res.status(400).json({ success: false, message: "Email is required." });
            if (!cleanEmail.includes("@")) return res.status(400).json({ success: false, message: "Please enter a valid email address." });
            if (cleanPassword.length < 8) return res.status(400).json({ success: false, message: "Password must be at least 8 characters." });
    
            const existingUser = db.prepare(`SELECT id FROM users WHERE email = ?`).get(cleanEmail);
            if (existingUser) return res.status(409).json({ success: false, message: "An account with this email already exists." });
    
            const passwordHash = await bcrypt.hash(cleanPassword, 12);
            const createdAt = new Date().toISOString();
    
            const result = db.prepare(`
                INSERT INTO users (name, email, phone, password_hash, role, created_at, email_verified)
                VALUES (@name, @email, @phone, @password_hash, @role, @created_at, 0)
            `).run({
                name: cleanName,
                email: cleanEmail,
                phone: cleanPhone,
                password_hash: passwordHash,
                role: "customer",
                created_at: createdAt
            });
    
            const rawToken = crypto.randomBytes(32).toString("hex");
            const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    
            db.prepare(`
                INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, created_at)
                VALUES (?, ?, ?, ?)
            `).run(result.lastInsertRowid, tokenHash, expiresAt, createdAt);
    
            const verifyUrl = `${FRONTEND_ORIGIN}/verify-email.html?token=${rawToken}`;
    
            try {
                await mailTransporter.sendMail({
                    from: `"Hiro Store" <${process.env.SMTP_USER}>`,
                    to: cleanEmail,
                    subject: "Verify your Hiro Store account",
                    html: `
                        <p>Hi ${cleanName},</p>
                        <p>Thanks for signing up at Hiro Store. Please verify your email to activate your account:</p>
                        <p><a href="${verifyUrl}">${verifyUrl}</a></p>
                        <p>This link expires in 1 hour.</p>
                        <p>Don't see this email? Check your Spam or Junk folder.</p>
                    `
                });
            } catch (mailError) {
                console.error("Verification email failed to send:", mailError);
            }
    
            console.log(`New customer account created (pending verification): ${cleanEmail}`);
    
            return res.status(201).json({
                success: true,
                message: "Account created. Please check your email to verify your account before logging in.",
                requiresVerification: true
            });
        } catch (error) {
            console.error("Signup error:", error);
            return res.status(500).json({ success: false, message: "Unable to create account." });
        }
    });
    
    
    /* =========================================================
       VERIFY EMAIL
    ========================================================= */
    
    
    app.post("/verify-email", async (req, res) => {
        try {
            const rawToken = String(req.body?.token || "").trim();
            if (!rawToken) return res.status(400).json({ success: false, message: "Missing verification token." });
    
            const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    
            const tokenRecord = db.prepare(`
                SELECT * FROM email_verification_tokens WHERE token_hash = ?
            `).get(tokenHash);
    
            if (!tokenRecord || tokenRecord.used || new Date(tokenRecord.expires_at) < new Date()) {
                return res.status(400).json({ success: false, message: "This verification link is invalid or has expired." });
            }
    
            db.prepare(`UPDATE users SET email_verified = 1 WHERE id = ?`).run(tokenRecord.user_id);
            db.prepare(`UPDATE email_verification_tokens SET used = 1 WHERE id = ?`).run(tokenRecord.id);
    
            return res.json({ success: true, message: "Email verified. You can now log in." });
        } catch (error) {
            console.error("Email verification error:", error);
            return res.status(500).json({ success: false, message: "Unable to verify email." });
        }
    });
    
    /* =========================================================
       RESEND VERIFICATION
    ========================================================= */
    
    app.post("/resend-verification", authLimiter, async (req, res) => {
        try {
            const cleanEmail = String(req.body?.email || "").trim().toLowerCase();
            if (!cleanEmail) return res.status(400).json({ success: false, message: "Email is required." });
    
            const user = db.prepare(`SELECT id, name, email_verified FROM users WHERE email = ?`).get(cleanEmail);
    
            // Same response whether the account exists or is already verified �
            // avoids leaking which emails are registered.
            if (!user || user.email_verified) {
                return res.json({ success: true, message: "If that account needs verification, a new email has been sent." });
            }
    
            const rawToken = crypto.randomBytes(32).toString("hex");
            const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
            const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    
            db.prepare(`
                INSERT INTO email_verification_tokens (user_id, token_hash, expires_at, created_at)
                VALUES (?, ?, ?, ?)
            `).run(user.id, tokenHash, expiresAt, new Date().toISOString());
    
            const verifyUrl = `${FRONTEND_ORIGIN}/verify-email.html?token=${rawToken}`;
    
            await mailTransporter.sendMail({
                from: `"Hiro Store" <${process.env.SMTP_USER}>`,
                to: cleanEmail,
                subject: "Verify your Hiro Store account",
                html: `<p>Hi ${user.name},</p><p>Here's your new verification link:</p><p><a href="${verifyUrl}">${verifyUrl}</a></p>
               <p>This link expires in 1 hour.</p><p>Don't see this email? Check your Spam or Junk folder.</p>`
            });
    
            return res.json({ success: true, message: "If that account needs verification, a new email has been sent." });
        } catch (error) {
            console.error("Resend verification error:", error);
            return res.status(500).json({ success: false, message: "Unable to resend verification email." });
        }
    });
    
    /* =========================================================
       CUSTOMER LOGIN
    ========================================================= */
    
    app.post("/login", authLimiter, async (req, res) => {
        try {
            const { email, password } = req.body;
            const cleanEmail = String(email || "").trim().toLowerCase();
            const cleanPassword = String(password || "");
    
            if (!cleanEmail || !cleanPassword) return res.status(400).json({ success: false, message: "Email and password are required." });
    
            const user = db.prepare(`
                SELECT id, name, email, phone, password_hash, role, created_at, email_verified FROM users WHERE email = ?
            `).get(cleanEmail);
    
            if (!user) return res.status(401).json({ success: false, message: "Invalid email or password." });
    
            const passwordCorrect = await bcrypt.compare(cleanPassword, user.password_hash);
            if (!passwordCorrect) return res.status(401).json({ success: false, message: "Invalid email or password." });
    
            if (!user.email_verified) {
                return res.status(403).json({
                    success: false,
                    message: "Please verify your email before logging in. Check your inbox for the verification link.",
                    requiresVerification: true
                });
            }
    
            // Regenerate the session ID on login to defeat session fixation:
            // any ID an attacker planted before login becomes worthless.
            await new Promise((resolve, reject) => {
                req.session.regenerate((regenerateError) =>
                    regenerateError ? reject(regenerateError) : resolve()
                );
            });
    
            req.session.userId = user.id;
            req.session.userRole = user.role;
    
            console.log("LOGIN OK:", { userId: user.id, role: user.role });
    
            req.session.save((sessionError) => {
                if (sessionError) {
                    console.error("Could not save login session:", sessionError);
                    return res.status(500).json({ success: false, message: "Unable to create login session." });
                }
    
                console.log(`Customer logged in: ${user.email}`);
    
                return res.json({
                    success: true,
                    message: "Login successful.",
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        phone: user.phone,
                        role: user.role,
                        createdAt: user.created_at
                    }
                });
            });
        } catch (error) {
            console.error("Login error:", error);
            return res.status(500).json({ success: false, message: "Unable to log in." });
        }
    });
    
    /* =========================================================
       GET CURRENT USER
    ========================================================= */
    
    app.get("/me", (req, res) => {
        try {
            if (!req.session.userId) return res.status(401).json({ success: false, authenticated: false, message: "Not logged in." });
    
            const user = db.prepare(`SELECT id, name, email, phone, role, avatar, created_at FROM users WHERE id = ?`).get(req.session.userId);
    
            if (!user) {
                req.session.destroy(() => { });
                return res.status(401).json({ success: false, authenticated: false, message: "Account no longer exists." });
            }
    
            return res.json({
                success: true,
                authenticated: true,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    avatar: user.avatar,
                    createdAt: user.created_at
                }
            });
        } catch (error) {
            console.error("Could not get current user:", error);
            return res.status(500).json({ success: false, message: "Unable to check login status." });
        }
    });
    
    /* =========================================================
       UPDATE MY PROFILE (name + avatar)
    ========================================================= */
    app.patch("/me", requireLogin, (req, res) => {
        try {
            const name = req.body?.name !== undefined ? String(req.body.name).trim() : null;
            const avatar = req.body?.avatar !== undefined ? String(req.body.avatar).trim() : null;
    
            const allowedAvatars = ["avatar-1", "avatar-2", "avatar-3", "avatar-4", "avatar-5", "avatar-6", "avatar-7", "avatar-8"];
    
            if (name !== null && name.length < 2) {
                return res.status(400).json({ success: false, message: "Name must be at least 2 characters." });
            }
    
            if (avatar !== null && !allowedAvatars.includes(avatar)) {
                return res.status(400).json({ success: false, message: "Invalid avatar selection." });
            }
    
            if (name !== null) {
                db.prepare(`UPDATE users SET name = ? WHERE id = ?`).run(name, req.session.userId);
            }
    
            if (avatar !== null) {
                db.prepare(`UPDATE users SET avatar = ? WHERE id = ?`).run(avatar, req.session.userId);
            }
    
            const user = db.prepare(`SELECT id, name, email, phone, role, avatar, created_at FROM users WHERE id = ?`).get(req.session.userId);
    
            return res.json({
                success: true,
                user: {
                    id: user.id,
                    name: user.name,
                    email: user.email,
                    phone: user.phone,
                    role: user.role,
                    avatar: user.avatar,
                    createdAt: user.created_at
                }
            });
        } catch (error) {
            console.error("Could not update profile:", error);
            return res.status(500).json({ success: false, message: "Unable to update profile." });
        }
    });
    
    /* =========================================================
       CUSTOMER LOGOUT
    ========================================================= */
    app.post("/logout", (req, res) => {
        req.session.destroy((error) => {
            if (error) {
                console.error("Logout error:", error);
    
                return res.status(500).json({
                    success: false,
                    message: "Unable to log out."
                });
            }
    
            res.clearCookie("connect.sid");
    
            return res.json({
                success: true,
                message: "Logged out successfully."
            });
        });
    });
    
    app.post("/forgot-password", passwordResetLimiter, async (req, res) => {
        try {
            const email = String(
                req.body?.email || ""
            )
                .trim()
                .toLowerCase();
    
            if (!email) {
                return res.status(400).json({
                    success: false,
                    message: "Please enter your email address."
                });
            }
    
            const user = db.prepare(`
                SELECT id, email
                FROM users
                WHERE email = ?
            `).get(email);
    
            /*
             * IMPORTANT:
             * Do not reveal whether the email exists.
             */
            if (!user) {
                return res.json({
                    success: true,
                    message:
                        "If an account exists with that email, a password reset link has been sent."
                });
            }
    
            /*
             * Generate a cryptographically secure token.
             */
            const rawToken =
                crypto.randomBytes(32).toString("hex");
    
            /*
             * Store only the hash in the database.
             */
            const tokenHash =
                crypto
                    .createHash("sha256")
                    .update(rawToken)
                    .digest("hex");
    
            /*
             * Token expires after 30 minutes.
             */
            const expiresAt =
                new Date(
                    Date.now() + 30 * 60 * 1000
                ).toISOString();
    
            const createdAt =
                new Date().toISOString();
    
            /*
             * Remove old unused tokens for this user.
             */
            db.prepare(`
                DELETE FROM password_reset_tokens
                WHERE user_id = ?
            `).run(user.id);
    
            /*
             * Save new token.
             */
            db.prepare(`
                INSERT INTO password_reset_tokens (
                    user_id,
                    token_hash,
                    expires_at,
                    used,
                    created_at
                )
                VALUES (?, ?, ?, 0, ?)
            `).run(
                user.id,
                tokenHash,
                expiresAt,
                createdAt
            );
    
            /*
             * This is the URL the customer will eventually receive.
             */
            const resetUrl =
                `${FRONTEND_ORIGIN}/reset-password.html?token=${rawToken}`;
    
            try {
                await mailTransporter.sendMail({
                    from: `"Hiro Store" <${process.env.SMTP_USER}>`,
                    to: user.email,
                    subject: "Reset your Hiro Store password",
    
                    text: `Hello ${user.name || ""},
    
    We received a request to reset your Hiro Store password.
    
    Click the link below to create a new password:
    
    ${resetUrl}
    
    This link will expire in 30 minutes.
    
    If you did not request a password reset, you can safely ignore this email.
    
    Hiro Store`,
    
                    html: `
                <div style="
                    margin:0;
                    padding:30px 15px;
                    background:#111;
                    font-family:Arial,sans-serif;
                    color:#fff;
                ">
    
                    <div style="
                        max-width:520px;
                        margin:auto;
                        background:#181818;
                        border:1px solid rgba(255,152,0,.2);
                        border-radius:18px;
                        padding:30px;
                    ">
    
                        <h2 style="
                            margin-top:0;
                            color:#ff9800;
                        ">
                            Reset your Hiro Store password
                        </h2>
    
                        <p>
                          Hello ${user.name || ""},
                        </p>
    
                        <p>
                            We received a request to reset your
                            Hiro Store password.
                        </p>
    
                        <p>
                            Click the button below to create a
                            new password:
                        </p>
    
                        <p style="text-align:center;margin:30px 0;">
                            <a
                                href="${resetUrl}"
                                style="
                                    display:inline-block;
                                    padding:14px 24px;
                                    background:linear-gradient(
                                        135deg,
                                        #ff9800,
                                        #ff5722
                                    );
                                    color:#fff;
                                    text-decoration:none;
                                    border-radius:10px;
                                    font-weight:bold;
                                "
                            >
                                Reset Password
                            </a>
                        </p>
    
                        <p style="color:#aaa;font-size:13px;">
                            This link will expire in 30 minutes.
                        </p>
    
                        <p style="color:#aaa;font-size:13px;">
                            If you did not request a password reset,
                            you can safely ignore this email.
                        </p>
    
                        <p style="
                            margin-top:30px;
                            color:#ff9800;
                            font-weight:bold;
                        ">
                            Hiro Store
                        </p>
    
                    </div>
                </div>
            `
                });
    
                console.log(
                    `✅ Password reset email sent to ${user.email}`
                );
    
                return res.json({
                    success: true,
                    message:
                        "If an account exists with that email, a password reset link has been sent."
                });
    
            } catch (error) {
    
                console.error(
                    "❌ Failed to send password reset email:",
                    error
                );
    
                return res.status(500).json({
                    success: false,
                    message:
                        "Unable to send password reset email."
                });
            }
    
        } catch (error) {
            console.error(
                "Forgot password error:",
                error
            );
    
            return res.status(500).json({
                success: false,
                message:
                    "Unable to process your request."
            });
        }
    });
    
    app.post("/reset-password", passwordResetLimiter, async (req, res) => {
        try {
            const token = String(
                req.body?.token || ""
            ).trim();
    
            const newPassword = String(
                req.body?.password || ""
            );
    
            if (!token) {
                return res.status(400).json({
                    success: false,
                    message: "Reset token is required."
                });
            }
    
            if (newPassword.length < 8) {
                return res.status(400).json({
                    success: false,
                    message:
                        "Password must be at least 8 characters."
                });
            }
    
            const tokenHash =
                crypto
                    .createHash("sha256")
                    .update(token)
                    .digest("hex");
    
            const resetRecord = db.prepare(`
                SELECT
                    id,
                    user_id,
                    expires_at,
                    used
                FROM password_reset_tokens
                WHERE token_hash = ?
                LIMIT 1
            `).get(tokenHash);
    
            if (!resetRecord) {
                return res.status(400).json({
                    success: false,
                    message:
                        "This password reset link is invalid."
                });
            }
    
            if (resetRecord.used) {
                return res.status(400).json({
                    success: false,
                    message:
                        "This password reset link has already been used."
                });
            }
    
            if (
                new Date(resetRecord.expires_at)
                    .getTime() < Date.now()
            ) {
                return res.status(400).json({
                    success: false,
                    message:
                        "This password reset link has expired."
                });
            }
    
            const passwordHash =
                await bcrypt.hash(
                    newPassword,
                    12
                );
    
            const updatePassword =
                db.transaction(() => {
    
                    db.prepare(`
                        UPDATE users
                        SET password_hash = ?
                        WHERE id = ?
                    `).run(
                        passwordHash,
                        resetRecord.user_id
                    );
    
                    db.prepare(`
                        UPDATE password_reset_tokens
                        SET used = 1
                        WHERE id = ?
                    `).run(
                        resetRecord.id
                    );
                });
    
            updatePassword();
    
            return res.json({
                success: true,
                message:
                    "Your password has been reset successfully."
            });
    
        } catch (error) {
            console.error(
                "Reset password error:",
                error
            );
    
            return res.status(500).json({
                success: false,
                message:
                    "Unable to reset password."
            });
        }
    });
};
