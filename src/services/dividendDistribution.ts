import { supabase } from "@/lib/supabase";
import { paystack } from "@/lib/paystack";

export interface DividendInput {
  member_id: string;
  amount: number;
}

export interface DividendDistributionResult {
  member_id: string;
  status: "processing" | "failed";
  transfer_code?: string;
  error?: string;
}

/**
 * Pay out one dividend per member via Paystack transfer, recording each in
 * the `dividends` table. Failures for one member don't stop the others.
 */
export async function distributeDividends(
  dividends: DividendInput[],
  year: number,
): Promise<DividendDistributionResult[]> {
  const results: DividendDistributionResult[] = [];

  for (const dividend of dividends) {
    const { data: member } = await supabase
      .from("profiles")
      .select("bank_name, bank_account, bank_code")
      .eq("id", dividend.member_id)
      .single();

    if (!member?.bank_account || !member?.bank_code) {
      results.push({
        member_id: dividend.member_id,
        status: "failed",
        error: "Missing bank details",
      });
      continue;
    }

    try {
      const recipient = await paystack.createTransferRecipient({
        name: member.bank_name ?? "Member",
        account_number: member.bank_account,
        bank_code: member.bank_code,
      });

      const transfer = await paystack.initiateTransfer({
        amount: dividend.amount,
        recipient: recipient.recipient_code,
        reason: `Dividend for ${year}`,
      });

      await supabase.from("dividends").insert({
        member_id: dividend.member_id,
        amount: dividend.amount,
        year,
        paystack_transfer_ref: transfer.transfer_code,
        status: "processing",
      });

      results.push({
        member_id: dividend.member_id,
        status: "processing",
        transfer_code: transfer.transfer_code,
      });
    } catch (err) {
      results.push({
        member_id: dividend.member_id,
        status: "failed",
        error: err instanceof Error ? err.message : "Unknown error",
      });
    }
  }

  return results;
}
