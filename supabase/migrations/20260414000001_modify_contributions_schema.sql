-- Migration: Modify contributions table schema
-- Created: 2026-04-14
-- Description: Updates contributions table to align with Paystack payment response
-- - Renames payment_ref to transaction_ref
-- - Adds member_no, member_email, payment_method, payment_status
-- - Removes proof_url (no longer needed)
-- - Removes status (replaced by payment_status)

-- Drop policies that depend on status column first
DROP POLICY IF EXISTS "Users can update own pending contributions" ON public.contributions;

-- Rename payment_ref to transaction_ref
ALTER TABLE public.contributions RENAME COLUMN payment_ref TO transaction_ref;

-- Add new columns
ALTER TABLE public.contributions ADD COLUMN IF NOT EXISTS member_no TEXT;
ALTER TABLE public.contributions ADD COLUMN IF NOT EXISTS member_email TEXT;
ALTER TABLE public.contributions ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE public.contributions ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending';

-- Drop deprecated columns
ALTER TABLE public.contributions DROP COLUMN IF EXISTS proof_url;
ALTER TABLE public.contributions DROP COLUMN IF EXISTS status;

-- Drop old index
DROP INDEX IF EXISTS idx_contributions_payment_ref;

-- Create new indexes
CREATE INDEX IF NOT EXISTS idx_contributions_transaction_ref ON public.contributions(transaction_ref);
CREATE INDEX IF NOT EXISTS idx_contributions_member_no ON public.contributions(member_no);
CREATE INDEX IF NOT EXISTS idx_contributions_payment_status ON public.contributions(payment_status);

-- Create new RLS policy for pending contributions (based on payment_status)
CREATE POLICY "Users can update own pending contributions" ON public.contributions
  FOR UPDATE USING (auth.uid() = member_id AND payment_status = 'pending');

COMMENT ON TABLE public.contributions IS 'Member contributions/savings with Paystack payment details';
COMMENT ON COLUMN public.contributions.transaction_ref IS 'Paystack transaction reference (trxref)';
COMMENT ON COLUMN public.contributions.member_no IS 'Member number from profiles table';
COMMENT ON COLUMN public.contributions.member_email IS 'Payer email from Paystack';
COMMENT ON COLUMN public.contributions.payment_method IS 'Payment channel (card, bank_transfer, etc.)';
COMMENT ON COLUMN public.contributions.payment_status IS 'Payment status from Paystack (success, failed, abandoned, pending)';
