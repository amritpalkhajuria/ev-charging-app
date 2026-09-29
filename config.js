// Front-end configuration. Edit these for your environment.
window.APP_CONFIG = {
  // Base URL of the payment service (Stripe config + payment intents)
  PAYMENT_API: "http://localhost:8000",
  // Where Stripe sends the user back after payment
  RETURN_URL: window.location.origin + "/complete.html",
};
