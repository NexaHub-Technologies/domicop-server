import Elysia from "elysia";
import crypto from "crypto";

export const validateWebhook = new Elysia({ name: "validateWebhook" }).derive(
  { as: "global" },
  async ({ request, set }) => {
    const signature = request.headers.get("x-paystack-signature") ?? "";
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
