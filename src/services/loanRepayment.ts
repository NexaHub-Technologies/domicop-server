import { supabase } from "@/lib/supabase";
import { paystack } from "@/lib/paystack";
import { NotificationService } from "@/services/notificationService";
import type { Database } from "@/types/database";

export enum RepaymentResult {
  Success = "success",
  AlreadyProcessed = "already_processed",
  LoanNotFound = "loan_not_found",
  ReferenceNotFound = "reference_not_found",
  PaymentNotSuccessful = "payment_not_successful",
  UnsupportedCurrency = "unsupported_currency",
}

export interface RepaymentResponse {
  result: RepaymentResult;
  loan_id?: string;
  amount_paid?: number;
  remaining_balance?: number;
  loan_status?: string;
  message?: string;
  paystack_status?: string;
  currency?: string;
}

/**
 * Verify a Paystack payment server-side and apply it to the loan. The
 * client sends only the transaction reference; amount and status come
 * from Paystack, never from the client.
 */
export async function processLoanRepayment(
  loanId: string,
  memberId: string,
  reference: string,
): Promise<RepaymentResponse> {
  const { data: loan, error: loanError } = await supabase
    .from("loans")
    .select("id, member_id, balance, status")
    .eq("id", loanId)
    .eq("member_id", memberId)
    .single();

  if (loanError || !loan) {
    return { result: RepaymentResult.LoanNotFound };
  }

  let tx;
  try {
    tx = await paystack.verifyTransaction(reference);
  } catch (err) {
    return {
      result: RepaymentResult.ReferenceNotFound,
      message: err instanceof Error ? err.message : "Verification failed",
    };
  }

  if (tx.status !== "success") {
    return { result: RepaymentResult.PaymentNotSuccessful, paystack_status: tx.status };
  }
  if (tx.currency !== "NGN") {
    return { result: RepaymentResult.UnsupportedCurrency, currency: tx.currency };
  }

  // Record the transaction BEFORE touching the balance: paystack_ref is
  // UNIQUE, so a replayed reference fails here and cannot double-credit.
  const { error: txError } = await supabase.from("transactions").insert({
    paystack_ref: tx.reference,
    member_id: memberId,
    amount: tx.amount,
    type: "loan_repayment",
    status: "success",
    channel: tx.channel,
    loan_id: loanId,
    metadata: {
      gateway_response: tx.gateway_response,
      paid_at: tx.paid_at,
      verified_at: new Date().toISOString(),
    } as unknown as Database["public"]["Tables"]["transactions"]["Row"]["metadata"],
  });

  if (txError) {
    if (txError.code === "23505") {
      return {
        result: RepaymentResult.AlreadyProcessed,
        loan_id: loanId,
        remaining_balance: Number(loan.balance),
        loan_status: loan.status,
      };
    }
    throw new Error(`Failed to record transaction: ${txError.message}`);
  }

  const amount = tx.amount / 100;
  const newBalance = Math.max(0, Number(loan.balance) - amount);
  const newStatus = newBalance === 0 ? "closed" : "repaying";

  const { error: updateError } = await supabase
    .from("loans")
    .update({
      balance: newBalance,
      status: newStatus,
      updated_at: new Date().toISOString(),
    })
    .eq("id", loanId);

  if (updateError) {
    throw new Error(`Failed to update loan: ${updateError.message}`);
  }

  await NotificationService.getInstance().notify({
    userIds: [memberId],
    type: "loan",
    title: "Loan Repayment Successful",
    body: `₦${amount.toLocaleString()} has been processed successfully.`,
    data: {
      event: "loan_repayment",
      loan_id: loanId,
      reference: tx.reference,
      amount: amount,
    },
    action: { label: "View Details", url: `/loans/${loanId}` },
    notifyAdmins: true,
  });

  return {
    result: RepaymentResult.Success,
    loan_id: loanId,
    amount_paid: amount,
    remaining_balance: newBalance,
    loan_status: newStatus,
  };
}
