async function getCsrfToken() {
  const response = await fetch("/api/auth/csrf", { credentials: "same-origin" });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.token) {
    throw new Error(
      payload?.error ||
        (response.ok
          ? "Could not start a secure session."
          : `Could not start a secure session (${response.status}). Check that the server is running and PostgreSQL is reachable.`)
    );
  }
  return payload.token;
}

function payloadFromForm(form) {
  const data = {
    email: form.email.value.trim(),
    password: form.password.value
  };
  if (form.name) data.name = form.name.value.trim();
  return data;
}

const form = document.getElementById("authForm");
const errorEl = document.getElementById("formError");
const submitBtn = document.getElementById("submitBtn");

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorEl.textContent = "";
  submitBtn.disabled = true;
  const original = submitBtn.textContent;
  submitBtn.textContent = "Please wait…";

  try {
    const token = await getCsrfToken();
    const response = await fetch(form.dataset.endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "Content-Type": "application/json",
        "x-csrf-token": token
      },
      body: JSON.stringify(payloadFromForm(form))
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        payload?.error ||
        (payload?.errors ? payload.errors.join(" ") : null) ||
        `Request failed (${response.status})`;
      throw new Error(message);
    }
    window.location.href = "/";
  } catch (error) {
    errorEl.textContent = error.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = original;
  }
});
