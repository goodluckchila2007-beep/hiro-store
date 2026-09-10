(async function () {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");

    const icon = document.getElementById("icon");
    const title = document.getElementById("title");
    const message = document.getElementById("message");
    const homeLink = document.getElementById("homeLink");

    if (!token) {
        icon.textContent = "❌";
        title.textContent = "Missing verification link";
        message.textContent = "This link looks incomplete. Please use the exact link from your email.";
        homeLink.style.display = "inline-block";
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
        }
    } catch (error) {
        icon.textContent = "❌";
        title.textContent = "Something went wrong";
        message.textContent = "Please try again or request a new verification email.";
    }

    homeLink.style.display = "inline-block";
})();
