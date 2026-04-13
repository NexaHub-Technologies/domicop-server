import Elysia from "elysia";
import crypto from "crypto";

export const validateWebhook = new Elysia({ name: "validateWebhook" }).derive(
  async ({ request, set }) => {
    // Only validate webhook requests
    const signature = request.headers.get("x-paystack-signature");
    if (!signature) {
      // Not a webhook request, skip validation
      return { webhookPayload: null };
    }

    const rawBody = await request.text();
    const expected = crypto
      .createHmac("sha512", process.env.PAYSTACK_WEBHOOK_SECRET!)
      .update(rawBody)
      .digest("hex");
    if (expected !== signature) {
      set.status = 401;
      throw new Error("Invalid webhook signature");
    }
    return { webhookPayload: JSON.parse(rawBody) };
  },
);
