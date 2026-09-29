document.addEventListener("DOMContentLoaded", async () => {
  const { PAYMENT_API, RETURN_URL } = window.APP_CONFIG;

  // Cost is passed from the charging session page: payment.html?cost=12.34
  const cost = new URLSearchParams(window.location.search).get("cost");
  const costEl = document.getElementById("cost");
  if (costEl && cost) costEl.innerText = `£${cost}`;

  try {
    const { publishableKey } = await fetch(`${PAYMENT_API}/payment/config`).then((r) => r.json());
    const stripe = Stripe(publishableKey);

    const { clientSecret } = await fetch(`${PAYMENT_API}/payment/create-payment-intent`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Stripe expects the smallest currency unit (pence)
      body: JSON.stringify({ cost: Math.round(parseFloat(cost || "0") * 100) }),
    }).then((r) => r.json());

    const elements = stripe.elements({ clientSecret });
    elements.create("payment").mount("#payment-element");

    document.getElementById("payment-form").addEventListener("submit", async (e) => {
      e.preventDefault();

      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: { return_url: RETURN_URL },
      });

      if (error) {
        document.getElementById("error-messages").innerText = error.message;
      }
    });
  } catch (err) {
    console.error("Payment setup failed:", err);
    document.getElementById("error-messages").innerText =
      "Payment service unavailable. Check PAYMENT_API in config.js.";
  }
});
