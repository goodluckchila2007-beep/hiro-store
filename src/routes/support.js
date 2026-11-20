"use strict";

/** Register the support HTTP endpoints. Dependencies are supplied by the server composition root. */
module.exports = function registerSupportRoutes(context) {
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
       CUSTOMER SUBMIT COMPLAINT
    ========================================================= */
    
    app.post("/complaints", requireLogin, (req, res) => {
        try {
            const { orderId, message } = req.body;
            const cleanOrderId = String(orderId || "").trim();
            const cleanMessage = String(message || "").trim();
    
            if (!cleanOrderId) return res.status(400).json({ success: false, message: "Order ID is required." });
            if (!cleanMessage) return res.status(400).json({ success: false, message: "Please describe your complaint." });
            if (cleanMessage.length < 10) return res.status(400).json({ success: false, message: "Please provide more details about the problem." });
    
            const order = db.prepare(`SELECT order_id, user_id, status FROM orders WHERE order_id = ?`).get(cleanOrderId);
            if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    
            if (Number(order.user_id) !== Number(req.session.userId)) {
                return res.status(403).json({ success: false, message: "You can only complain about your own orders." });
            }
    
            const orderItems = db.prepare(`SELECT fulfillment_status FROM order_items WHERE order_id = ?`).all(cleanOrderId);
            const displayStatus = computeOrderDisplayStatus(order, orderItems);
    
            const allowedStatuses = ["Failed", "Cancelled"];
            if (!allowedStatuses.includes(displayStatus)) {
                return res.status(400).json({ success: false, message: "A complaint can only be submitted for a failed or cancelled order." });
            }
    
            const currentUser = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.session.userId);
            const now = new Date().toISOString();
    
            const existingComplaint = db.prepare(`SELECT id, status FROM complaints WHERE user_id = ? AND order_id = ?`).get(req.session.userId, cleanOrderId);
    
            let complaintId;
    
            if (existingComplaint) {
                complaintId = existingComplaint.id;
    
                db.prepare(`UPDATE complaints SET updated_at = ?, status = 'Open' WHERE id = ?`).run(now, complaintId);
    
                db.prepare(`
                    INSERT INTO complaint_messages (complaint_id, sender_role, sender_name, message, created_at)
                    VALUES (?, 'customer', ?, ?, ?)
                `).run(complaintId, currentUser?.name || "Customer", cleanMessage, now);
    
                console.log(`Complaint #${complaintId} continued for ${cleanOrderId}`);
    
            } else {
                const result = db.prepare(`
                    INSERT INTO complaints (user_id, order_id, message, status, admin_response, refund_status, created_at, updated_at)
                    VALUES (@user_id, @order_id, @message, @status, @admin_response, @refund_status, @created_at, @updated_at)
                `).run({
                    user_id: req.session.userId,
                    order_id: cleanOrderId,
                    message: cleanMessage,
                    status: "Open",
                    admin_response: null,
                    refund_status: "Not Requested",
                    created_at: now,
                    updated_at: now
                });
    
                complaintId = result.lastInsertRowid;
    
                db.prepare(`
                    INSERT INTO complaint_messages (complaint_id, sender_role, sender_name, message, created_at)
                    VALUES (?, 'customer', ?, ?, ?)
                `).run(complaintId, currentUser?.name || "Customer", cleanMessage, now);
    
                console.log(`Complaint created: #${complaintId} for ${cleanOrderId}`);
            }
    
            return res.status(201).json({
                success: true,
                message: "Complaint submitted successfully.",
                complaintId: complaintId,
                complaint: {
                    id: complaintId,
                    orderId: cleanOrderId,
                    message: cleanMessage,
                    status: "Open",
                    refundStatus: "Not Requested",
                    createdAt: now
                }
            });
        } catch (error) {
            console.error("Complaint submission error:", error);
            return res.status(500).json({ success: false, message: "Unable to submit complaint." });
        }
    });
    
    /* =========================================================
       GET CUSTOMER COMPLAINTS
    ========================================================= */
    
    app.get("/complaints", requireLogin, (req, res) => {
        try {
            const complaints = db.prepare(`
                SELECT id, order_id, message, status, admin_response, refund_status, created_at, updated_at
                FROM complaints WHERE user_id = ? ORDER BY created_at DESC
            `).all(req.session.userId);
    
            return res.json({
                success: true,
                complaints: complaints.map(complaint => ({
                    id: complaint.id,
                    orderId: complaint.order_id,
                    message: complaint.message,
                    status: complaint.status,
                    adminResponse: complaint.admin_response,
                    refundStatus: complaint.refund_status,
                    createdAt: complaint.created_at,
                    updatedAt: complaint.updated_at
                }))
            });
        } catch (error) {
            console.error("Could not load customer complaints:", error);
            return res.status(500).json({ success: false, message: "Unable to load complaints." });
        }
    });
    
    /* =========================================================
       GET COMPLAINT FOR A SPECIFIC ORDER (customer)
    ========================================================= */
    
    app.get("/complaints/by-order/:orderId", requireLogin, (req, res) => {
        try {
            const orderId = String(req.params.orderId || "").trim();
    
            const complaint = db.prepare(`
                SELECT id, order_id, status, refund_status, created_at
                FROM complaints WHERE user_id = ? AND order_id = ?
            `).get(req.session.userId, orderId);
    
            if (!complaint) {
                return res.json({ success: true, complaint: null });
            }
    
            return res.json({
                success: true,
                complaint: {
                    id: complaint.id,
                    orderId: complaint.order_id,
                    status: complaint.status,
                    refundStatus: complaint.refund_status,
                    createdAt: complaint.created_at
                }
            });
        } catch (error) {
            console.error("Could not look up complaint by order:", error);
            return res.status(500).json({ success: false, message: "Unable to look up complaint." });
        }
    });
    
    /* =========================================================
       SUPPORT CHAT — GET MY ACTIVE CONVERSATION (customer)
    ========================================================= */
    
    app.get("/api/support/conversation", requireLogin, (req, res) => {
        try {
            const conversation = db.prepare(`
                SELECT id, order_id, status, refund_status, created_at
                FROM support_conversations
                WHERE user_id = ? AND status = 'Open'
                ORDER BY created_at DESC
                LIMIT 1
            `).get(req.session.userId);
    
            if (!conversation) {
                return res.json({ success: true, conversation: null, messages: [] });
            }
    
            const messages = db.prepare(`
                SELECT sender_role, sender_name, message, created_at
                FROM support_messages
                WHERE conversation_id = ?
                ORDER BY created_at ASC
            `).all(conversation.id);
    
            return res.json({
                success: true,
                conversation: {
                    id: conversation.id,
                    orderId: conversation.order_id,
                    status: conversation.status,
                    createdAt: conversation.created_at
                },
                messages
            });
        } catch (error) {
            console.error("Could not load support conversation:", error);
            return res.status(500).json({ success: false, message: "Unable to load conversation." });
        }
    });
    
    /* =========================================================
       SUPPORT CHAT — SEND MESSAGE (customer)
    ========================================================= */
    
    app.post("/api/support/conversation", requireLogin, (req, res) => {
        try {
            const cleanMessage = String(req.body?.message || "").trim();
            const orderId = req.body?.orderId ? String(req.body.orderId).trim() : null;
    
            if (!cleanMessage) {
                return res.status(400).json({ success: false, message: "Message cannot be empty." });
            }
    
            const now = new Date().toISOString();
            const currentUser = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.session.userId);
    
            let conversation = db.prepare(`
                SELECT id FROM support_conversations
                WHERE user_id = ? AND status = 'Open'
                ORDER BY created_at DESC
                LIMIT 1
            `).get(req.session.userId);
    
            let conversationId;
    
            if (conversation) {
                conversationId = conversation.id;
                db.prepare(`UPDATE support_conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
            } else {
                const result = db.prepare(`
                    INSERT INTO support_conversations (user_id, order_id, status, refund_status, created_at, updated_at)
                    VALUES (?, ?, 'Open', 'Not Requested', ?, ?)
                `).run(req.session.userId, orderId, now, now);
                conversationId = result.lastInsertRowid;
            }
    
            db.prepare(`
                INSERT INTO support_messages (conversation_id, sender_role, sender_name, message, created_at)
                VALUES (?, 'customer', ?, ?, ?)
            `).run(conversationId, currentUser?.name || "Customer", cleanMessage, now);
    
            return res.status(201).json({
                success: true,
                conversationId
            });
        } catch (error) {
            console.error("Could not send support message:", error);
            return res.status(500).json({ success: false, message: "Unable to send message." });
        }
    });
    
    /* =========================================================
       GET MESSAGES FOR A COMPLAINT (customer)
    ========================================================= */
    app.get("/complaints/:id/messages", requireLogin, (req, res) => {
        try {
            const complaintId = Number(req.params.id);
    
            const complaint = db.prepare(`SELECT id, user_id FROM complaints WHERE id = ?`).get(complaintId);
            if (!complaint) return res.status(404).json({ success: false, message: "Complaint not found." });
            if (Number(complaint.user_id) !== Number(req.session.userId)) {
                return res.status(403).json({ success: false, message: "Not your complaint." });
            }
    
            const messages = db.prepare(`
                SELECT sender_role, sender_name, message, created_at
                FROM complaint_messages
                WHERE complaint_id = ?
                ORDER BY created_at ASC
            `).all(complaintId);
    
            return res.json({ success: true, messages });
        } catch (error) {
            console.error("Could not load complaint messages:", error);
            return res.status(500).json({ success: false, message: "Unable to load messages." });
        }
    });
    
    /* =========================================================
       SEND MESSAGE AS CUSTOMER
    ========================================================= */
    
    app.post("/complaints/:id/messages", requireLogin, (req, res) => {
        try {
            const complaintId = Number(req.params.id);
            const cleanMessage = String(req.body?.message || "").trim();
    
            if (!cleanMessage) return res.status(400).json({ success: false, message: "Message cannot be empty." });
    
            const complaint = db.prepare(`SELECT id, user_id, status FROM complaints WHERE id = ?`).get(complaintId);
            if (!complaint) return res.status(404).json({ success: false, message: "Complaint not found." });
            if (Number(complaint.user_id) !== Number(req.session.userId)) {
                return res.status(403).json({ success: false, message: "Not your complaint." });
            }
    
            const currentUser = db.prepare(`SELECT name FROM users WHERE id = ?`).get(req.session.userId);
            const now = new Date().toISOString();
    
            db.prepare(`
                INSERT INTO complaint_messages (complaint_id, sender_role, sender_name, message, created_at)
                VALUES (?, 'customer', ?, ?, ?)
            `).run(complaintId, currentUser?.name || "Customer", cleanMessage, now);
    
            db.prepare(`UPDATE complaints SET updated_at = ? WHERE id = ?`).run(now, complaintId);
    
            return res.json({ success: true, message: "Message sent." });
        } catch (error) {
            console.error("Could not send complaint message:", error);
            return res.status(500).json({ success: false, message: "Unable to send message." });
        }
    });
    
    /* =========================================================
       ADMIN — GET MESSAGES FOR A COMPLAINT
    ========================================================= */
    
    app.get("/api/admin/complaints/:id/messages", requireAdmin, (req, res) => {
        try {
            const complaintId = Number(req.params.id);
    
            const messages = db.prepare(`
                SELECT sender_role, sender_name, message, created_at
                FROM complaint_messages
                WHERE complaint_id = ?
                ORDER BY created_at ASC
            `).all(complaintId);
    
            return res.json({ success: true, messages });
        } catch (error) {
            console.error("Could not load admin complaint messages:", error);
            return res.status(500).json({ success: false, message: "Unable to load messages." });
        }
    });
    
    /* =========================================================
       ADMIN — SEND MESSAGE
    ========================================================= */
    
    app.post("/api/admin/complaints/:id/messages", requireAdmin, (req, res) => {
        try {
            const complaintId = Number(req.params.id);
            const cleanMessage = String(req.body?.message || "").trim();
    
            if (!cleanMessage) return res.status(400).json({ success: false, message: "Message cannot be empty." });
    
            const complaint = db.prepare(`SELECT id FROM complaints WHERE id = ?`).get(complaintId);
            if (!complaint) return res.status(404).json({ success: false, message: "Complaint not found." });
    
            const now = new Date().toISOString();
    
            db.prepare(`
                INSERT INTO complaint_messages (complaint_id, sender_role, sender_name, message, created_at)
                VALUES (?, 'admin', 'Hiro Store Support', ?, ?)
            `).run(complaintId, cleanMessage, now);
    
            db.prepare(`UPDATE complaints SET updated_at = ? WHERE id = ?`).run(now, complaintId);
    
            return res.json({ success: true, message: "Message sent." });
        } catch (error) {
            console.error("Could not send admin complaint message:", error);
            return res.status(500).json({ success: false, message: "Unable to send message." });
        }
    });
    
    /* =========================================================
       ADMIN — GET ALL COMPLAINTS
    ========================================================= */
    
    app.get("/api/admin/complaints", requireAdmin, (req, res) => {
        try {
            const complaints = db.prepare(`
                SELECT
                    c.id, c.order_id, c.message, c.status,
                    c.admin_response, c.refund_status,
                    c.created_at, c.updated_at,
                    u.email AS customer_email
                FROM complaints c
                LEFT JOIN users u ON c.user_id = u.id
                ORDER BY c.created_at DESC
            `).all();
    
            return res.json({
                success: true,
                complaints: complaints.map(c => ({
                    id: c.id,
                    orderId: c.order_id,
                    customerEmail: c.customer_email,
                    message: c.message,
                    status: c.status,
                    adminResponse: c.admin_response,
                    refundStatus: c.refund_status,
                    createdAt: c.created_at,
                    updatedAt: c.updated_at
                }))
            });
        } catch (error) {
            console.error("Could not load admin complaints:", error);
            return res.status(500).json({ success: false, message: "Unable to load complaints." });
        }
    });
    
    /* =========================================================
       ADMIN — RESPOND TO / UPDATE A COMPLAINT
    ========================================================= */
    
    app.patch("/api/admin/complaints/:id", requireAdmin, (req, res) => {
        try {
            const complaintId = Number(req.params.id);
            const status = String(req.body?.status || "").trim();
            const adminResponse = String(req.body?.adminResponse || "").trim();
            const refundStatus = String(req.body?.refundStatus || "").trim();
    
            const allowedStatuses = ["Open", "Resolved", "Rejected"];
            const allowedRefundStatuses = ["Not Requested", "Pending", "Refunded", "Denied"];
    
            if (!allowedStatuses.includes(status)) {
                return res.status(400).json({ success: false, message: "Invalid complaint status." });
            }
            if (!allowedRefundStatuses.includes(refundStatus)) {
                return res.status(400).json({ success: false, message: "Invalid refund status." });
            }
    
            const existing = db.prepare(`SELECT id FROM complaints WHERE id = ?`).get(complaintId);
            if (!existing) {
                return res.status(404).json({ success: false, message: "Complaint not found." });
            }
    
            const now = new Date().toISOString();
    
            db.prepare(`
                UPDATE complaints
                SET status = ?, admin_response = ?, refund_status = ?, updated_at = ?
                WHERE id = ?
            `).run(status, adminResponse || null, refundStatus, now, complaintId);
    
            console.log(`Complaint #${complaintId} updated by admin: ${status}`);
    
            return res.json({ success: true, message: "Complaint updated." });
        } catch (error) {
            console.error("Could not update complaint:", error);
            return res.status(500).json({ success: false, message: "Unable to update complaint." });
        }
    });
    
    /* =========================================================
       ADMIN — SUPPORT CHAT: LIST CONVERSATIONS
    ========================================================= */
    
    app.get("/api/admin/support/conversations", requireAdmin, (req, res) => {
        try {
            const conversations = db.prepare(`
                SELECT
                    sc.id, sc.user_id, sc.order_id, sc.status, sc.refund_status, sc.created_at, sc.updated_at,
                    u.name AS customer_name, u.email AS customer_email,
                    (SELECT message FROM support_messages WHERE conversation_id = sc.id ORDER BY created_at DESC LIMIT 1) AS last_message
                FROM support_conversations sc
                INNER JOIN users u ON u.id = sc.user_id
                ORDER BY sc.updated_at DESC
            `).all();
    
            return res.json({
                success: true,
                conversations: conversations.map(c => ({
                    id: c.id,
                    userId: c.user_id,
                    orderId: c.order_id,
                    status: c.status,
                    refundStatus: c.refund_status,
                    customerName: c.customer_name,
                    customerEmail: c.customer_email,
                    lastMessage: c.last_message,
                    createdAt: c.created_at,
                    updatedAt: c.updated_at
                }))
            });
        } catch (error) {
            console.error("Could not load support conversations:", error);
            return res.status(500).json({ success: false, message: "Unable to load conversations." });
        }
    });
    
    /* =========================================================
       ADMIN — SUPPORT CHAT: GET MESSAGES FOR A CONVERSATION
    ========================================================= */
    
    app.get("/api/admin/support/conversations/:id/messages", requireAdmin, (req, res) => {
        try {
            const conversationId = Number(req.params.id);
    
            const messages = db.prepare(`
                SELECT sender_role, sender_name, message, created_at
                FROM support_messages
                WHERE conversation_id = ?
                ORDER BY created_at ASC
            `).all(conversationId);
    
            return res.json({ success: true, messages });
        } catch (error) {
            console.error("Could not load conversation messages:", error);
            return res.status(500).json({ success: false, message: "Unable to load messages." });
        }
    });
    
    /* =========================================================
       ADMIN — SUPPORT CHAT: SEND REPLY
    ========================================================= */
    
    app.post("/api/admin/support/conversations/:id/messages", requireAdmin, (req, res) => {
        try {
            const conversationId = Number(req.params.id);
            const cleanMessage = String(req.body?.message || "").trim();
    
            if (!cleanMessage) {
                return res.status(400).json({ success: false, message: "Message cannot be empty." });
            }
    
            const conversation = db.prepare(`SELECT id FROM support_conversations WHERE id = ?`).get(conversationId);
            if (!conversation) {
                return res.status(404).json({ success: false, message: "Conversation not found." });
            }
    
            const now = new Date().toISOString();
    
            db.prepare(`
                INSERT INTO support_messages (conversation_id, sender_role, sender_name, message, created_at)
                VALUES (?, 'admin', 'Hiro Store Support', ?, ?)
            `).run(conversationId, cleanMessage, now);
    
            db.prepare(`UPDATE support_conversations SET updated_at = ? WHERE id = ?`).run(now, conversationId);
    
            return res.json({ success: true, message: "Reply sent." });
        } catch (error) {
            console.error("Could not send admin reply:", error);
            return res.status(500).json({ success: false, message: "Unable to send reply." });
        }
    });
    
    /* =========================================================
       ADMIN — SUPPORT CHAT: RESOLVE CONVERSATION
    ========================================================= */
    
    app.patch("/api/admin/support/conversations/:id", requireAdmin, (req, res) => {
        try {
            const conversationId = Number(req.params.id);
            const status = String(req.body?.status || "").trim();
            const allowedStatuses = ["Open", "Resolved"];
    
            if (!allowedStatuses.includes(status)) {
                return res.status(400).json({ success: false, message: "Invalid status." });
            }
    
            const existing = db.prepare(`SELECT id FROM support_conversations WHERE id = ?`).get(conversationId);
            if (!existing) {
                return res.status(404).json({ success: false, message: "Conversation not found." });
            }
    
            const now = new Date().toISOString();
            db.prepare(`UPDATE support_conversations SET status = ?, updated_at = ? WHERE id = ?`).run(status, now, conversationId);
    
            return res.json({ success: true, message: "Conversation updated." });
        } catch (error) {
            console.error("Could not update conversation:", error);
            return res.status(500).json({ success: false, message: "Unable to update conversation." });
        }
    });
};
