import Elysia, { t } from "elysia";
import { authenticate } from "../middleware/authenticate";
import { requireAdmin } from "../middleware/requireAdmin";
import { validateWebhook } from "../middleware/validateWebhook";
import { paymentRateLimit } from "../middleware/rateLimiter";
import { paystackAuth } from "../middleware/paystackAuth";
import { supabase } from "../lib/supabase";
import { paystack } from "../lib/paystack";
import { paginationQS, paginate } from "../utils/validators";
import {
  generatePaystackReference,
  createPendingTransaction,
  processSuccessfulPayment,
  processFailedPayment,
  getPendingTransaction,
  recordPaymentAttempt,
} from "../services/paymentService";

export const paymentRoutes = new Elysia({ prefix: "/payments" })
  .use(authenticate)
  .use(paymentRateLimit)

  // POST /payments/prepare - Backend generates reference and creates pending transaction
  .post(
    "/prepare",
    async ({ userId, body }) => {
      const { data: authUser } = await supabase.auth.admin.getUserById(userId);
      if (!authUser.user) throw new Error("User not found");

      // Generate unique reference on backend
      const reference = generatePaystackReference(body.type, userId);

      // Create pending transaction record
      const transaction = await createPendingTransaction({
        reference,
        memberId: userId,
        amount: body.amount,
        type: body.type,
        metadata: {
          member_id: userId,
          type: body.type,
          contribution_id: body.contribution_id,
          loan_id: body.loan_id,
        },
        contributionId: body.contribution_id,
        loanId: body.loan_id,
      });

      // Record the attempt
      await recordPaymentAttempt({
        memberId: userId,
        reference,
        status: "initiated",
        metadata: {
          amount: body.amount,
          type: body.type,
        },
      });

      // Initialize with Paystack
      const paystackData = await paystack.initializeTransaction({
        email: authUser.user.email!,
        amount: body.amount,
        reference,
        metadata: {
          member_id: userId,
          type: body.type,
          contribution_id: body.contribution_id ?? null,
          loan_id: body.loan_id ?? null,
          transaction_id: transaction.id,
        },
      });

      return {
        authorization_url: paystackData.authorization_url,
        reference: paystackData.reference,
        access_code: paystackData.access_code,
        transaction_id: transaction.id,
      };
    },
    {
      body: t.Object({
        amount: t.Number({ minimum: 100 }),
        type: t.Union([
          t.Literal("contribution"),
          t.Literal("loan_repayment"),
          t.Literal("levy"),
        ]),
        contribution_id: t.Optional(t.String()),
        loan_id: t.Optional(t.String()),
      }),
    },
  )

  // GET /payments/me - Get payment history
  .get(
    "/me",
    async ({ userId, query }) => {
      const { from, to } = paginate(query.page, query.limit);
      const { data, error } = await supabase
        .from("transactions")
        .select("*")
        .eq("member_id", userId)
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw new Error(error.message);
      return data;
    },
    { query: paginationQS },
  )

  // Admin routes
  .use(requireAdmin)
  .get(
    "/",
    async ({ query }) => {
      const { from, to } = paginate(query.page, query.limit);
      const { data, error, count } = await supabase
        .from("transactions")
        .select("*, profiles(full_name, member_no)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (error) throw new Error(error.message);
      return { data, total: count };
    },
    { query: paginationQS },
  );

// Webhook handler - processes Paystack webhooks as backup
export const webhookHandler = new Elysia()
  .use(validateWebhook)
  .post("/payments/webhook", async ({ body }) => {
    const payload = body as { event: string; data: any };
    const { event, data } = payload;

    if (event === "charge.success") {
      const { reference, amount, channel, metadata } = data;
      const memberId = metadata?.member_id;

      if (!memberId) {
        console.error("Webhook missing member_id in metadata");
        return { received: true, error: "Missing member_id" };
      }

      // Check if already processed by callback
      const { data: existing } = await supabase
        .from("transactions")
        .select("status")
        .eq("paystack_ref", reference)
        .single();

      if (existing?.status === "success") {
        return { received: true, already_processed: true };
      }

      // Process via webhook
      try {
        const verified = await paystack.verifyTransaction(reference);
        await processSuccessfulPayment(reference, verified, memberId);
        return { received: true, processed: true };
      } catch (error) {
        console.error("Webhook processing error:", error);
        return { received: true, error: (error as Error).message };
      }
    }

    if (event === "transfer.success") {
      await supabase
        .from("dividends")
        .update({ status: "success" })
        .eq("paystack_transfer_ref", data.transfer_code);
      return { received: true };
    }

    if (event === "transfer.failed") {
      await supabase
        .from("dividends")
        .update({ status: "failed" })
        .eq("paystack_transfer_ref", data.transfer_code);
      return { received: true };
    }

    return { received: true };
  });
