document.addEventListener("DOMContentLoaded", async () => {
  const { PAYMENT_API } = window.APP_CONFIG;

  try {
    const { publishableKey } = await fetch(`${PAYMENT_API}/payment/config`).then((r) => r.json());
    const stripe = Stripe(publishableKey);

    // Stripe appends the client secret to the return URL as a query parameter
    const params = new URLSearchParams(window.location.search);
    const clientSecret = params.get("payment_intent_client_secret");
    if (!clientSecret) return;

    const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);

    const statusEl = document.getElementById("payment-status");
    if (statusEl) {
      statusEl.innerText =
        paymentIntent.status === "succeeded"
          ? `Payment of £${(paymentIntent.amount / 100).toFixed(2)} received.`
          : `Payment status: ${paymentIntent.status}`;
    }

    const detailsEl = document.getElementById("payment-intent");
    if (detailsEl) detailsEl.innerText = JSON.stringify(paymentIntent, null, 2);
  } catch (err) {
    console.error("Could not retrieve payment status:", err);
  }
});
