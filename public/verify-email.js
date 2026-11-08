(async function () {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    const icon = document.getElementById("icon");
    const title = document.getElementById("title");
    const message = document.getElementById("message");
    const homeLink = document.getElementById("homeLink");
    const resendBox = document.getElementById("resendBox");
    const resendForm = document.getElementById("resendForm");
    const resendEmail = document.getElementById("resendEmail");
    const resendButton = document.getElementById("resendButton");
    const resendMessage = document.getElementById("resendMessage");

    function showResend() {
        resendBox.style.display = "block";
    }

    resendForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const email = resendEmail.value.trim();

        resendButton.disabled = true;
        resendButton.textContent = "Sending...";
        resendMessage.textContent = "";

        try {
            const response = await fetch(
                (window.HIRO_API_URL || window.location.origin) + "/resend-verification",
                {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ email })
                }
            );

            const data = await response.json();
            if (!response.ok || !data.success) {
                throw new Error(data.message || "Unable to send verification email.");
            }

            resendMessage.textContent = data.message ||
                "If that account needs verification, a new email has been sent.";
        } catch (error) {
            resendMessage.textContent = error.message ||
                "Unable to resend verification email. Please try again.";
        } finally {
            resendButton.disabled = false;
            resendButton.textContent = "Resend verification email";
        }
    });

    if (!token) {
        icon.textContent = "❌";
        title.textContent = "Missing verification link";
        message.textContent = "This link looks incomplete. Please use the exact link from your email.";
        homeLink.style.display = "inline-block";
        showResend();
        return;
    }

    try {
        const response = await fetch(
            (window.HIRO_API_URL || window.location.origin) + "/verify-email",
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ token })
            }
        );

        const data = await response.json();

        if (data.success) {
            icon.textContent = "✅";
            title.textContent = "Email verified!";
            message.textContent = "You can now log in to your account.";
        } else {
            icon.textContent = "❌";
            title.textContent = "Verification failed";
            message.textContent = data.message || "This link is invalid or has expired.";
            showResend();
        }
    } catch (error) {
        icon.textContent = "❌";
        title.textContent = "Something went wrong";
        message.textContent = "Please try again or request a new verification email.";
        showResend();
    }

    homeLink.style.display = "inline-block";
})();

// Keep the resend option available after verification attempts.
if (title.textContent !== "Email verified!") {
    showResend();
}
