/* =========================================================
           CONFIG
        ========================================================= */

        const API_BASE_URL = window.HIRO_API_BASE_URL || window.location.origin;
        const FRONTEND_ORIGIN = window.HIRO_FRONTEND_ORIGIN || window.location.origin;


        /* =========================================================
           ELEMENTS
        ========================================================= */

        const resetForm =
            document.getElementById(
                "resetPasswordForm"
            );

        const newPasswordInput =
            document.getElementById(
                "newPassword"
            );

        const confirmPasswordInput =
            document.getElementById(
                "confirmPassword"
            );

        const resetPasswordButton =
            document.getElementById(
                "resetPasswordButton"
            );

        const backLoginButton =
            document.getElementById(
                "backLoginButton"
            );

        const successState =
            document.getElementById(
                "successState"
            );

        const successLoginButton =
            document.getElementById(
                "successLoginButton"
            );

        const resetMessage =
            document.getElementById(
                "resetMessage"
            );


        /* =========================================================
           TOAST
        ========================================================= */

        function showToast(
            message,
            type = "success"
        ) {

            const container =
                document.getElementById(
                    "toastContainer"
                );

            if (!container) {
                return;
            }

            const toast =
                document.createElement(
                    "div"
                );

            toast.className =
                `toast ${type}`;

            toast.textContent =
                message;

            container.appendChild(
                toast
            );

            setTimeout(
                function () {
                    toast.classList.add(
                        "show"
                    );
                },
                10
            );

            setTimeout(
                function () {

                    toast.classList.remove(
                        "show"
                    );

                    setTimeout(
                        function () {
                            toast.remove();
                        },
                        350
                    );

                },
                3500
            );
        }


        /* =========================================================
           SHOW MESSAGE
        ========================================================= */

        function showMessage(
            message,
            type
        ) {

            if (!resetMessage) {
                return;
            }

            resetMessage.textContent =
                message;

            resetMessage.className =
                `reset-message ${type}`;
        }


        function clearMessage() {

            if (!resetMessage) {
                return;
            }

            resetMessage.textContent =
                "";

            resetMessage.className =
                "reset-message";
        }


        /* =========================================================
           GET TOKEN FROM URL
        ========================================================= */

        const urlParams =
            new URLSearchParams(
                window.location.search
            );

        const resetToken =
            urlParams.get("token");


        /* =========================================================
           CHECK TOKEN
        ========================================================= */

        if (!resetToken) {

            if (resetForm) {
                resetForm.style.display =
                    "none";
            }

            showMessage(
                "This password reset link is missing its token or is invalid.",
                "error"
            );

            showToast(
                "Invalid password reset link.",
                "error"
            );
        }


        /* =========================================================
           CSRF TOKEN
        ========================================================= */

        let csrfToken = "";

        async function getCsrfToken() {

            const response = await fetch(
                `${API_BASE_URL}/csrf-token`,
                {
                    method: "GET",
                    credentials: "include",
                    headers: {
                        Accept: "application/json"
                    }
                }
            );

            if (!response.ok) {
                throw new Error("Unable to get CSRF token.");
            }

            const data = await response.json();

            if (!data.csrfToken) {
                throw new Error("CSRF token was not returned.");
            }

            csrfToken = data.csrfToken;
            return csrfToken;
        }

        /* =========================================================
           PASSWORD RESET
        ========================================================= */

        resetForm?.addEventListener(
            "submit",
            async function (event) {

                event.preventDefault();

                clearMessage();

                const newPassword =
                    newPasswordInput?.value ||
                    "";

                const confirmPassword =
                    confirmPasswordInput?.value ||
                    "";


                /* ---------------------------------------------
                   VALIDATION
                --------------------------------------------- */

                if (!resetToken) {

                    showToast(
                        "Invalid password reset link.",
                        "error"
                    );

                    return;
                }


                if (!newPassword) {

                    showToast(
                        "Please enter a new password.",
                        "error"
                    );

                    newPasswordInput?.focus();

                    return;
                }


                if (newPassword.length < 8) {

                    showToast(
                        "Password must be at least 8 characters.",
                        "error"
                    );

                    newPasswordInput?.focus();

                    return;
                }


                if (
                    newPassword !==
                    confirmPassword
                ) {

                    showToast(
                        "Passwords do not match.",
                        "error"
                    );

                    confirmPasswordInput?.focus();

                    return;
                }


                /* ---------------------------------------------
                   LOADING
                --------------------------------------------- */

                resetPasswordButton.disabled =
                    true;

                resetPasswordButton.textContent =
                    "Resetting...";


                try {

                    /* -----------------------------------------
                       SEND TO BACKEND
                    ----------------------------------------- */

                    const response =
                        await fetch(
                            `${API_BASE_URL}/reset-password`,
                            {
                                method: "POST",

                                credentials: "include",

                                headers: {
                                    "Content-Type":
                                        "application/json",

                                    Accept:
                                        "application/json",

                                    "X-CSRF-Token":
                                        csrfToken || await getCsrfToken()
                                },

                                body:
                                    JSON.stringify({
                                        token:
                                            resetToken,

                                        password:
                                            newPassword
                                    })
                            }
                        );


                    const data =
                        await response.json();


                    console.log(
                        "Reset password response:",
                        data
                    );


                    /* -----------------------------------------
                       BACKEND ERROR
                    ----------------------------------------- */

                    if (
                        !response.ok ||
                        !data.success
                    ) {

                        showMessage(
                            data.message ||
                            "Unable to reset your password.",
                            "error"
                        );

                        showToast(
                            data.message ||
                            "Unable to reset your password.",
                            "error"
                        );

                        return;
                    }


                    /* -----------------------------------------
                       SUCCESS
                    ----------------------------------------- */

                    showMessage(
                        data.message ||
                        "Password reset successfully.",
                        "success"
                    );

                    showToast(
                        "Password changed successfully!",
                        "success"
                    );


                    resetForm.style.display =
                        "none";


                    if (successState) {
                        successState.style.display =
                            "block";
                    }


                    /*
                     * Remove the token from the visible URL
                     * after a successful reset.
                     */
                    window.history.replaceState(
                        {},
                        document.title,
                        "reset-password.html"
                    );


                } catch (error) {

                    console.error(
                        "Reset password request failed:",
                        error
                    );

                    showMessage(
                        "Unable to connect to the server. Please try again.",
                        "error"
                    );

                    showToast(
                        "Unable to connect to the server.",
                        "error"
                    );

                } finally {

                    resetPasswordButton.disabled =
                        false;

                    resetPasswordButton.textContent =
                        "Reset Password";
                }
            }
        );


        /* =========================================================
           BACK TO LOGIN
        ========================================================= */

        function goToLogin() {

            /*
             * Your login popup is inside index.html,
             * so return to the main store.
             */

            window.location.href =
                `${FRONTEND_ORIGIN}/index.html`;
        }


        backLoginButton?.addEventListener(
            "click",
            function () {
                goToLogin();
            }
        );


        successLoginButton?.addEventListener(
            "click",
            function () {
                goToLogin();
            }
        );