"use strict";

/** FZR Cards integration: player validation, top-up submission and order polling. */
module.exports = function createFzrService({ app, db, axios, getSetting, setSetting, logger, apiLimiter, FZR_EXCHANGE_RATE, sendFulfillmentFailureAlert }) {
    const FZR_API_URL = "https://api.fzr.cards/api/v2";

    app.post("/api/validate-player", apiLimiter, async (req, res) => {
        try {
            const { player_id, zone_id } = req.body;
    
            if (!player_id || !zone_id) {
                return res.status(400).json({
                    ok: false,
                    error: "Player ID and Zone ID are required"
                });
            }
    
            const fzrResponse = await fetch(
                "https://api.fzr.cards/api/v2/topups/validate-id",
                {
                    method: "POST",
                    headers: {
                        "Accept": "application/json",
                        "Content-Type": "application/json",
                        "X-API-Key": process.env.FZR_API_KEY
                    },
                    body: JSON.stringify({
                        category_id: "mobile_legends",
                        fields: {
                            player_id: String(player_id),
                            zone_id: String(zone_id)
                        }
                    })
                }
            );
    
            const data = await fzrResponse.json();
    
            logger.debug("FZR player validation completed.");
    
            return res.status(fzrResponse.status).json(data);
    
        } catch (error) {
            console.error("FZR error:", error);
    
            return res.status(500).json({
                ok: false,
                error: "Unable to contact validation service"
            });
        }
    });
    console.log("✅ /api/validate-player route registered");

    // Supplier costs persist across restarts; catalog seeds only insert missing products.
    const finance = require("./hiro-finance").createFinance({
        db, axios, getSetting, setSetting,
        exchangeRateFallback: FZR_EXCHANGE_RATE,
        apiKey: process.env.FZR_API_KEY,
        paystackKey: PAYSTACK_SECRET_KEY
    });
    
    app.get("/api/admin/profit", requireAdmin, async (req, res) => {
        try {
            await finance.refreshPrices();
            return res.json({ success: true, profit: finance.overview(String(req.query.period || "7")) });
        } catch (error) {
            logger.error("Profit report unavailable:", error.message);
            return res.status(500).json({ success: false, message: "Unable to load profit report." });
        }
    });
    
    app.post("/api/admin/paystack-fees/recover", requireAdmin, async (req, res) => {
        try {
            const result = await finance.recoverFees();
            if (result.busy) return res.status(409).json({ success: false, message: "Fee recovery is already running." });
            return res.json({ success: true, ...result });
        } catch (error) {
            logger.error("Fee recovery unavailable:", error.message);
            return res.status(502).json({ success: false, message: "Unable to recover fees right now." });
        }
    });
    
    
    function mapFzrStatusToFulfillmentStatus(status) {
        const normalizedStatus =
            String(status || "").toLowerCase();
    
        if (
            ["completed", "success", "successful"]
                .includes(normalizedStatus)
        ) {
            return "Completed";
        }
    
        if (
            [
                "failed",
                "cancelled",
                "canceled",
                "refunded",
                "refund"
            ].includes(normalizedStatus)
        ) {
            return "Failed";
        }
    
        return "Processing";
    }
    
    class FzrSubmissionError extends Error {
        constructor(message, outcomeUnknown = false, httpStatus = null) {
            super(message);
            this.name = "FzrSubmissionError";
            this.outcomeUnknown = outcomeUnknown;
            this.httpStatus = httpStatus;
        }
    }
    
    function fzrFailureDetails(error) {
        return {
            status: error?.outcomeUnknown ? "Review Required" : "Failed",
            message: String(error?.message || "Unknown FZR error").trim().slice(0, 500)
        };
    }
    
    async function createFzrTopup({ offerId, categoryId, playerId, serverId }) {
        if (!process.env.FZR_API_KEY) throw new FzrSubmissionError("FZR_API_KEY is missing.");
        if (!offerId) throw new FzrSubmissionError("FZR offer ID is missing.");
        if (!playerId) throw new FzrSubmissionError("Mobile Legends player ID is missing.");
        if (!serverId) throw new FzrSubmissionError("Mobile Legends server ID is missing.");
    
        const allowedFzrCategories = ["mobile_legends_global", "mobile_legends_philippines"];
        const resolvedCategoryId = allowedFzrCategories.includes(categoryId) ? categoryId : "mobile_legends_global";
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
    
        try {
            const response = await fetch(`${FZR_API_URL}/topups/order`, {
                method: "POST",
                headers: {
                    Accept: "application/json",
                    "Content-Type": "application/json",
                    "X-API-Key": process.env.FZR_API_KEY
                },
                body: JSON.stringify({
                    category_id: resolvedCategoryId,
                    offer_id: String(offerId),
                    fields: { player_id: String(playerId), server_id: String(serverId) }
                }),
                signal: controller.signal
            });
    
            const contentType = String(response.headers.get("content-type") || "").toLowerCase();
            const rawBody = await response.text();
            let data = null;
            try { data = rawBody ? JSON.parse(rawBody) : null; } catch { data = null; }
    
            if (!data || typeof data !== "object") {
                const message = response.status >= 500
                    ? `FZR is temporarily unavailable (HTTP ${response.status}).`
                    : `FZR returned an unexpected ${contentType || "non-JSON"} response (HTTP ${response.status}).`;
                throw new FzrSubmissionError(message, true, response.status);
            }
    
            logger.info(`FZR topup response: HTTP ${response.status}, ${data.ok ? "success" : "failed"}`);
    
            if (!response.ok || !data.ok) {
                const message = String(data.error || data.message || `FZR returned HTTP ${response.status}.`);
                throw new FzrSubmissionError(message, response.status >= 500, response.status);
            }
    
            if (!data.order?.id) {
                throw new FzrSubmissionError("FZR accepted the request but did not return an order ID.", true, response.status);
            }
    
            return data;
        } catch (error) {
            if (error instanceof FzrSubmissionError) throw error;
            if (error?.name === "AbortError") {
                throw new FzrSubmissionError("FZR request timed out. The supplier outcome is unknown.", true);
            }
            throw new FzrSubmissionError(`Could not reach FZR: ${String(error?.message || "network error")}. The supplier outcome is unknown.`, true);
        } finally {
            clearTimeout(timeout);
        }
    }
    
    
    async function getFzrOrderStatus(fzrOrderId) {
        const controller =
            new AbortController();
    
        const timeout =
            setTimeout(
                () => controller.abort(),
                8000
            );
    
        try {
            const response = await fetch(
                `${FZR_API_URL}/orders/${encodeURIComponent(fzrOrderId)}`,
                {
                    method: "GET",
    
                    headers: {
                        Accept: "application/json",
                        "X-API-Key":
                            process.env.FZR_API_KEY
                    },
    
                    signal:
                        controller.signal
                }
            );
    
            /*
             * Read as text first.
             *
             * FZR has occasionally returned HTML
             * error pages, so response.json() directly
             * is unsafe.
             */
            const rawBody =
                await response.text();
    
            let data;
    
            try {
                data =
                    rawBody
                        ? JSON.parse(rawBody)
                        : {};
            } catch {
                throw new Error(
                    `FZR returned non-JSON response (HTTP ${response.status}).`
                );
            }
    
            if (
                !response.ok ||
                !data.ok ||
                !data.order
            ) {
                throw new Error(
                    data.error ||
                    data.message ||
                    `FZR order status request failed with HTTP ${response.status}.`
                );
            }
    
            return data.order;
    
        } catch (error) {
    
            if (error.name === "AbortError") {
                throw new Error(
                    "FZR status request timed out."
                );
            }
    
            throw error;
    
        } finally {
    
            clearTimeout(timeout);
        }
    }
    
    const fzrPollState = new Map();
    
    let fzrCheckerRunning = false;
    
    const FZR_POLL_BASE_DELAY =
        30 * 1000;
    
    const FZR_POLL_MAX_DELAY =
        15 * 60 * 1000;
    
    const FZR_POLL_MAX_FAILURES =
        6;
    
    async function checkPendingFzrOrders() {
    
        /*
         * Prevent overlapping checker runs.
         */
        if (fzrCheckerRunning) {
            return;
        }
    
        fzrCheckerRunning = true;
    
        try {
    
            /*
             * Only check FZR orders belonging to
             * Hiro orders that are actually Paid.
             */
            const pendingItems =
                db.prepare(`
                    SELECT
                        oi.id,
                        oi.order_id,
                        oi.fzr_order_id
                    FROM order_items oi
    
                    INNER JOIN orders o
                        ON o.order_id =
                           oi.order_id
    
                    WHERE
                        oi.fulfillment_status =
                            'Processing'
    
                        AND oi.fzr_order_id
                            IS NOT NULL
    
                        AND oi.fzr_order_id
                            != ''
    
                        AND o.status =
                            'Paid'
                `).all();
    
            if (!pendingItems.length) {
                return;
            }
    
            const now =
                Date.now();
    
            for (
                const item
                of pendingItems
            ) {
    
                const key =
                    String(
                        item.fzr_order_id
                    );
    
                const state =
                    fzrPollState.get(key) || {
                        failures: 0,
                        nextPollAt: 0
                    };
    
                /*
                 * Backoff still active.
                 */
                if (
                    now <
                    state.nextPollAt
                ) {
                    continue;
                }
    
                /*
                 * After repeated consecutive
                 * failures, pause automatic checks
                 * for 15 minutes.
                 *
                 * IMPORTANT:
                 * We DO NOT mark the item Failed,
                 * because FZR may actually have
                 * processed it successfully.
                 */
                if (
                    state.failures >=
                    FZR_POLL_MAX_FAILURES
                ) {
    
                    console.error(
                        `FZR order ${key} needs review after ${state.failures} consecutive status-check failures.`
                    );
    
                    state.nextPollAt =
                        now +
                        FZR_POLL_MAX_DELAY;
    
                    /*
                     * Allow another attempt after
                     * the cooldown instead of
                     * permanently abandoning it.
                     */
                    state.failures =
                        Math.max(
                            3,
                            state.failures - 1
                        );
    
                    fzrPollState.set(
                        key,
                        state
                    );
    
                    continue;
                }
    
                try {
    
                    const fzrOrder =
                        await getFzrOrderStatus(
                            key
                        );
    
                    const status =
                        String(fzrOrder.status || "").toLowerCase();
    
                    const fulfillmentStatus =
                        mapFzrStatusToFulfillmentStatus(status);
    
                    /*
                     * Successful communication with
                     * FZR resets failure backoff.
                     */
                    state.failures = 0;
    
                    state.nextPollAt =
                        now +
                        FZR_POLL_BASE_DELAY;
    
                    fzrPollState.set(
                        key,
                        state
                    );
    
                    if (
                        fulfillmentStatus !==
                        "Processing"
                    ) {
    
                        const result =
                            db.prepare(`
                                UPDATE order_items
    
                                SET
                                    fulfillment_status = ?
    
                                WHERE id = ?
                                  AND fulfillment_status =
                                      'Processing'
                            `).run(
                                fulfillmentStatus,
                                item.id
                            );
    
                        if (
                            result.changes === 1
                        ) {
    
                            console.log(
                                `FZR ${key}: ${status} → ${fulfillmentStatus}`
                            );
                        }
    
                        /*
                         * No reason to retain state
                         * once the FZR order reaches
                         * a final status.
                         */
                        fzrPollState.delete(
                            key
                        );
                    }
    
                } catch (error) {
    
                    state.failures += 1;
    
                    /*
                     * Exponential backoff:
                     *
                     * 30 sec
                     * 60 sec
                     * 2 min
                     * 4 min
                     * 8 min
                     * capped at 15 min
                     */
                    const delay =
                        Math.min(
                            FZR_POLL_BASE_DELAY *
                            Math.pow(
                                2,
                                state.failures - 1
                            ),
    
                            FZR_POLL_MAX_DELAY
                        );
    
                    state.nextPollAt =
                        Date.now() +
                        delay;
    
                    fzrPollState.set(
                        key,
                        state
                    );
    
                    console.error(
                        `Could not check FZR order ${key} ` +
                        `(attempt ${state.failures}, retry in ${Math.round(delay / 1000)}s):`,
                        error.message
                    );
                }
            }
    
        } catch (error) {
    
            console.error(
                "FZR pending-order checker error:",
                error.message
            );
    
        } finally {
    
            fzrCheckerRunning =
                false;
        }
    }

    return {
        finance,
        mapFzrStatusToFulfillmentStatus,
        fzrFailureDetails,
        createFzrTopup,
        getFzrOrderStatus,
        checkPendingFzrOrders
    };
};
