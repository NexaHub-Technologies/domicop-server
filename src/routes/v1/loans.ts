import Elysia, { t } from "elysia";
import { authenticate } from "@/middleware/authenticate";
import { requireAdmin } from "@/middleware/requireAdmin";
import { requireActive } from "@/middleware/requireActive";
import { supabase } from "@/lib/supabase";
import { writeAuditLog } from "@/utils/audit";
import { paginationQS, paginate, uuidParam } from "@/utils/validators";
import type { Database } from "@/types/database";
import { disburseLoan, notifyLoanApproved } from "@/services/loanDisbursement";
import { processLoanRepayment, RepaymentResult } from "@/services/loanRepayment";
import { NotificationService } from "@/services/notificationService";

type LoanUpdate = Database["public"]["Tables"]["loans"]["Update"];

export const loanRoutes = new Elysia({ prefix: "/loans" })
  .use(authenticate)
  // Requires active account status for all member-scoped loan routes below
  // (pending/suspended members cannot view or apply for loans)
  .use(requireActive)

  // (tabs)/loans.tsx → GET /loans/me
  .get("/me", async ({ userId }) => {
    const { data, error } = await supabase
      .from("loans")
      .select("*")
      .eq("member_id", userId!)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data;
  })

  // transactions/apply-for-loan.tsx → POST /loans/apply
  .post(
    "/apply",
    async ({ userId, body, set }) => {
      const { count } = await supabase
        .from("contributions")
        .select("*", { count: "exact", head: true })
        .eq("member_id", userId!)
        .eq("payment_status", "success");

      const verifiedCount = count ?? 0;
      const requiredCount = 3;

      if (verifiedCount < requiredCount) {
        set.status = 403;
        return {
          success: false,
          reason: "insufficient_contributions",
          eligibility: {
            verified_count: verifiedCount,
            required_count: requiredCount,
            short_by: requiredCount - verifiedCount,
          },
        };
      }

      const { data: existing } = await supabase
        .from("loans")
        .select("id")
        .eq("member_id", userId!)
        .in("status", ["pending", "under_review", "approved", "disbursed", "repaying"])
        .maybeSingle();

      if (existing) {
        set.status = 409;
        return {
          success: false,
          reason: "active_loan_exists",
          active_loan_id: existing.id,
        };
      }

      const { data, error } = await supabase
        .from("loans")
        .insert({
          member_id: userId!,
          amount_requested: body.amount,
          purpose: body.purpose,
          type: body.type,
          tenure_months: body.tenure_months,
          status: "pending",
        })
        .select()
        .single();
      if (error) throw new Error(error.message);
      return data;
    },
    {
      body: t.Object({
        amount: t.Number({ minimum: 1000 }),
        purpose: t.String({ minLength: 10 }),
        type: t.Union([
          t.Literal("emergency"),
          t.Literal("personal"),
          t.Literal("housing"),
          t.Literal("education"),
          t.Literal("business"),
        ]),
        tenure_months: t.Number({ minimum: 1, maximum: 36 }),
      }),
    },
  )

  // loans/[id].tsx → GET /loans/:id
  .get(
    "/:id",
    async ({ params, userId }) => {
      const { data, error } = await supabase
        .from("loans")
        .select("*, transactions(paystack_ref, amount, created_at, channel)")
        .eq("id", params.id)
        .eq("member_id", userId!)
        .single();
      if (error) throw new Error("Loan not found");
      return data;
    },
    { params: uuidParam },
  )

  // POST /loans/:id/repayment - Verify a Paystack payment server-side and apply
  // it to the loan. The client sends only the transaction reference; amount and
  // status come from Paystack, never from the client.
  .post(
    "/:id/repayment",
    async ({ params, body, userId, set }) => {
      const result = await processLoanRepayment(params.id, userId!, body.reference);

      switch (result.result) {
        case RepaymentResult.LoanNotFound:
          set.status = 404;
          return { success: false, reason: "loan_not_found" };
        case RepaymentResult.ReferenceNotFound:
          set.status = 404;
          return {
            success: false,
            reason: "reference_not_found",
            message: result.message,
          };
        case RepaymentResult.PaymentNotSuccessful:
          set.status = 402;
          return {
            success: false,
            reason: "payment_not_successful",
            status: result.paystack_status,
          };
        case RepaymentResult.UnsupportedCurrency:
          set.status = 422;
          return {
            success: false,
            reason: "unsupported_currency",
            currency: result.currency,
          };
        case RepaymentResult.AlreadyProcessed:
          return {
            success: true,
            already_processed: true,
            loan_id: result.loan_id,
            remaining_balance: result.remaining_balance,
            status: result.loan_status,
          };
        case RepaymentResult.Success:
          return {
            success: true,
            loan_id: result.loan_id,
            amount_paid: result.amount_paid,
            remaining_balance: result.remaining_balance,
            status: result.loan_status,
          };
      }
    },
    {
      params: uuidParam,
      body: t.Object({
        reference: t.String({ minLength: 1 }),
      }),
    },
  )

  .use(requireAdmin)

  .get(
    "/",
    async ({ query }) => {
      const { from, to } = paginate(query.page, query.limit);
      let q = supabase
        .from("loans")
        .select("*, profiles(full_name, member_no)", { count: "exact" })
        .order("created_at", { ascending: false })
        .range(from, to);
      if (query.status) q = q.eq("status", query.status);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { data, total: count };
    },
    {
      query: t.Partial(
        t.Object({ page: t.Numeric(), limit: t.Numeric(), status: t.String() }),
      ),
    },
  )

  .patch(
    "/:id/process",
    async ({ params, body, userId }) => {
      const updates: LoanUpdate = {
        status: body.status,
        admin_notes: body.admin_notes ?? null,
        updated_at: new Date().toISOString(),
      };
      if (body.status === "approved" && body.amount_approved) {
        const rate = body.interest_rate ?? 5;
        const total = body.amount_approved * (1 + rate / 100);
        updates.amount_approved = body.amount_approved;
        updates.interest_rate = rate;
        updates.tenure_months = body.tenure_months;
        updates.monthly_repayment = parseFloat((total / body.tenure_months!).toFixed(2));
        updates.balance = parseFloat(total.toFixed(2));
        updates.due_date = new Date(
          Date.now() + body.tenure_months! * 30 * 86400000,
        ).toISOString();
      }
      const { data, error } = await supabase
        .from("loans")
        .update(updates)
        .eq("id", params.id)
        .select()
        .single();
      if (error) throw new Error(error.message);
      await writeAuditLog({
        actor_id: userId!,
        action: `loan_${body.status}`,
        entity: "loans",
        entity_id: params.id,
      });

      if (body.status === "approved") {
        await notifyLoanApproved(params.id);
      } else if (body.status === "rejected") {
        await NotificationService.getInstance().notify({
          userIds: [data.member_id],
          type: "loan",
          title: "Loan Application Update",
          body: "Your loan application was not approved. Please contact support for details.",
          data: { event: "loan_rejected", loan_id: params.id },
          action: { label: "View Details", url: `/loans/${params.id}` },
        });
      }

      return data;
    },
    {
      params: uuidParam,
      body: t.Object({
        status: t.Union([
          t.Literal("approved"),
          t.Literal("rejected"),
          t.Literal("under_review"),
          t.Literal("disbursed"),
        ]),
        amount_approved: t.Optional(t.Number()),
        interest_rate: t.Optional(t.Number()),
        tenure_months: t.Optional(t.Number()),
        admin_notes: t.Optional(t.String()),
      }),
    },
  )

  .post(
    "/:id/disburse",
    async ({ params, userId, set }) => {
      const { data: loan, error: loanError } = await supabase
        .from("loans")
        .select("id, status, amount_approved")
        .eq("id", params.id)
        .single();

      if (loanError || !loan) {
        set.status = 404;
        throw new Error("Loan not found");
      }

      if (loan.status !== "approved") {
        set.status = 409;
        throw new Error(
          `Loan must be in 'approved' status to disburse. Current status: ${loan.status}`,
        );
      }

      if (!loan.amount_approved || loan.amount_approved <= 0) {
        set.status = 422;
        throw new Error("Loan has no approved amount to disburse");
      }

      let result;
      try {
        result = await disburseLoan(params.id);
      } catch (err) {
        // Any remaining throw from disburseLoan is a precondition failure
        // (e.g. missing bank details) not caught by the checks above.
        set.status = 422;
        throw err;
      }

      await writeAuditLog({
        actor_id: userId!,
        action: `loan_disbursement_${result.result}`,
        entity: "loans",
        entity_id: params.id,
        metadata: {
          paystack_transfer_ref: result.paystack_transfer_ref,
          recipient_code: result.recipient_code,
        },
      });

      if (result.result === "success") {
        return {
          success: true,
          status: "disbursed",
          paystack_transfer_ref: result.paystack_transfer_ref,
          disbursed_at: result.disbursed_at,
          message: "Loan disbursed successfully",
        };
      } else if (result.result === "pending_otp") {
        return {
          success: true,
          status: "pending_otp",
          paystack_transfer_ref: result.paystack_transfer_ref,
          message: result.message || "Transfer initiated. Awaiting OTP confirmation.",
        };
      } else {
        return {
          success: false,
          status: "disbursement_failed",
          message: result.message || "Disbursement failed",
        };
      }
    },
    { params: uuidParam },
  );
