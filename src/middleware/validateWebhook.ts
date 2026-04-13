import Elysia from "elysia";
import crypto from "crypto";

const PAYSTACK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET;

if (!PAYSTACK_SECRET) {
  console.warn(
    "WARNING: PAYSTACK_WEBHOOK_SECRET is not set. Webhook validation will be skipped.",
  );
}

export const validateWebhook = new Elysia({ name: "validateWebhook" }).derive(
  async ({ request, set }) => {
    const signature = request.headers.get("x-paystack-signature");

    if (!signature) {
      set.status = 401;
      throw new Error("Missing Paystack webhook signature");
    }

    if (!PAYSTACK_SECRET) {
      console.error("PAYSTACK_WEBHOOK_SECRET not configured");
      set.status = 500;
      throw new Error("Webhook validation not configured");
    }

    const rawBody = await request.text();

    const expected = crypto
      .createHmac("sha512", PAYSTACK_SECRET)
      .update(rawBody)
      .digest("hex");

    if (expected !== signature) {
      set.status = 401;
      throw new Error("Invalid webhook signature");
    }

    return { webhookPayload: JSON.parse(rawBody) };
  },
);
