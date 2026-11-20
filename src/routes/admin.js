"use strict";

/** Compose the smaller admin route modules in their original registration order. */
module.exports = function registerAdminRoutes(context) {
    require("./admin-settings")(context);
    require("./admin-fulfillment")(context);
    require("./admin-analytics")(context);
    require("./admin-management")(context);
};
